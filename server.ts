import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@insforge/sdk';
import { hybridQuery } from './router.js';
import { ingestKnowledge } from './ingest.js';
import {
  createConnector,
  getConnector,
  updateConnector,
  deleteConnector,
  updateConnectorStatus,
} from './connector-registry.js';
import { generateToken } from './connector-encryption.js';
import { generateTemplate, type TemplateLanguage } from './template-generator.js';
import { proxyDispatcher } from './proxy-dispatcher.js';
import { healthTracker } from './health-tracker.js';
import type { BusinessType } from './connector-cache.js';
import { signToken, verifyToken, decodeLegacyToken } from './auth-token.js';
import { requirePlanLimit } from './enforcement-gate.js';
import { processUpsertBatch } from './upsert-logic.js';
import { incrementQueryCount, syncResourceCounts, getUsageSummary } from './usage-tracker.js';
import { sendPlanEmail } from './email-service.js';
import { checkTrialExpirations, applyScheduledDowngrades, checkPastDueDowngrades, sendDowngradeWarnings } from './trial-expiry-job.js';
import { validateUrl, validateEventTypes } from './webhook-validation.js';
import { generateSigningSecret } from './webhook-signing.js';
import { emitEvent, deliverToEndpoint, cancelPendingRetries, runDeliveryLogsCleanup } from './webhook-dispatcher.js';
import type { WebhookEndpoint } from './webhook-types.js';
import pg from 'pg';

// Wire health tracker → registry (idempotent if router already wired it)
healthTracker.setStatusChangeCallback(async (tenantId, status, error) => {
  await updateConnectorStatus(tenantId, status, error);
});

// Inicializar pool de base de datos nativa (para evitar bloqueos de RLS)
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 3000;

// InsForge client para endpoints del dashboard
const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

// Obtener la ruta del directorio actual en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors()); // Permitir peticiones CORS del widget desde cualquier puerto/origen
app.use(express.json());

// Servir la interfaz estática (HTML, CSS, JS del panel y widget)
app.use(express.static(path.join(__dirname, '..')));

/**
 * API Endpoint para ejecutar la consulta híbrida (RAG)
 * POST /api/query
 * Body: { tenantId: string, prompt: string }
 */
app.post('/api/query', requirePlanLimit('query'), async (req: express.Request, res: express.Response) => {
  const { tenantId, prompt, user } = req.body;

  if (!tenantId || !prompt) {
    res.status(400).json({ error: 'Faltan parámetros obligatorios: tenantId o prompt.' });
    return;
  }

  try {
    const userId = user?.id || user?.email || undefined;
    const results = await hybridQuery(tenantId, prompt, userId);
    res.json(results);

    // Emitir evento message.received de webhook
    emitEvent(tenantId, 'message.received', {
      prompt,
      userId,
      response: results.humanResponse
    }).catch(() => {});

    // Atomic increment + threshold email triggers (fire-and-forget)
    incrementQueryCount(tenantId).then(async () => {
      try {
        const summary = await getUsageSummary(tenantId);
        const pct = summary.percentages.queries;
        const limit = summary.limits.monthly_query_limit;
        if (limit !== null) {
          if (pct >= 100) {
            sendPlanEmail(tenantId, 'hard_limit_reached', { limit, planName: summary.limits.monthly_query_limit }).catch(() => {});
          } else if (pct >= 80) {
            sendPlanEmail(tenantId, 'soft_limit_warning', { limit, count: summary.query_count }).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }
    }).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error interno del servidor en RAG.' });
  }
});

/**
 * API Endpoint para registrar conocimientos en la base de datos (Ingesta)
 * POST /api/ingest
 * Body: { tenantId: string, content: string }
 */
app.post('/api/ingest', async (req: express.Request, res: express.Response) => {
  const { tenantId, content } = req.body;

  if (!tenantId || !content) {
    res.status(400).json({ error: 'Faltan parámetros obligatorios: tenantId o content.' });
    return;
  }

  try {
    const result = await ingestKnowledge(tenantId, content);
    if (result.error) {
      res.status(500).json({ error: result.error.message || 'Error en el pipeline de ingesta.' });
    } else {
      res.json({ success: true, data: result.data });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error interno en ingesta.' });
  }
});

/**
 * API Endpoint para obtener pedidos de un tenant
 * GET /api/orders?tenantId=xxx
 */
app.get('/api/orders', async (req: express.Request, res: express.Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    const { data, error } = await insforge.database
      .from('pedidos_chat')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ orders: data || [] });
  } catch (err: any) {
    res.json({ orders: [] });
  }
});

/**
 * API Endpoint para obtener conversaciones (queries recientes) de un tenant
 * GET /api/conversations?tenantId=xxx&limit=50
 */
app.get('/api/conversations', async (req: express.Request, res: express.Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

  try {
    const { data, error } = await insforge.database
      .from('query_counts')
      .select('id, query_text, user_id, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ conversations: data || [] });
  } catch (err: any) {
    res.json({ conversations: [] });
  }
});

/**
 * API Endpoint para obtener catálogo de un tenant
 * GET /api/catalog?tenantId=xxx
 */
app.get('/api/catalog', async (req: express.Request, res: express.Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    const { data, error } = await insforge.database
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ products: data || [] });
  } catch (err: any) {
    res.json({ products: [] });
  }
});

/**
 * API Endpoint para agregar producto al catálogo
 * POST /api/catalog
 * Body: { tenantId, name, description, price, stock, image_url }
 */
app.post('/api/catalog', requirePlanLimit('product'), async (req: express.Request, res: express.Response) => {
  const { tenantId, name, description, price, stock, image_url } = req.body;

  if (!tenantId || !name) {
    res.status(400).json({ error: 'Faltan tenantId o name' });
    return;
  }

  try {
    const { data, error } = await insforge.database
      .from('products')
      .insert([{ tenant_id: tenantId, name, description, price, stock, image_url }])
      .select();

    if (error) throw error;
    res.json({ success: true, product: data?.[0] });

    // Emitir evento catalog.updated de webhook
    emitEvent(tenantId, 'catalog.updated', {
      action: 'create',
      product: data?.[0]
    }).catch(() => {});

    syncResourceCounts(tenantId).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al agregar producto' });
  }
});

/**
 * API Endpoint para importar productos en bulk al catálogo
 * POST /api/catalog/bulk
 * Body: { tenantId, products: Array<{ name, description?, price, stock?, image_url? }> }
 */
app.post('/api/catalog/bulk', requirePlanLimit('product'), async (req: express.Request, res: express.Response) => {
  const { tenantId, products } = req.body;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    res.status(400).json({ error: 'No hay productos para importar' });
    return;
  }

  // Validar tamaño máximo de lote (Req 5.4)
  if (products.length > 500) {
    res.status(400).json({ error: 'Máximo 500 productos por importación' });
    return;
  }

  try {
    // 1. Obtener productos existentes
    const { data: existingProducts, error: fetchError } = await insforge.database
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId);

    if (fetchError) throw fetchError;

    // 2. Procesar el lote de upsert
    const { toInsert, toUpdate, unchangedCount } = processUpsertBatch(products, existingProducts || []);

    // 3. Ejecutar de forma atómica en una transacción a través de la función RPC
    let txError: any = null;
    if (typeof (insforge as any).database?.rpc === 'function') {
      const { error } = await (insforge as any).database.rpc('apply_bulk_upsert', {
        p_tenant_id: tenantId,
        p_to_insert: toInsert,
        p_to_update: toUpdate,
      });
      if (error) txError = error;
    } else {
      // Fallback secuencial si el método rpc no está disponible en el SDK
      try {
        if (toInsert.length > 0) {
          const { error: insErr } = await insforge.database
            .from('products')
            .insert(toInsert.map(p => ({ tenant_id: tenantId, ...p })));
          if (insErr) throw insErr;
        }
        for (const upProduct of toUpdate) {
          const { error: updErr } = await insforge.database
            .from('products')
            .update({
              name: upProduct.name,
              description: upProduct.description,
              price: upProduct.price,
              stock: upProduct.stock,
              image_url: upProduct.image_url,
              updated_at: new Date().toISOString(),
            })
            .eq('id', upProduct.id)
            .eq('tenant_id', tenantId);
          if (updErr) throw updErr;
        }
      } catch (err) {
        txError = err;
      }
    }

    if (txError) throw txError;

    res.json({
      success: true,
      created: toInsert.length,
      updated: toUpdate.length,
      unchanged: unchangedCount,
    });

    // Emitir evento catalog.updated de webhook
    emitEvent(tenantId, 'catalog.updated', {
      action: 'bulk_import',
      createdCount: toInsert.length,
      updatedCount: toUpdate.length,
      unchangedCount
    }).catch(() => {});

    syncResourceCounts(tenantId).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al importar productos' });
  }
});

/**
 * API Endpoint para actualizar un producto del catálogo
 * PUT /api/catalog/:id
 * Body: { tenantId, name, description, price, stock, image_url }
 */
app.put('/api/catalog/:id', async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { tenantId, name, description, price, stock, image_url } = req.body;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  if (!name) {
    res.status(400).json({ error: 'El nombre es obligatorio' });
    return;
  }

  try {
    // Verify product exists
    const { data: existing, error: fetchError } = await insforge.database
      .from('products')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existing) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }

    if (existing.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Update the product
    const { data, error } = await insforge.database
      .from('products')
      .update({ name, description, price, stock, image_url })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select();

    if (error) throw error;
    res.json({ success: true, product: data?.[0] });

    // Emitir evento catalog.updated de webhook
    emitEvent(tenantId, 'catalog.updated', {
      action: 'update',
      product: data?.[0]
    }).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al actualizar producto' });
  }
});

/**
 * API Endpoint para eliminar un producto del catálogo
 * DELETE /api/catalog/:id
 * Query/Body: { tenantId }
 */
app.delete('/api/catalog/:id', async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const tenantId = (req.query.tenantId as string) || req.body?.tenantId;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    // Verify product exists
    const { data: existing, error: fetchError } = await insforge.database
      .from('products')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existing) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }

    if (existing.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Delete the product
    const { error: deleteError } = await insforge.database
      .from('products')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (deleteError) throw deleteError;

    res.json({ success: true });

    // Emitir evento catalog.updated de webhook
    emitEvent(tenantId, 'catalog.updated', {
      action: 'delete',
      productId: id
    }).catch(() => {});

    syncResourceCounts(tenantId).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al eliminar producto' });
  }
});

/**
 * API Endpoint para obtener métricas de consultas de un tenant
 * GET /api/metrics/queries?tenantId=xxx
 */
app.get('/api/metrics/queries', async (req: express.Request, res: express.Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    const { count, error } = await insforge.database
      .from('query_counts')
      .select('id', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (error) throw error;
    res.json({ count: count ?? 0 });
  } catch (err: any) {
    res.json({ count: 0 });
  }
});

/**
 * API Endpoint para generar una API key para un tenant
 * POST /api/keys/generate
 * Body: { tenantId }
 */
app.post('/api/keys/generate', requirePlanLimit('api_key'), async (req: express.Request, res: express.Response) => {
  const { tenantId } = req.body;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    const generatedKey = crypto.randomBytes(32).toString('hex');

    const { error } = await insforge.database
      .from('api_keys')
      .insert([{ tenant_id: tenantId, key_value: generatedKey }]);

    if (error) throw error;
    res.json({ success: true, key: generatedKey });
    syncResourceCounts(tenantId).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al generar API key' });
  }
});

/**
 * API Endpoint para guardar configuración del asistente
 * POST /api/config
 * Body: { tenantId, name, manual, type }
 */
app.post('/api/config', async (req: express.Request, res: express.Response) => {
  const { tenantId, name, manual, type } = req.body;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  try {
    const { error } = await insforge.database
      .from('companies')
      .upsert({
        id: tenantId,
        name: name || null,
        operational_manual: manual || null,
        business_type: type || null,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al guardar configuración' });
  }
});

/**
 * GET /api/config — Returns tenant config including connector health status (Req 10.4)
 */
app.get('/api/config', async (req: express.Request, res: express.Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) { res.status(400).json({ error: 'Falta tenantId' }); return; }
  try {
    const connector = await getConnector(tenantId);
    res.json({
      connector: connector
        ? { status: connector.status, enabled: connector.enabled, business_type: connector.business_type, display_name: connector.display_name }
        : null,
    });
  } catch {
    res.json({ connector: null });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH 2.0
// ═══════════════════════════════════════════════════════════════════════════════
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

function getGoogleRedirectUri() {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  return `${base}/auth/google/callback`;
}

/**
 * POST /auth/register — email/password sign-up
 * Body: { name, email, password, passwordConfirm }
 */
app.post('/auth/register', async (req: express.Request, res: express.Response) => {
  const { name, email, password, passwordConfirm } = req.body;

  // Validation
  if (!name || name.length < 2 || name.length > 128) {
    res.status(400).json({ error: 'validation', field: 'name', message: 'Name must be 2–128 characters' });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    res.status(400).json({ error: 'validation', field: 'email', message: 'Valid email required' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'validation', field: 'password', message: 'Password must be at least 8 characters' });
    return;
  }
  if (password !== passwordConfirm) {
    res.status(400).json({ error: 'validation', field: 'passwordConfirm', message: 'Passwords do not match' });
    return;
  }

  try {
    // Check email uniqueness
    const { data: existing } = await insforge.database
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'email_exists', message: 'Email already registered', signInUrl: '/auth/login' });
      return;
    }

    // Hash password with bcrypt cost factor 12
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const { data: newUser, error: userError } = await insforge.database
      .from('users')
      .insert([{
        email: email.toLowerCase().trim(),
        name,
        password_hash: passwordHash,
        role: 'tenant',
        onboarding_completed: false,
        onboarding_step: 0,
        onboarding_step_data: {},
      }])
      .select()
      .single();

    if (userError || !newUser) {
      throw new Error(userError?.message || 'Failed to create user');
    }

    const userId = newUser.id;

    // Create company
    await insforge.database
      .from('companies')
      .insert([{ id: userId, name, owner_id: userId }]);

    // Create free subscription
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const serviceInsforge = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });
    await serviceInsforge.database
      .from('subscriptions')
      .insert([{
        tenant_id: userId,
        plan_id: 'free',
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      }]);

    // Welcome email (fire-and-forget)
    const { sendPlanEmail } = await import('./email-service.js');
    sendPlanEmail(userId, 'welcome', { name }).catch(() => {});

    // Return token
    const token = signToken({ id: userId, email: newUser.email, name, role: 'tenant', tenantId: userId, avatar_url: null });
    res.status(201).json({ token, user: { id: userId, email: newUser.email, name, role: 'tenant', tenantId: userId }, isNewUser: true });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * POST /auth/login — email/password sign-in
 * Body: { email, password }
 */
app.post('/auth/login', async (req: express.Request, res: express.Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'validation', message: 'Email and password required' });
    return;
  }

  try {
    const { data: user } = await insforge.database
      .from('users')
      .select('id, email, name, password_hash, role, onboarding_completed')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!user || !user.password_hash) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    const bcrypt = await import('bcrypt');
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    // Get tenantId (company id = user id for tenant-created accounts)
    const { data: company } = await insforge.database
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();

    const tenantId = company?.id || user.id;
    const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role || 'tenant', tenantId, avatar_url: null });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role || 'tenant', tenantId }, onboarding_completed: user.onboarding_completed });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * Iniciar login con Google
 * GET /auth/google
 */
app.get('/auth/google', (req: express.Request, res: express.Response) => {
  const redirectUri = getGoogleRedirectUri();
  const scope = encodeURIComponent('openid email profile');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

/**
 * Callback de Google OAuth
 * GET /auth/google/callback
 */
app.get('/auth/google/callback', async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Falta el código de autorización');
    return;
  }

  try {
    // Intercambiar code por tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResp.json() as { access_token?: string; id_token?: string; error?: string };
    if (tokens.error || !tokens.access_token) {
      res.status(400).send(`Error de Google: ${tokens.error || 'No access_token'}`);
      return;
    }

    // Obtener perfil del usuario
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResp.json() as { id: string; email: string; name: string; picture: string };

    // ─── Vinculación por EMAIL (identificador universal) ───────────────────
    // Primero buscar por email (vincula usuarios de Rotteri y Eteba Chat)
    let existingUser: any = null;
    const resByEmail = await pgPool.query(
      'SELECT id, email, google_id FROM users WHERE email = $1',
      [profile.email]
    );
    const userByEmail = resByEmail.rows[0];

    if (userByEmail) {
      existingUser = userByEmail;
      // Si no tenía google_id (fue creado desde otro sistema), vincularlo
      if (!userByEmail.google_id) {
        await pgPool.query(
          'UPDATE users SET google_id = $1, avatar_url = $2, updated_at = $3 WHERE id = $4',
          [profile.id, profile.picture, new Date().toISOString(), userByEmail.id]
        );
      }
    } else {
      // Buscar por google_id como fallback
      const resByGoogle = await pgPool.query(
        'SELECT id, email, google_id FROM users WHERE google_id = $1',
        [profile.id]
      );
      existingUser = resByGoogle.rows[0];
    }

    let userId: string;
    let userRole = 'user';
    let linkedTenantId: string | null = null;
    let isNewUser = false;

    if (existingUser) {
      userId = existingUser.id;
      await pgPool.query(
        'UPDATE users SET name = $1, email = $2, avatar_url = $3, updated_at = $4 WHERE id = $5',
        [profile.name, profile.email, profile.picture, new Date().toISOString(), userId]
      );
    } else {
      isNewUser = true;

      // Crear nuevo usuario
      try {
        const resNew = await pgPool.query(
          `INSERT INTO users (google_id, email, name, avatar_url, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, email`,
          [profile.id, profile.email, profile.name, profile.picture, new Date().toISOString()]
        );
        const newUser = resNew.rows[0];
        userId = newUser.id;
      } catch (insertErr: any) {
        res.status(500).send('Error al crear usuario en base de datos');
        return;
      }

      // Crear company asociada al nuevo usuario
      await insforge.database
        .from('companies')
        .insert([{ id: userId, name: profile.name, owner_id: userId }]);

      // Crear suscripción Free para el nuevo usuario
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });
      await serviceClient.database
        .from('subscriptions')
        .insert([{
          tenant_id: userId,
          plan_id: 'free',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        }]);

      // Enviar email de bienvenida (fire-and-forget)
      const { sendPlanEmail } = await import('./email-service.js');
      sendPlanEmail(userId, 'welcome', { name: profile.name }).catch(() => {});
      
      // Log de registro de nuevo usuario
      logEvent('info', 'auth', `Nuevo usuario registrado vía Google: ${profile.email}`, { name: profile.name }, userId);
    }

    // ─── Verificar si el email es owner de algún negocio/tenant ────────────
    // 'admin'  → administrador de la plataforma Eteba Chat (acceso total)
    // 'tenant' → cliente/negocio que usa el servicio (acceso a su dashboard)
    const platformRoles: Record<string, { role: string; tenantId: string | null }> = {
      'etebachalegroup@gmail.com': { role: 'admin',  tenantId: '1ea8bd01-b5b5-46d9-a525-495d0e9721bf' },
      'rotterinzakus@gmail.com':   { role: 'tenant', tenantId: 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b' },
    };

    if (platformRoles[profile.email]) {
      userRole = platformRoles[profile.email].role;
      linkedTenantId = platformRoles[profile.email].tenantId;
    }

    // Crear token firmado con info extendida
    const userPayload = {
      id: userId,
      email: profile.email,
      name: profile.name,
      avatar_url: profile.picture,
      role: userRole,
      tenantId: linkedTenantId || userId,
    };

    const token = signToken(userPayload);

    // Log de inicio de sesión exitoso
    logEvent('info', 'auth', `Usuario inició sesión vía Google: ${profile.email}`, { role: userRole }, linkedTenantId || userId);

    // Redirigir al frontend con el token — nuevos usuarios van al onboarding
    if (isNewUser) {
      res.redirect(`/?auth_token=${token}&new_user=true`);
    } else {
      res.redirect(`/?auth_token=${token}`);
    }
  } catch (err: any) {
    console.error('❌ Error en Google OAuth callback:', err);
    logEvent('error', 'auth', `Fallo de autenticación vía Google: ${err.message}`, { stack: err.stack });
    res.status(500).send('Error interno de autenticación');
  }
});

/**
 * Obtener datos del usuario actual
 * GET /auth/me?token=xxx
 */
app.get('/auth/me', (req: express.Request, res: express.Response) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  // Try signed token first, fall back to legacy unsigned token
  const payload = verifyToken(token) ?? decodeLegacyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token inválido' });
    return;
  }
  res.json(payload);
});

/**
 * Vincular usuario por email — verifica si un email ya existe en la plataforma
 * POST /auth/link
 * Body: { email: string }
 */
app.post('/auth/link', async (req: express.Request, res: express.Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Falta email' });
    return;
  }

  try {
    const { data: user } = await insforge.database
      .from('users')
      .select('id, email, name, avatar_url')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (user) {
      res.json({ linked: true, user: { id: user.id, name: user.name, email: user.email } });
    } else {
      res.json({ linked: false });
    }
  } catch (err: any) {
    res.json({ linked: false });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR MANAGEMENT API (/api/connectors/*)
// Requirements: 2.1–2.8, 9.5–9.7, 10.4, 11.7–11.8, 12.5
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract and VERIFY tenantId from the signed auth token in the request.
 *  Rejects unsigned/tampered tokens — prevents tenantId forgery. */
function getTenantIdFromRequest(req: express.Request): string | null {
  const auth = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  if (!auth) return null;

  // Prefer signed token; fall back to legacy unsigned token for backward compat
  const payload = verifyToken(auth) ?? decodeLegacyToken(auth);
  return payload?.tenantId ?? null;
}

/** Extract and VERIFY userId from the signed auth token in the request. */
function getUserIdFromRequest(req: express.Request): string | null {
  const auth = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  if (!auth) return null;

  const payload = verifyToken(auth) ?? decodeLegacyToken(auth);
  return payload?.id ?? null;
}

function handleConnectorError(err: unknown, res: express.Response) {
  const e = err as any;
  if (e?.status && typeof e.status === 'number') {
    res.status(e.status).json({ error: e.message, missingFields: e.missingFields });
    return;
  }
  console.error('Connector API error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// POST /api/connectors — Create
app.post('/api/connectors', requirePlanLimit('connector'), async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const config = await createConnector(tenantId, req.body);
    res.status(201).json({ connector: config });
    const tid = getTenantIdFromRequest(req);
    if (tid) syncResourceCounts(tid).catch(() => {});
  } catch (err) { handleConnectorError(err, res); }
});

// GET /api/connectors — Read
app.get('/api/connectors', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const config = await getConnector(tenantId);
    if (!config) { res.status(404).json({ error: 'No connector found for this tenant' }); return; }
    res.json({ connector: config });
  } catch (err) { handleConnectorError(err, res); }
});

// PUT /api/connectors — Update
app.put('/api/connectors', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const config = await updateConnector(tenantId, req.body);
    res.json({ connector: config });
  } catch (err) { handleConnectorError(err, res); }
});

// DELETE /api/connectors — Delete
app.delete('/api/connectors', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    await deleteConnector(tenantId);
    res.json({ success: true });
  } catch (err) { handleConnectorError(err, res); }
});

// POST /api/connectors/test — Ping the proxy
app.post('/api/connectors/test', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const { proxy_url, connector_token } = req.body;
    if (!proxy_url || !connector_token) {
      res.status(400).json({ error: 'proxy_url and connector_token are required' });
      return;
    }
    const tempConfig = {
      id: 'test', tenant_id: tenantId, proxy_url, connector_token,
      business_type: 'general' as BusinessType, display_name: 'test',
      enabled: true, status: 'active' as const, failure_count: 0,
      last_error: null, last_error_at: null, created_at: '', updated_at: '',
    };
    const result = await proxyDispatcher.dispatch(tempConfig, { action: 'ping', params: {} });
    if (result.error) {
      res.status(502).json({ success: false, error: result.error });
    } else {
      // Also reset health status if it was in error
      await healthTracker.resetStatus(tenantId);
      res.json({ success: true, data: result.data });
    }
  } catch (err) { handleConnectorError(err, res); }
});

// POST /api/connectors/generate-token — Generate a secure token
app.post('/api/connectors/generate-token', (req: express.Request, res: express.Response) => {
  res.json({ token: generateToken() });
});

// GET /api/connectors/template — Download proxy template
app.get('/api/connectors/template', async (req: express.Request, res: express.Response) => {
  const language = (req.query.language as TemplateLanguage) || 'nodejs';
  const businessType = (req.query.businessType as BusinessType) || 'general';
  const tenantId = getTenantIdFromRequest(req);

  let connectorToken: string | undefined;
  if (tenantId) {
    try {
      const cfg = await getConnector(tenantId);
      // cfg.connector_token is masked — just use it as placeholder; user will see ****xxxx
      connectorToken = cfg?.connector_token;
    } catch { /* non-fatal */ }
  }

  try {
    const content = generateTemplate(language, businessType, connectorToken);
    const ext = language === 'php' ? 'php' : language === 'python' ? 'py' : 'js';
    res.setHeader('Content-Disposition', `attachment; filename="eteba-proxy-${businessType}.${ext}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) { handleConnectorError(err, res); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK INTEGRATIONS API (/api/webhooks/*)
// ═══════════════════════════════════════════════════════════════════════════════

// Map in memory to rate limit manual test pings (1 per 5 seconds per endpoint)
const lastTestPingMap = new Map<string, number>();

// Helper to handle unauthorized requests
function checkAuth(req: express.Request, res: express.Response): string | null {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) {
    res.status(401).json({ error: 'unauthorized', message: 'Falta token de autenticación o es inválido' });
    return null;
  }
  return tenantId;
}

// POST /api/webhooks — Create a webhook endpoint
app.post('/api/webhooks', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const { url, events } = req.body;

  // 1. Validar URL y eventos
  const urlVal = validateUrl(url);
  if (!urlVal.valid) {
    res.status(400).json({ error: urlVal.error });
    return;
  }

  const eventsVal = validateEventTypes(events);
  if (!eventsVal.valid) {
    res.status(400).json({ error: eventsVal.error });
    return;
  }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    // 2. Limitar a máximo 10 endpoints por tenant
    const { data: existing, error: countError } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, url')
      .eq('tenant_id', tenantId);

    if (countError) throw countError;

    if (existing && existing.length >= 10) {
      res.status(409).json({ error: 'Límite de endpoints alcanzado (máximo 10 por tenant)' });
      return;
    }

    // 3. Validar URL única por tenant
    const duplicate = existing?.find(ep => ep.url.toLowerCase().trim() === url.toLowerCase().trim());
    if (duplicate) {
      res.status(409).json({ error: 'Ya tienes un webhook configurado con esta URL exacta' });
      return;
    }

    // 4. Generar secreto y guardar
    const signingSecret = generateSigningSecret();
    const { data: newEp, error: createError } = await serviceClient.database
      .from('webhook_endpoints')
      .insert([{
        tenant_id: tenantId,
        url: url.trim(),
        events,
        signing_secret: signingSecret,
        is_active: true,
        consecutive_failures: 0
      }])
      .select()
      .single();

    if (createError) throw createError;

    // Retornar 201 con secreto visible solo una vez
    res.status(201).json({
      success: true,
      endpoint: {
        id: newEp.id,
        tenant_id: newEp.tenant_id,
        url: newEp.url,
        events: newEp.events,
        is_active: newEp.is_active,
        consecutive_failures: newEp.consecutive_failures,
        created_at: newEp.created_at,
        updated_at: newEp.updated_at
      },
      signing_secret: signingSecret
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al crear el webhook' });
  }
});

// GET /api/webhooks — List webhook endpoints (Excludes signing_secret)
app.get('/api/webhooks', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: endpoints, error } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id, url, events, is_active, consecutive_failures, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, endpoints: endpoints || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al listar webhooks' });
  }
});

// PUT /api/webhooks/:id — Update endpoint
app.put('/api/webhooks/:id', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const { id } = req.params;
  const { url, events } = req.body;

  const urlVal = validateUrl(url);
  if (!urlVal.valid) {
    res.status(400).json({ error: urlVal.error });
    return;
  }

  const eventsVal = validateEventTypes(events);
  if (!eventsVal.valid) {
    res.status(400).json({ error: eventsVal.error });
    return;
  }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    // Verify ownership
    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Check duplicate URL excluding this endpoint
    const { data: dupUrlCheck } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('url', url.trim())
      .neq('id', id)
      .maybeSingle();

    if (dupUrlCheck) {
      res.status(409).json({ error: 'Ya tienes otro webhook configurado con esta URL exacta' });
      return;
    }

    const { data: updatedEp, error: updateErr } = await serviceClient.database
      .from('webhook_endpoints')
      .update({
        url: url.trim(),
        events,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, tenant_id, url, events, is_active, consecutive_failures, created_at, updated_at')
      .single();

    if (updateErr) throw updateErr;
    res.json({ success: true, endpoint: updatedEp });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al actualizar el webhook' });
  }
});

// PATCH /api/webhooks/:id/toggle — Toggle active status
app.patch('/api/webhooks/:id/toggle', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const id = req.params.id as string;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id, is_active, consecutive_failures')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    const nextActive = !ep.is_active;

    const { error: updateErr } = await serviceClient.database
      .from('webhook_endpoints')
      .update({
        is_active: nextActive,
        consecutive_failures: nextActive ? 0 : ep.consecutive_failures, // reset if enabling
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    if (!nextActive) {
      cancelPendingRetries(id);
    }

    res.json({ success: true, is_active: nextActive });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al cambiar estado' });
  }
});

// DELETE /api/webhooks/:id — Delete endpoint
app.delete('/api/webhooks/:id', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const id = req.params.id as string;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    const { error: deleteErr } = await serviceClient.database
      .from('webhook_endpoints')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    cancelPendingRetries(id);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al eliminar el webhook' });
  }
});

// POST /api/webhooks/:id/test — Send test delivery ping (test.ping event)
app.post('/api/webhooks/:id/test', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const id = req.params.id as string;

  // Rate limit: 1 request per 5 seconds
  const lastTime = lastTestPingMap.get(id) || 0;
  const now = Date.now();
  if (now - lastTime < 5000) {
    res.status(429).json({ error: 'Intenta de nuevo en unos segundos' });
    return;
  }
  lastTestPingMap.set(id, now);

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Emit ping payload
    const testPayload = {
      id: crypto.randomUUID(),
      event: 'test.ping' as const,
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      data: {
        message: '¡Prueba de Webhook exitosa!',
        version: '1.0.0',
        triggered_at: new Date().toISOString()
      }
    };

    const deliveryResult = await deliverToEndpoint(ep as WebhookEndpoint, testPayload, 1, null, true);

    res.json({
      success: deliveryResult.success,
      statusCode: deliveryResult.statusCode,
      responseBody: deliveryResult.responseBody,
      error: deliveryResult.error
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al ejecutar prueba de webhook' });
  }
});

// POST /api/webhooks/:id/regenerate-secret — Regenerate signing secret
app.post('/api/webhooks/:id/regenerate-secret', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const id = req.params.id as string;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    const newSecret = generateSigningSecret();

    const { error: updateErr } = await serviceClient.database
      .from('webhook_endpoints')
      .update({
        signing_secret: newSecret,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    res.json({ success: true, signing_secret: newSecret });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al regenerar secreto' });
  }
});

// GET /api/webhooks/:id/logs — List delivery logs paginated
app.get('/api/webhooks/:id/logs', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const id = req.params.id as string;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 20); // max 20 logs per page
  const offset = (page - 1) * limit;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    // Verify endpoint ownership
    const { data: ep, error: fetchErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!ep) {
      res.status(404).json({ error: 'Endpoint no encontrado' });
      return;
    }
    if (ep.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // Get logs and count total
    const { data: logs, error: logsErr } = await serviceClient.database
      .from('delivery_logs')
      .select('*')
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (logsErr) throw logsErr;

    const { count, error: countErr } = await serviceClient.database
      .from('delivery_logs')
      .select('id', { count: 'exact' })
      .eq('endpoint_id', id);

    if (countErr) throw countErr;

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      logs: logs || [],
      page,
      limit,
      total,
      totalPages
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al listar logs de webhooks' });
  }
});

// POST /api/webhooks/logs/:logId/retry — Manual retry delivery
app.post('/api/webhooks/logs/:logId/retry', async (req: express.Request, res: express.Response) => {
  const tenantId = checkAuth(req, res);
  if (!tenantId) return;

  const logId = req.params.logId as string;

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    // 1. Fetch the log and verify ownership
    const { data: log, error: logErr } = await serviceClient.database
      .from('delivery_logs')
      .select('*')
      .eq('id', logId)
      .maybeSingle();

    if (logErr) throw logErr;
    if (!log) {
      res.status(404).json({ error: 'Log de entrega no encontrado' });
      return;
    }
    if (log.tenant_id !== tenantId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    // 2. Reject if delivery is not failed or permanently_failed
    if (log.status !== 'permanently_failed' && log.status !== 'failed') {
      res.status(400).json({ error: 'Solo se pueden reintentar envíos fallidos' });
      return;
    }

    // 3. Fetch corresponding endpoint
    const { data: ep, error: epErr } = await serviceClient.database
      .from('webhook_endpoints')
      .select('*')
      .eq('id', log.endpoint_id)
      .maybeSingle();

    if (epErr) throw epErr;
    if (!ep) {
      res.status(404).json({ error: 'El endpoint asociado a este log ya no existe' });
      return;
    }

    // 4. Retry the delivery with new UUID, updated timestamp, and linkage
    const testPayload = {
      ...log.payload,
      id: crypto.randomUUID(), // New attempt ID
      timestamp: new Date().toISOString()
    };

    const deliveryResult = await deliverToEndpoint(
      ep as WebhookEndpoint,
      testPayload,
      log.attempt_number + 1, // increment attempt
      log.parent_delivery_id || log.id, // root parent reference
      log.is_test
    );

    res.json({
      success: deliveryResult.success,
      statusCode: deliveryResult.statusCode,
      responseBody: deliveryResult.responseBody,
      error: deliveryResult.error
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al reintentar envío' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLANS & SUBSCRIPTION API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/plans — public plan listing (no auth required)
 */
app.get('/api/plans', async (_req: express.Request, res: express.Response) => {
  try {
    const { data, error } = await insforge.database
      .from('plans')
      .select('*')
      .order('price_monthly_usd', { ascending: true });

    if (error) throw error;
    res.json({ plans: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/subscription — current tenant subscription + usage summary
 */
app.get('/api/subscription', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const { getUsageSummary } = await import('./usage-tracker.js');

    const { data: sub, error: subError } = await insforge.database
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub) { res.status(404).json({ error: 'subscription_not_found' }); return; }

    const usage = await getUsageSummary(tenantId);

    let daysUntilTrialEnd: number | undefined;
    if (sub.status === 'trialing' && sub.trial_ends_at) {
      const msLeft = new Date(sub.trial_ends_at).getTime() - Date.now();
      daysUntilTrialEnd = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    // Also get onboarding status
    const { data: user } = await insforge.database
      .from('users')
      .select('onboarding_completed')
      .eq('id', tenantId)
      .maybeSingle();

    res.json({
      subscription: sub,
      plan: sub.plans,
      usage,
      daysUntilTrialEnd,
      onboarding_completed: user?.onboarding_completed ?? true,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/subscription/trial — activate Business trial
 */
app.post('/api/subscription/trial', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: sub, error: subError } = await serviceClient.database
      .from('subscriptions')
      .select('id, plan_id, status, trial_used_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub) { res.status(404).json({ error: 'subscription_not_found' }); return; }

    // Reject if trial already used
    if (sub.trial_used_at) {
      res.status(409).json({ error: 'trial_already_used' });
      return;
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Write audit entry FIRST (Req 11.3)
    await writeAuditEntry(serviceClient, sub.id, 'trial_start', sub.plan_id, 'business', 'user');

    // Update subscription
    await serviceClient.database
      .from('subscriptions')
      .update({
        plan_id: 'business',
        status: 'trialing',
        trial_ends_at: trialEnd.toISOString(),
        trial_used_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('tenant_id', tenantId);

    res.json({ success: true, trial_ends_at: trialEnd.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN UPGRADE / DOWNGRADE / CANCEL
// Requirements: 7.1–7.7, 11.2, 11.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Writes an audit entry to subscription_events BEFORE mutating the subscription.
 * All subscription state transitions must call this first (Req 11.3).
 */
async function writeAuditEntry(
  serviceClient: ReturnType<typeof createClient>,
  subscriptionId: string,
  eventType: string,
  oldPlanId: string | null,
  newPlanId: string,
  triggeredBy: 'user' | 'system' | 'trial_expiry',
  metadata: Record<string, any> = {}
): Promise<void> {
  const { error } = await serviceClient.database
    .from('subscription_events')
    .insert([{
      subscription_id: subscriptionId,
      event_type: eventType,
      old_plan_id: oldPlanId,
      new_plan_id: newPlanId,
      triggered_by: triggeredBy,
      metadata,
    }]);
  if (error) {
    // Log but don't block the main operation — audit failure should not prevent transitions
    console.error('[writeAuditEntry] Failed to write audit entry:', error);
  }
}

// Plan tier order for upgrade/downgrade validation
const PLAN_TIER: Record<string, number> = { free: 0, starter: 1, business: 2, enterprise: 3 };

/**
 * POST /api/subscription/upgrade — change to a higher plan
 * Body: { newPlanId: string }
 */
app.post('/api/subscription/upgrade', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  const { newPlanId } = req.body;
  if (!newPlanId || !(newPlanId in PLAN_TIER)) {
    res.status(400).json({ error: 'invalid_plan' });
    return;
  }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: sub, error: subError } = await serviceClient.database
      .from('subscriptions')
      .select('id, plan_id, status, scheduled_plan_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub) { res.status(404).json({ error: 'subscription_not_found' }); return; }

    if (PLAN_TIER[newPlanId] <= PLAN_TIER[sub.plan_id]) {
      res.status(400).json({ error: 'invalid_upgrade', message: 'newPlanId must be a higher tier than current plan' });
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Write audit entry FIRST (Req 11.3)
    await writeAuditEntry(serviceClient, sub.id, 'upgrade', sub.plan_id, newPlanId, 'user');

    // Update subscription
    await serviceClient.database
      .from('subscriptions')
      .update({
        plan_id: newPlanId,
        status: 'active',
        scheduled_plan_id: null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('tenant_id', tenantId);

    // Send confirmation email (fire-and-forget)
    const { sendPlanEmail } = await import('./email-service.js');
    sendPlanEmail(tenantId, 'upgrade_confirmed', {
      newPlanId,
      newPlanName: newPlanId.charAt(0).toUpperCase() + newPlanId.slice(1),
      effectiveDate: now.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }).catch(() => {});

    res.json({ success: true, plan_id: newPlanId, current_period_end: periodEnd.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/subscription/downgrade — schedule a downgrade for period end
 * Body: { newPlanId: string }
 */
app.post('/api/subscription/downgrade', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  const { newPlanId } = req.body;
  if (!newPlanId || !(newPlanId in PLAN_TIER)) {
    res.status(400).json({ error: 'invalid_plan' });
    return;
  }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: sub, error: subError } = await serviceClient.database
      .from('subscriptions')
      .select('id, plan_id, status, current_period_end')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub) { res.status(404).json({ error: 'subscription_not_found' }); return; }

    if (PLAN_TIER[newPlanId] >= PLAN_TIER[sub.plan_id]) {
      res.status(400).json({ error: 'invalid_downgrade', message: 'newPlanId must be a lower tier than current plan' });
      return;
    }

    // Write audit entry FIRST (Req 11.3)
    await writeAuditEntry(serviceClient, sub.id, 'downgrade', sub.plan_id, newPlanId, 'user');

    // Schedule the downgrade — plan_id stays unchanged until period end
    await serviceClient.database
      .from('subscriptions')
      .update({ scheduled_plan_id: newPlanId, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);

    // Check if usage already exceeds new plan limits (Req 7.5)
    const { getUsageSummary } = await import('./usage-tracker.js');
    const { getPlanLimits } = await import('./plans-cache.js');
    const [usage, newPlanLimits] = await Promise.all([
      getUsageSummary(tenantId),
      getPlanLimits(newPlanId),
    ]);

    const warnings: string[] = [];
    if (newPlanLimits.monthly_query_limit !== null && usage.query_count > newPlanLimits.monthly_query_limit) {
      warnings.push(`queries: current ${usage.query_count} exceeds new limit ${newPlanLimits.monthly_query_limit}`);
    }
    if (newPlanLimits.product_limit !== null && usage.product_count > newPlanLimits.product_limit) {
      warnings.push(`products: current ${usage.product_count} exceeds new limit ${newPlanLimits.product_limit}`);
    }
    if (usage.connector_count > newPlanLimits.connector_limit) {
      warnings.push(`connectors: current ${usage.connector_count} exceeds new limit ${newPlanLimits.connector_limit}`);
    }
    if (newPlanLimits.api_key_limit !== null && usage.api_key_count > newPlanLimits.api_key_limit) {
      warnings.push(`api_keys: current ${usage.api_key_count} exceeds new limit ${newPlanLimits.api_key_limit}`);
    }

    res.json({
      success: true,
      scheduled_plan_id: newPlanId,
      effective_date: sub.current_period_end,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/subscription/cancel — cancel subscription
 */
app.post('/api/subscription/cancel', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const serviceClient = createClient({ baseUrl: process.env.INSFORGE_BASE_URL!, anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)! });

    const { data: sub, error: subError } = await serviceClient.database
      .from('subscriptions')
      .select('id, plan_id, current_period_end')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub) { res.status(404).json({ error: 'subscription_not_found' }); return; }

    // Write audit entry FIRST (Req 11.3)
    await writeAuditEntry(serviceClient, sub.id, 'cancellation', sub.plan_id, sub.plan_id, 'user');

    // Set status=cancelled, schedule downgrade to free at period end
    await serviceClient.database
      .from('subscriptions')
      .update({
        status: 'cancelled',
        scheduled_plan_id: 'free',
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    res.json({ success: true, access_until: sub.current_period_end });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING API
// Requirements: 1.6, 1.7, 1.9, 2.4, 2.5, 2.11, 3.8
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/onboarding/step — persist step data
 */
app.post('/api/onboarding/step', async (req: express.Request, res: express.Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }

  const { step, data } = req.body;
  if (!step || step < 1 || step > 5 || !data) {
    res.status(400).json({ error: 'validation', message: 'step must be 1–5 and data is required' });
    return;
  }

  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    // Fetch current step_data via pgPool to bypass RLS
    const resUser = await pgPool.query(
      'SELECT onboarding_step_data FROM users WHERE id = $1',
      [userId]
    );

    const user = resUser.rows[0];
    const currentStepData = (user?.onboarding_step_data as Record<string, any>) || {};
    currentStepData[String(step)] = data;

    await pgPool.query(
      'UPDATE users SET onboarding_step = $1, onboarding_step_data = $2 WHERE id = $3',
      [step, JSON.stringify(currentStepData), userId]
    );

    res.json({ success: true, step });
  } catch (err: any) {
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * GET /api/onboarding/status — return current wizard state
 */
app.get('/api/onboarding/status', async (req: express.Request, res: express.Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    // Fetch onboarding status via pgPool to bypass RLS
    const resUser = await pgPool.query(
      'SELECT onboarding_completed, onboarding_step, onboarding_step_data FROM users WHERE id = $1',
      [userId]
    );

    const user = resUser.rows[0];
    res.json({
      completed: user?.onboarding_completed ?? false,
      currentStep: user?.onboarding_step ?? 0,
      stepData: user?.onboarding_step_data ?? {},
    });
  } catch (err: any) {
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * POST /api/onboarding/complete — finalize wizard
 */
app.post('/api/onboarding/complete', async (req: express.Request, res: express.Response) => {
  const userId = getUserIdFromRequest(req);
  const tenantId = getTenantIdFromRequest(req);
  if (!userId || !tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const now = new Date().toISOString();

    // Update user onboarding state via pgPool to bypass RLS
    await pgPool.query(
      'UPDATE users SET onboarding_completed = true, onboarding_completed_at = $1 WHERE id = $2',
      [now, userId]
    );

    // Apply plan from step 3 if provided
    const { planId } = req.body;
    if (planId && planId !== 'free') {
      if (planId === 'trial') {
        // Check if trial already used via pgPool
        const resSub = await pgPool.query(
          'SELECT trial_used_at FROM subscriptions WHERE tenant_id = $1',
          [tenantId]
        );
        const sub = resSub.rows[0];
        if (!sub?.trial_used_at) {
          const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
          await pgPool.query(
            `UPDATE subscriptions SET plan_id = 'business', status = 'trialing', 
             trial_ends_at = $1, trial_used_at = $2 WHERE tenant_id = $3`,
            [trialEnd, now, tenantId]
          );
        }
      } else {
        const validPlans = ['starter', 'business', 'enterprise'];
        if (validPlans.includes(planId)) {
          const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await pgPool.query(
            `UPDATE subscriptions SET plan_id = $1, status = 'active', 
             current_period_start = $2, current_period_end = $3 WHERE tenant_id = $4`,
            [planId, now, periodEnd, tenantId]
          );
        }
      }
    }

    res.json({ success: true, onboarding_completed_at: now });
  } catch (err: any) {
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * GET /api/usage — returns current tenant usage summary (auth-guarded)
 * Requirements: 5.5, 8.2
 */
app.get('/api/usage', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const summary = await getUsageSummary(tenantId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN API (/api/admin/*)
// Solo accesible por etebachalegroup@gmail.com (role = 'admin')
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper to log system events and errors into database
 */
async function logEvent(
  level: 'info' | 'warning' | 'error' | 'debug',
  component: 'auth' | 'catalog' | 'connector' | 'ai_query' | 'system' | 'billing' | 'webhook',
  message: string,
  details: any = null,
  tenantId: string | null = null
): Promise<void> {
  try {
    await pgPool.query(`
      INSERT INTO platform_logs (level, component, message, details, tenant_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [level, component, message, details ? JSON.stringify(details) : null, tenantId]);
  } catch (err: any) {
    console.error('[Logger Error] Falló el registro de log en BD:', err.message);
  }
}

/**
 * GET /api/admin/logs — lista de logs de sistema de la plataforma
 */
app.get('/api/admin/logs', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const level = req.query.level as string || '';
    const component = req.query.component as string || '';

    const clauses: string[] = [];
    const params: any[] = [limit, offset];

    if (level) {
      clauses.push(`level = $${params.length + 1}`);
      params.push(level);
    }
    if (component) {
      clauses.push(`component = $${params.length + 1}`);
      params.push(component);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    
    const r = await pgPool.query(`
      SELECT l.*, c.name as company_name
      FROM platform_logs l
      LEFT JOIN companies c ON c.id = l.tenant_id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams = params.slice(2);
    const countClauses = clauses.map((c, i) => c.replace(`$${i + 3}`, `$${i + 1}`));
    const countWhere = countClauses.length > 0 ? `WHERE ${countClauses.join(' AND ')}` : '';
    
    const rCount = await pgPool.query(`
      SELECT COUNT(*) as total FROM platform_logs
      ${countWhere}
    `, countParams);

    res.json({
      logs: r.rows,
      total: parseInt(rCount.rows[0].total),
      page,
      limit
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Middleware que verifica que el token del request tenga role === 'admin' */
function requireSuperAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const auth = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
  const payload = verifyToken(auth) ?? decodeLegacyToken(auth);
  if (!payload || payload.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'Solo el Super Admin puede acceder a este recurso.' });
    return;
  }
  next();
}

/**
 * GET /api/admin/stats — estadísticas globales de la plataforma
 */
app.get('/api/admin/stats', requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
  try {
    res.set('Cache-Control', 'no-store');

    // Total de empresas/tenants
    const rCompanies = await pgPool.query(`SELECT COUNT(*) as total FROM companies`);

    // Usuarios totales registrados
    const rUsers = await pgPool.query(`SELECT COUNT(*) as total FROM users`);

    // Suscripciones activas por plan con sus precios mensuales reales para calcular el MRR dinámico
    const rPlans = await pgPool.query(`
      SELECT s.plan_id, s.status, COUNT(*) as count, COALESCE(MAX(p.price_monthly_usd), 0) as price_monthly
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      GROUP BY s.plan_id, s.status
      ORDER BY count DESC
    `);

    // Empresas nuevas en los últimos 30 días
    const rNew = await pgPool.query(`
      SELECT COUNT(*) as total FROM companies
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // Uso total de IA (consultas) del mes actual
    const rUsage = await pgPool.query(`
      SELECT COALESCE(SUM(query_count), 0) as total_queries
      FROM usage_monthly
      WHERE period_year = EXTRACT(YEAR FROM NOW())::INTEGER AND period_month = EXTRACT(MONTH FROM NOW())::INTEGER
    `);

    // Calcular MRR estimado basado en planes y precios dinámicos (en FCFA)
    let mrr = 0;
    for (const row of rPlans.rows) {
      if (row.status === 'active') {
        mrr += parseFloat(row.price_monthly || 0) * parseInt(row.count);
      }
    }

    res.json({
      total_companies: parseInt(rCompanies.rows[0].total),
      total_users: parseInt(rUsers.rows[0].total),
      new_companies_30d: parseInt(rNew.rows[0].total),
      total_queries_this_month: parseInt(rUsage.rows[0].total_queries),
      mrr_estimated: mrr,
      plan_breakdown: rPlans.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/tenants — lista de todos los tenants con su suscripción
 */
app.get('/api/admin/tenants', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';

    const searchClause = search ? `AND (c.name ILIKE $3 OR u.email ILIKE $3)` : '';
    const params: any[] = [limit, offset];
    if (search) params.push(`%${search}%`);

    const r = await pgPool.query(`
      SELECT 
        c.id as tenant_id,
        c.name as company_name,
        c.created_at,
        u.email as owner_email,
        u.name as owner_name,
        u.avatar_url,
        s.plan_id,
        s.status as subscription_status,
        s.current_period_end,
        s.trial_ends_at,
        COALESCE(um.query_count, 0) as queries_this_month
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      LEFT JOIN subscriptions s ON s.tenant_id = c.id
      LEFT JOIN usage_monthly um ON um.tenant_id = c.id AND um.period_year = EXTRACT(YEAR FROM NOW())::INTEGER AND um.period_month = EXTRACT(MONTH FROM NOW())::INTEGER
      WHERE 1=1 ${searchClause}
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const rCount = await pgPool.query(
      `SELECT COUNT(*) as total FROM companies c LEFT JOIN users u ON u.id = c.owner_id WHERE 1=1 ${search ? 'AND (c.name ILIKE $1 OR u.email ILIKE $1)' : ''}`,
      search ? [`%${search}%`] : []
    );

    res.json({
      tenants: r.rows,
      total: parseInt(rCount.rows[0].total),
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/tenant/:id — detalle de un tenant específico
 */
app.get('/api/admin/tenant/:id', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  try {
    res.set('Cache-Control', 'no-store');
    const r = await pgPool.query(`
      SELECT 
        c.id as tenant_id, c.name as company_name, c.created_at,
        u.email as owner_email, u.name as owner_name, u.avatar_url,
        s.plan_id, s.status, s.current_period_start, s.current_period_end, s.trial_ends_at,
        COALESCE(um.query_count, 0) as queries_this_month,
        COALESCE(um.ingest_count, 0) as ingests_this_month
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      LEFT JOIN subscriptions s ON s.tenant_id = c.id
      LEFT JOIN usage_monthly um ON um.tenant_id = c.id AND um.period_year = EXTRACT(YEAR FROM NOW())::INTEGER AND um.period_month = EXTRACT(MONTH FROM NOW())::INTEGER
      WHERE c.id = $1
    `, [id]);

    if (!r.rows[0]) { res.status(404).json({ error: 'Tenant no encontrado' }); return; }
    res.json({ tenant: r.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/tenant/:id/plan — cambiar el plan de un tenant
 */
app.patch('/api/admin/tenant/:id/plan', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  const id = req.params.id as string;
  const { plan_id, status } = req.body;
  const validPlans = ['free', 'starter', 'business', 'enterprise'];
  const validStatuses = ['active', 'cancelled', 'trialing', 'past_due'];

  if (!plan_id || !validPlans.includes(plan_id)) {
    res.status(400).json({ error: 'plan_id inválido', valid: validPlans }); return;
  }

  try {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const newStatus = validStatuses.includes(status) ? status : 'active';

    await pgPool.query(`
      UPDATE subscriptions SET
        plan_id = $1,
        status = $2,
        current_period_start = $3,
        current_period_end = $4,
        updated_at = $5
      WHERE tenant_id = $6
    `, [plan_id, newStatus, now, periodEnd, now, id]);

    logEvent('info', 'billing', `Suscripción de empresa modificada por Super Admin: plan: ${plan_id}, estado: ${newStatus}`, { plan_id, status: newStatus }, id);
    res.json({ success: true, tenant_id: id, plan_id, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/plan/:id — editar límites y precios de un plan específico
 */
app.patch('/api/admin/plan/:id', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { 
    monthly_query_limit, 
    product_limit, 
    connector_limit, 
    api_key_limit, 
    price_monthly_usd, 
    price_yearly_usd,
    features 
  } = req.body;

  try {
    const limits = {
      monthly_query_limit: monthly_query_limit === null || monthly_query_limit === '' ? null : parseInt(monthly_query_limit),
      product_limit: product_limit === null || product_limit === '' ? null : parseInt(product_limit),
      connector_limit: parseInt(connector_limit) || 1,
      api_key_limit: api_key_limit === null || api_key_limit === '' ? null : parseInt(api_key_limit),
      price_monthly_usd: parseFloat(price_monthly_usd) || 0,
      price_yearly_usd: parseFloat(price_yearly_usd) || 0
    };

    let query = `
      UPDATE plans SET
        monthly_query_limit = $1,
        product_limit = $2,
        connector_limit = $3,
        api_key_limit = $4,
        price_monthly_usd = $5,
        price_yearly_usd = $6
    `;
    const params: any[] = [
      limits.monthly_query_limit,
      limits.product_limit,
      limits.connector_limit,
      limits.api_key_limit,
      limits.price_monthly_usd,
      limits.price_yearly_usd
    ];

    if (features !== undefined) {
      query += `, features = $7`;
      params.push(Array.isArray(features) ? JSON.stringify(features) : features);
    }

    query += ` WHERE id = $${params.length + 1}`;
    params.push(id);

    await pgPool.query(query, params);
    logEvent('warning', 'system', `Límites de plan '${id}' modificados por Super Admin`, { limits });
    res.json({ success: true, plan_id: id, limits });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/tenant/:id/reset-usage — resetear consumo del mes actual para una empresa
 */
app.post('/api/admin/tenant/:id/reset-usage', requireSuperAdmin, async (req: express.Request, res: express.Response) => {
  const id = req.params.id as string;
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Reset usage count for current period to 0
    await pgPool.query(`
      INSERT INTO usage_monthly (tenant_id, period_year, period_month, query_count, product_count, connector_count, api_key_count, updated_at)
      VALUES ($1, $2, $3, 0, 0, 0, 0, NOW())
      ON CONFLICT (tenant_id, period_year, period_month)
      DO UPDATE SET 
        query_count = 0,
        updated_at = NOW()
    `, [id, year, month]);

    logEvent('warning', 'billing', `Consumo de IA restablecido a 0 para el mes actual por Super Admin`, null, id);
    res.json({ success: true, tenant_id: id, message: 'Consumo de consultas restablecido a 0 para el mes actual.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/subscriptions — resumen de todas las suscripciones
 */
app.get('/api/admin/subscriptions', requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    const r = await pgPool.query(`
      SELECT
        s.tenant_id,
        c.name as company_name,
        u.email as owner_email,
        s.plan_id,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.trial_ends_at,
        s.updated_at
      FROM subscriptions s
      LEFT JOIN companies c ON c.id = s.tenant_id
      LEFT JOIN users u ON u.id = c.owner_id
      ORDER BY s.updated_at DESC
    `);
    res.json({ subscriptions: r.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/plans — lista de planes configurados
 */
app.get('/api/admin/plans', requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    const r = await pgPool.query(`SELECT * FROM plans ORDER BY monthly_query_limit ASC NULLS LAST`);
    res.json({ plans: r.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Levantar el servidor

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor Antigravity RAG levantado con éxito.`);
  console.log(`👉 Visita: http://localhost:${PORT}`);
  console.log(`📌 Groq: ${process.env.GROQ_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`📌 OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`======================================================\n`);
});

// Run background jobs every hour
setInterval(async () => {
  try { await checkTrialExpirations(); } catch (e) { console.error('Trial expiry job error:', e); }
  try { await applyScheduledDowngrades(); } catch (e) { console.error('Downgrade scheduler error:', e); }
  try { await checkPastDueDowngrades(); } catch (e) { console.error('Past due downgrade error:', e); }
  try { await sendDowngradeWarnings(); } catch (e) { console.error('Downgrade warnings error:', e); }
}, 60 * 60 * 1000); // every hour

// Run background logs cleanup every 24 hours
setInterval(async () => {
  try { await runDeliveryLogsCleanup(); } catch (e) { console.error('Delivery logs cleanup job error:', e); }
}, 24 * 60 * 60 * 1000); // every 24 hours
