import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@insforge/sdk';
import { hybridQuery } from './router.js';
import { ingestKnowledge } from './ingest.js';

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
  const { tenantId, prompt } = req.body;

  if (!tenantId || !prompt) {
    res.status(400).json({ error: 'Faltan parámetros obligatorios: tenantId o prompt.' });
    return;
  }

  try {
    const results = await hybridQuery(tenantId, prompt);
    res.json(results);
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
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ orders: data || [] });
  } catch (err: any) {
    res.json({ orders: [] });
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

    // Guardar/actualizar usuario en InsForge (tabla users)
    const { data: existingUser } = await insforge.database
      .from('users')
      .select('id')
      .eq('google_id', profile.id)
      .maybeSingle();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      // Actualizar info
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

    // Crear un token simple (en producción usar JWT)
    const userPayload = {
      id: userId,
      email: profile.email,
      name: profile.name,
      avatar_url: profile.picture,
    };

    const token = Buffer.from(JSON.stringify(userPayload)).toString('base64url');

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

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
    res.json(payload);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
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
