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

// Wire health tracker → registry (idempotent if router already wired it)
healthTracker.setStatusChangeCallback(async (tenantId, status, error) => {
  await updateConnectorStatus(tenantId, status, error);
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
app.post('/api/query', async (req: express.Request, res: express.Response) => {
  const { tenantId, prompt, user } = req.body;

  if (!tenantId || !prompt) {
    res.status(400).json({ error: 'Faltan parámetros obligatorios: tenantId o prompt.' });
    return;
  }

  try {
    const userId = user?.id || user?.email || undefined;
    const results = await hybridQuery(tenantId, prompt, userId);
    res.json(results);

    // Fire-and-forget: track query in query_counts (non-blocking)
    Promise.resolve(
      insforge.database
        .from('query_counts')
        .insert([{ tenant_id: tenantId, query_text: prompt, user_id: userId, created_at: new Date().toISOString() }])
    ).then(() => {}).catch(() => {});
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
app.post('/api/catalog', async (req: express.Request, res: express.Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al agregar producto' });
  }
});

/**
 * API Endpoint para importar productos en bulk al catálogo
 * POST /api/catalog/bulk
 * Body: { tenantId, products: Array<{ name, description?, price, stock?, image_url? }> }
 */
app.post('/api/catalog/bulk', async (req: express.Request, res: express.Response) => {
  const { tenantId, products } = req.body;

  if (!tenantId) {
    res.status(400).json({ error: 'Falta tenantId' });
    return;
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    res.status(400).json({ error: 'No hay productos para importar' });
    return;
  }

  try {
    const { data, error } = await insforge.database
      .from('products')
      .insert(products.map((p: any) => ({ tenant_id: tenantId, ...p })))
      .select();

    if (error) throw error;
    res.json({ success: true, inserted: data?.length || products.length });
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
app.post('/api/keys/generate', async (req: express.Request, res: express.Response) => {
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
    const { data: userByEmail } = await insforge.database
      .from('users')
      .select('id, email, google_id')
      .eq('email', profile.email)
      .maybeSingle();

    if (userByEmail) {
      existingUser = userByEmail;
      // Si no tenía google_id (fue creado desde otro sistema), vincularlo
      if (!userByEmail.google_id) {
        await insforge.database
          .from('users')
          .update({ google_id: profile.id, avatar_url: profile.picture, updated_at: new Date().toISOString() })
          .eq('id', userByEmail.id);
      }
    } else {
      // Buscar por google_id como fallback
      const { data: userByGoogle } = await insforge.database
        .from('users')
        .select('id, email, google_id')
        .eq('google_id', profile.id)
        .maybeSingle();
      existingUser = userByGoogle;
    }

    let userId: string;
    let userRole = 'user';
    let linkedTenantId: string | null = null;

    if (existingUser) {
      userId = existingUser.id;
      await insforge.database
        .from('users')
        .update({ name: profile.name, email: profile.email, avatar_url: profile.picture, updated_at: new Date().toISOString() })
        .eq('id', userId);
    } else {
      // Crear nuevo usuario
      const { data: newUser, error } = await insforge.database
        .from('users')
        .insert([{
          google_id: profile.id,
          email: profile.email,
          name: profile.name,
          avatar_url: profile.picture,
        }])
        .select()
        .single();

      if (error || !newUser) {
        res.status(500).send('Error al crear usuario');
        return;
      }
      userId = newUser.id;

      // Crear company asociada al nuevo usuario
      await insforge.database
        .from('companies')
        .insert([{ id: userId, name: profile.name, owner_id: userId }]);
    }

    // ─── Verificar si el email es owner de algún negocio/tenant ────────────
    // Mapeo de emails de administradores a sus tenant IDs
    const businessOwners: Record<string, { tenantId: string; role: string }> = {
      'rotterinzakus@gmail.com': { tenantId: 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b', role: 'admin' },
    };

    if (businessOwners[profile.email]) {
      userRole = businessOwners[profile.email].role;
      linkedTenantId = businessOwners[profile.email].tenantId;
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

    // Redirigir al frontend con el token
    res.redirect(`/?auth_token=${token}`);
  } catch (err: any) {
    console.error('❌ Error en Google OAuth callback:', err);
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
app.post('/api/connectors', async (req: express.Request, res: express.Response) => {
  const tenantId = getTenantIdFromRequest(req);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const config = await createConnector(tenantId, req.body);
    res.status(201).json({ connector: config });
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

// Levantar el servidor
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor Antigravity RAG levantado con éxito.`);
  console.log(`👉 Visita: http://localhost:${PORT}`);
  console.log(`📌 Groq: ${process.env.GROQ_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`📌 OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`======================================================\n`);
});
