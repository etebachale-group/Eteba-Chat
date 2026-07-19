import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import { getExtractor } from './ingest.js';
import pg from 'pg';

// ─── Tenant Data Connectors ────────────────────────────────────────────────────
import { connectorCache } from './connector-cache.js';
import { getConnectorRaw } from './connector-registry.js';
import { proxyDispatcher } from './proxy-dispatcher.js';
import { healthTracker } from './health-tracker.js';
import { rateLimiter } from './rate-limiter.js';
import { mapIntentToAction, getBusinessTypeKeywords, getSystemPromptInstructions } from './intent-mapper.js';
import { updateConnectorStatus } from './connector-registry.js';

// Wire health tracker callback once at module load
healthTracker.setStatusChangeCallback(async (tenantId, status, error) => {
  await updateConnectorStatus(tenantId, status, error);
});

// Startup validation for Rotteri env-var config (Req 13.4)
if (process.env.ROTTERI_PROXY_URL && !process.env.ROTTERI_PROXY_TOKEN) {
  console.warn('⚠️  ROTTERI_PROXY_URL is set but ROTTERI_PROXY_TOKEN is missing. Rotteri requests will be rejected.');
}

/**
 * Tries to dispatch a query to the tenant's configured external connector.
 * Returns proxy results, or null if no active connector exists or dispatch fails.
 * Implements Requirements 8.1–8.7, 13.1–13.5
 */
async function tryConnectorDispatch(tenantId: string, userQuery: string, decision: { type: string; term: string }): Promise<{ results: any[]; humanContext: string } | null> {
  const rotteriTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';

  // 1. Check in-memory cache first
  let config = connectorCache.get(tenantId);

  // 2. If not cached, try DB registry
  if (!config) {
    try {
      config = await getConnectorRaw(tenantId);
      if (config) connectorCache.set(tenantId, config);
    } catch {
      config = null;
    }
  }

  // 3. Rotteri env-var fallback (Req 13.1, 13.2)
  if (!config && tenantId === rotteriTenantId) {
    const proxyUrl = process.env.ROTTERI_PROXY_URL;
    const proxyToken = process.env.ROTTERI_PROXY_TOKEN;
    if (proxyUrl && proxyToken) {
      // Synthesize a minimal config for the dispatcher
      config = {
        id: 'rotteri-env',
        tenant_id: tenantId,
        proxy_url: proxyUrl,
        connector_token: proxyToken,
        business_type: 'ecommerce',
        display_name: 'Rotteri (env)',
        enabled: true,
        status: 'active',
        failure_count: 0,
        last_error: null,
        last_error_at: null,
        created_at: '',
        updated_at: '',
      };
    } else if (proxyUrl && !proxyToken) {
      // Req 13.4: URL set but token missing → reject
      console.warn(`⚠️ Rotteri connector config incomplete (missing token). Rejecting proxy dispatch.`);
      return null;
    }
  }

  // 4. No connector available → fall back
  if (!config || !config.enabled || config.status === 'error') return null;

  // 5. Rate limiting (Req 11.5, 11.6)
  if (!rateLimiter.isAllowed(tenantId)) {
    const retryAfter = rateLimiter.getRetryAfter(tenantId);
    console.warn(`⚡ Rate limit exceeded for tenant ${tenantId}. Retry after ${retryAfter}s`);
    return null;
  }
  rateLimiter.record(tenantId);

  // 6. Map intent to action (Req 8.7) - Pass the clean decision.term instead of raw query
  const cleanTerm = decision.term;
  let { action, params } = mapIntentToAction(decision.type, config.business_type, cleanTerm);
  console.log(`🔗 Connector dispatch | tenant: ${tenantId} | action: ${action} | term: "${params.term || ''}"`);

  // 7. Dispatch
  let proxyResponse = await proxyDispatcher.dispatch(config, { action, params });

  if (proxyResponse.error) {
    await healthTracker.recordFailure(tenantId, proxyResponse.error);
    return null; // Fall back to Postgres
  }

  healthTracker.recordSuccess(tenantId);
  let results = Array.isArray(proxyResponse.data) ? proxyResponse.data : (proxyResponse.data ? [proxyResponse.data] : []);

  // 8. Synonym fallback if initial product search is empty
  if ((action === 'search_products' || action === 'search') && results.length === 0 && cleanTerm) {
    const expanded = expandSearchTerms(cleanTerm);
    const synonymsToTry = expanded.filter(t => t !== cleanTerm.toLowerCase().trim()).slice(0, 3);
    
    for (const synonym of synonymsToTry) {
      console.log(`🔍 Intentando con sinónimo/variante en conector: "${synonym}"`);
      const retryParams = { ...params, term: synonym };
      const retryResponse = await proxyDispatcher.dispatch(config, { action, params: retryParams });
      
      if (!retryResponse.error) {
        const retryResults = Array.isArray(retryResponse.data) ? retryResponse.data : (retryResponse.data ? [retryResponse.data] : []);
        if (retryResults.length > 0) {
          results = retryResults;
          console.log(`✅ ¡Éxito! Encontrados ${results.length} producto(s) usando "${synonym}"`);
          break;
        }
      }
    }
  }

  return { results, humanContext: getSystemPromptInstructions(config.business_type) };
}

const { Pool } = pg;

// 1. Validar variables de entorno clave
const databaseUrl = process.env.DATABASE_URL;
const groqKey = process.env.GROQ_API_KEY || '';
const openrouterKey = process.env.OPENROUTER_API_KEY || '';
const baseUrl = process.env.INSFORGE_BASE_URL;
const apiKey = process.env.INSFORGE_API_KEY;

if (!databaseUrl || !baseUrl || !apiKey) {
  console.error('❌ Error: Configuración incompleta en .env.local');
  process.exit(1);
}

if (!groqKey && !openrouterKey) {
  console.error('❌ Error: Se necesita GROQ_API_KEY o OPENROUTER_API_KEY');
  process.exit(1);
}

// 2. Inicializar pools de base de datos
const pgPool = new Pool({ connectionString: databaseUrl });
const insforge = createClient({ baseUrl, anonKey: apiKey });

// Modo de conexión MySQL:
// - LOCAL (desarrollo): pool directo a MySQL en localhost
// - PRODUCCIÓN (Railway): proxy PHP en rotteri.com via HTTPS
const ROTTERI_PROXY_URL = process.env.ROTTERI_PROXY_URL || null;
const ROTTERI_PROXY_TOKEN = process.env.ROTTERI_PROXY_TOKEN || '';

let mysqlPool: any = null;

// Inicialización lazy del pool MySQL (solo en modo local, sin top-level await)
async function getMysqlPool(): Promise<any> {
  if (mysqlPool) return mysqlPool;
  if (ROTTERI_PROXY_URL) return null; // En producción no se usa pool directo

  const mysqlModule = await import('mysql2/promise');
  const mysql = (mysqlModule as any).default || mysqlModule;
  mysqlPool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'rotteri_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  console.log('🔌 Modo LOCAL: conexión directa a MySQL en localhost');
  return mysqlPool;
}

if (!ROTTERI_PROXY_URL) {
  console.log('🔌 Modo LOCAL: MySQL se inicializará al primer uso.');
} else {
  console.log(`🌐 Modo PRODUCCIÓN: usando proxy PHP en ${ROTTERI_PROXY_URL}`);
}

// ─── SISTEMA DE ALIAS Y RELACIONES DE PRODUCTOS ────────────────────────────────
// Mapea nombres coloquiales, traducciones, sinónimos y descripciones alternativas
// a términos de búsqueda que el catálogo realmente tiene.
// Se auto-enriquece con cada interacción exitosa.

const productAliases: Record<string, string[]> = {
  // ═══ CALZADO (ES/FR/EN) ═══
  'tenis': ['zapatilla', 'sneaker', 'chaussure sport', 'basket'],
  'deportivas': ['zapatilla', 'sneaker', 'basket', 'sport'],
  'zapato deportivo': ['zapatilla', 'sneaker', 'basket'],
  'bambas': ['zapatilla', 'sneaker'],
  'championes': ['zapatilla', 'sneaker'],
  'chaussure': ['zapato', 'zapatilla', 'shoe', 'calzado'],
  'chaussures': ['zapato', 'zapatilla', 'shoe', 'calzado'],
  'basket': ['zapatilla', 'sneaker', 'deportiva'],
  'baskets': ['zapatilla', 'sneaker', 'deportiva'],
  'shoe': ['zapato', 'zapatilla', 'chaussure'],
  'shoes': ['zapato', 'zapatilla', 'chaussure'],
  'sneaker': ['zapatilla', 'basket', 'tenis'],
  'sneakers': ['zapatilla', 'basket', 'tenis'],
  'nike': ['air force', 'basket', 'zapatilla', 'sneaker'],
  'adidas': ['basket', 'zapatilla', 'sneaker', 'superstar'],
  'puma': ['basket', 'zapatilla', 'sneaker'],
  'sandal': ['sandalia', 'sandale', 'chancla'],
  'sandale': ['sandalia', 'sandal', 'chancla'],
  'sandalia': ['sandal', 'sandale', 'chancla'],
  'chancla': ['sandalia', 'sandale', 'flip flop'],
  'tacones': ['zapato', 'talon', 'heel', 'escarpin'],
  'talon': ['tacón', 'heel', 'escarpin'],
  'heel': ['tacón', 'talon', 'escarpin'],
  'botte': ['bota', 'boot'],
  'boot': ['bota', 'botte'],
  'bota': ['boot', 'botte'],
  
  // ═══ PELUCAS / CABELLO (ES/FR/EN) ═══
  'pelo': ['peluca', 'wig', 'perruque', 'cheveux', 'cabello'],
  'cabello': ['peluca', 'wig', 'perruque', 'cheveux', 'hair'],
  'hair': ['peluca', 'wig', 'perruque', 'cheveux', 'cabello'],
  'cheveux': ['peluca', 'wig', 'perruque', 'hair', 'cabello'],
  'perruque': ['peluca', 'wig', 'hair'],
  'peluca': ['wig', 'perruque'],
  'wig': ['peluca', 'perruque'],
  'extensiones': ['extension', 'peluca', 'wig', 'rajout'],
  'extension': ['extensiones', 'peluca', 'rajout'],
  'rajout': ['extensiones', 'extension', 'peluca'],
  'lace': ['peluca', 'lace frontal', 'frontal', 'perruque'],
  'frontal': ['peluca', 'lace', 'lace frontal'],
  'postizo': ['peluca', 'wig', 'perruque'],
  'trenzas': ['peluca', 'tresse', 'braid'],
  'tresse': ['trenza', 'braid', 'peluca'],
  'braid': ['trenza', 'tresse', 'peluca'],
  'naturelle': ['natural', 'peluca natural', 'wig'],
  
  // ═══ ELECTRÓNICA / AUDIO (ES/FR/EN) ═══
  'cascos': ['auricular', 'headphone', 'écouteur', 'casque'],
  'audífonos': ['auricular', 'headphone', 'écouteur', 'earphone'],
  'auricular': ['headphone', 'écouteur', 'casque', 'earphone'],
  'auriculares': ['headphone', 'écouteur', 'casque', 'earphone'],
  'écouteur': ['auricular', 'headphone', 'earphone'],
  'écouteurs': ['auricular', 'headphone', 'earphone'],
  'casque': ['auricular', 'headphone', 'cascos'],
  'headphone': ['auricular', 'casque', 'écouteur'],
  'headphones': ['auricular', 'casque', 'écouteur'],
  'earbuds': ['auricular', 'tws', 'écouteur', 'bluetooth'],
  'inalámbricos': ['wireless', 'sans fil', 'bluetooth', 'tws'],
  'wireless': ['inalámbrico', 'sans fil', 'bluetooth'],
  'sans fil': ['inalámbrico', 'wireless', 'bluetooth'],
  'bluetooth': ['inalámbrico', 'wireless', 'sans fil', 'tws'],
  'bocina': ['altavoz', 'speaker', 'enceinte', 'parlante'],
  'enceinte': ['altavoz', 'speaker', 'bocina', 'parlante'],
  'speaker': ['altavoz', 'enceinte', 'bocina'],
  'parlante': ['altavoz', 'speaker', 'enceinte'],
  'micro': ['micrófono', 'mic', 'microphone'],
  'micrófono': ['mic', 'microphone', 'micro'],
  'microphone': ['micrófono', 'mic', 'micro'],
  
  // ═══ ROPA (ES/FR/EN) ═══
  'camiseta': ['camisa', 'shirt', 't-shirt', 'polo', 'maillot', 'tee'],
  'playera': ['camisa', 'camiseta', 't-shirt', 'maillot'],
  'chemise': ['camisa', 'shirt', 'blusa'],
  'shirt': ['camisa', 'chemise', 'camiseta'],
  'maillot': ['camiseta', 'jersey', 'shirt'],
  'polo': ['camisa', 'polo', 'shirt'],
  'pantalón': ['pantalon', 'pants', 'trousers'],
  'pantalon': ['pantalón', 'pants', 'trousers'],
  'pants': ['pantalón', 'pantalon', 'trousers'],
  'jean': ['pantalón', 'vaquero', 'denim', 'jeans'],
  'jeans': ['pantalón', 'vaquero', 'denim', 'jean'],
  'short': ['pantalón corto', 'bermuda', 'short'],
  'bermuda': ['short', 'pantalón corto'],
  'sudadera': ['hoodie', 'suéter', 'buzo', 'sweat'],
  'hoodie': ['sudadera', 'capucha', 'buzo', 'sweat'],
  'sweat': ['sudadera', 'hoodie', 'buzo'],
  'veste': ['chaqueta', 'jacket', 'cazadora'],
  'jacket': ['chaqueta', 'veste', 'chamarra'],
  'chaqueta': ['jacket', 'veste', 'chamarra'],
  'robe': ['vestido', 'dress'],
  'dress': ['vestido', 'robe'],
  'vestido': ['dress', 'robe'],
  'jupe': ['falda', 'skirt'],
  'skirt': ['falda', 'jupe'],
  'falda': ['skirt', 'jupe'],
  
  // ═══ ACCESORIOS (ES/FR/EN) ═══
  'montre': ['reloj', 'watch'],
  'watch': ['reloj', 'montre'],
  'reloj': ['watch', 'montre'],
  'smartwatch': ['reloj inteligente', 'montre connectée'],
  'lunettes': ['gafas', 'lentes', 'glasses'],
  'glasses': ['gafas', 'lentes', 'lunettes'],
  'gafas': ['glasses', 'lunettes', 'lentes'],
  'lentes': ['gafas', 'glasses', 'lunettes'],
  'sac': ['bolso', 'bag', 'cartera', 'mochila'],
  'bag': ['bolso', 'sac', 'cartera'],
  'bolso': ['bag', 'sac', 'cartera'],
  'backpack': ['mochila', 'sac à dos'],
  'mochila': ['backpack', 'sac à dos'],
  'bijou': ['joya', 'jewelry', 'bijoux'],
  'jewelry': ['joya', 'bijou', 'bijoux'],
  'joya': ['jewelry', 'bijou'],
  'collier': ['collar', 'necklace'],
  'necklace': ['collar', 'collier'],
  'collar': ['necklace', 'collier'],
  'bracelet': ['pulsera', 'bracelet'],
  'pulsera': ['bracelet'],
  'bague': ['anillo', 'ring'],
  'ring': ['anillo', 'bague'],
  'anillo': ['ring', 'bague'],
  'ceinture': ['cinturón', 'belt'],
  'belt': ['cinturón', 'ceinture'],
  'cinturón': ['belt', 'ceinture'],
  'funda': ['case', 'carcasa', 'coque', 'protector'],
  'coque': ['funda', 'case', 'carcasa'],
  'case': ['funda', 'coque', 'carcasa'],
  
  // ═══ BELLEZA / COSMÉTICOS (ES/FR/EN) ═══
  'crema': ['cream', 'crème', 'moisturizer'],
  'crème': ['crema', 'cream', 'moisturizer'],
  'cream': ['crema', 'crème'],
  'parfum': ['perfume', 'fragrance', 'cologne'],
  'perfume': ['parfum', 'fragrance', 'cologne'],
  'fragrance': ['perfume', 'parfum'],
  'maquillaje': ['makeup', 'maquillage', 'cosmético'],
  'maquillage': ['maquillaje', 'makeup', 'cosmético'],
  'makeup': ['maquillaje', 'maquillage'],
  'rouge à lèvres': ['labial', 'lipstick', 'pintalabios'],
  'lipstick': ['labial', 'rouge à lèvres'],
  'labial': ['lipstick', 'rouge à lèvres', 'gloss'],
  
  // ═══ TÉRMINOS GENÉRICOS / INTENCIONES ═══
  'algo bonito': ['moda', 'accesorio', 'ropa', 'tendencia'],
  'regalo': ['accesorio', 'perfume', 'joya', 'reloj', 'cadeau'],
  'cadeau': ['regalo', 'gift', 'accesorio'],
  'gift': ['regalo', 'cadeau'],
  'para mujer': ['mujer', 'dama', 'femenino', 'femme', 'women'],
  'femme': ['mujer', 'dama', 'women'],
  'women': ['mujer', 'femme', 'dama'],
  'para hombre': ['hombre', 'caballero', 'masculino', 'homme', 'men'],
  'homme': ['hombre', 'men', 'caballero'],
  'men': ['hombre', 'homme', 'caballero'],
  'barato': ['económico', 'oferta', 'pas cher', 'cheap'],
  'pas cher': ['barato', 'económico', 'cheap'],
  'cheap': ['barato', 'pas cher', 'económico'],
  'nouveau': ['nuevo', 'new', 'reciente'],
  'new': ['nuevo', 'nouveau', 'reciente'],
  'nuevo': ['new', 'nouveau', 'reciente'],
};

// Caché de alias aprendidos dinámicamente (se enriquece con cada búsqueda exitosa)
const learnedAliases: Map<string, Set<string>> = new Map();

/**
 * Expande un término de búsqueda con todos los alias conocidos.
 * "tenis" → ["tenis", "zapatilla", "sneaker", "zapato deportivo"]
 */
function expandSearchTerms(term: string): string[] {
  const lower = term.toLowerCase().trim();
  const expanded = new Set<string>([lower]);

  // Buscar en alias estáticos
  for (const [alias, targets] of Object.entries(productAliases)) {
    if (lower.includes(alias)) {
      targets.forEach(t => expanded.add(t));
    }
    // También buscar inverso: si el usuario dice un target, agregar el alias
    if (targets.some(t => lower.includes(t))) {
      expanded.add(alias);
    }
  }

  // Buscar en alias aprendidos
  for (const [key, values] of learnedAliases) {
    if (lower.includes(key)) {
      values.forEach(v => expanded.add(v));
    }
  }

  // Extraer palabras individuales si el término tiene más de una palabra
  const words = lower.split(/\s+/);
  words.forEach(word => {
    if (word.length > 3 && productAliases[word]) {
      productAliases[word].forEach(t => expanded.add(t));
    }
  });

  return Array.from(expanded);
}

/**
 * Aprende una relación nueva cuando una búsqueda tiene éxito.
 * Si el usuario buscó "tenis rojo" y encontró "Zapatilla Lacoste Roja",
 * se aprende que "tenis" → "zapatilla lacoste"
 */
function learnProductRelation(userTerm: string, foundProductName: string) {
  const key = userTerm.toLowerCase().trim().split(/\s+/)[0]; // primera palabra
  if (key.length < 3) return;
  
  const productWords = foundProductName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (productWords.length === 0) return;

  if (!learnedAliases.has(key)) {
    learnedAliases.set(key, new Set());
  }
  const aliases = learnedAliases.get(key)!;
  productWords.slice(0, 3).forEach(w => {
    if (w !== key) aliases.add(w);
  });

  // Limitar tamaño
  if (aliases.size > 15) {
    const arr = Array.from(aliases);
    learnedAliases.set(key, new Set(arr.slice(-10)));
  }
}


// 3. Caché de manual operativo en memoria (10 minutos)
const manualCache: { [tenantId: string]: { manual: string | null; timestamp: number } } = {};
const CACHE_TTL = 10 * 60 * 1000;

async function getCachedOperationalManual(tenantId: string): Promise<string | null> {
  const now = Date.now();
  if (manualCache[tenantId] && (now - manualCache[tenantId].timestamp) < CACHE_TTL) {
    return manualCache[tenantId].manual;
  }

  console.log(`🔒 Recuperando manual desde InsForge para: ${tenantId}...`);
  try {
    const { data: company } = await insforge.database
      .from('companies')
      .select('operational_manual')
      .eq('id', tenantId)
      .maybeSingle();

    const manual = company?.operational_manual || null;
    manualCache[tenantId] = { manual, timestamp: now };
    return manual;
  } catch (err) {
    console.error('⚠️ Error al consultar manual en InsForge:', err);
    return manualCache[tenantId]?.manual || null;
  }
}

// ─── MEMORIA DE CONVERSACIÓN ───────────────────────────────────────────────────
// Almacena últimos mensajes por sesión (tenant+ip simplificado como key)
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const conversationMemory: Map<string, ConversationMessage[]> = new Map();
const MEMORY_MAX_MESSAGES = 8; // últimos 8 mensajes (4 intercambios)
const MEMORY_TTL = 15 * 60 * 1000; // 15 min sin actividad = reset

function getConversationKey(tenantId: string, userId?: string): string {
  return `${tenantId}:${userId || 'anon'}`;
}

function getConversationHistory(key: string): ConversationMessage[] {
  const messages = conversationMemory.get(key) || [];
  const now = Date.now();
  // Limpiar si la última actividad fue hace más de 15 min
  if (messages.length > 0 && (now - messages[messages.length - 1].timestamp) > MEMORY_TTL) {
    conversationMemory.delete(key);
    return [];
  }
  return messages;
}

function addToConversation(key: string, role: 'user' | 'assistant', content: string) {
  if (!conversationMemory.has(key)) {
    conversationMemory.set(key, []);
  }
  const messages = conversationMemory.get(key)!;
  messages.push({ role, content: content.substring(0, 200), timestamp: Date.now() });
  // Mantener solo los últimos N mensajes
  if (messages.length > MEMORY_MAX_MESSAGES) {
    messages.splice(0, messages.length - MEMORY_MAX_MESSAGES);
  }
}

// ─── SISTEMA DE APRENDIZAJE (acierto/error) ────────────────────────────────────
// Patrones que el LLM ha fallado → se agregan como instrucciones negativas al prompt
const learningCache: Map<string, string[]> = new Map();

function getLearnings(tenantId: string): string {
  const lessons = learningCache.get(tenantId) || [];
  if (lessons.length === 0) return '';
  return `\nAPRENDIZAJES PREVIOS (evitar estos errores):\n${lessons.map(l => `- ${l}`).join('\n')}\n`;
}

function addLearning(tenantId: string, lesson: string) {
  if (!learningCache.has(tenantId)) {
    learningCache.set(tenantId, []);
  }
  const lessons = learningCache.get(tenantId)!;
  if (!lessons.includes(lesson)) {
    lessons.push(lesson);
    if (lessons.length > 10) lessons.shift(); // max 10 lecciones
  }
}

// 4. Cliente IA — Groq (primario) + OpenRouter (fallback)
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function callLLM(systemPrompt: string, userMessage: string, maxTokens: number = 300): Promise<string> {
  // 1. Intentar Groq (ultra-rápido, <1s)
  if (groqKey) {
    try {
      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (content) return content;
      } else {
        const errText = await resp.text();
        console.error(`❌ Groq error [${resp.status}]:`, errText.substring(0, 200));
      }
    } catch (err: any) {
      console.error('❌ Groq fetch error:', err.message);
    }
  }

  // 2. Fallback: OpenRouter
  if (openrouterKey) {
    try {
      console.log('⚠️ Usando fallback OpenRouter...');
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://eteba-chat.onrender.com',
          'X-Title': 'Eteba Chat',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.1-8b-instruct:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (content) return content;
      } else {
        const errText = await resp.text();
        console.error(`❌ OpenRouter error [${resp.status}]:`, errText.substring(0, 200));
      }
    } catch (err: any) {
      console.error('❌ OpenRouter fetch error:', err.message);
    }
  }

  return 'Disculpe, el servicio no está disponible en este momento. Intente más tarde.';
}

/**
 * Genera la respuesta del bot con memoria de contexto y aprendizaje
 */
async function generateHumanResponse(
  userQuery: string,
  retrievedData: any[],
  type: 'SQL' | 'SEMANTIC' | 'SALUDO_SOPORTE_GENERAL',
  operationalManual: string | null,
  conversationKey?: string,
  tenantId?: string
): Promise<string> {
  let contextString = '';
  if (type === 'SQL' && retrievedData.length > 0) {
    contextString = `DATOS:\n${JSON.stringify(retrievedData.slice(0, 8), null, 1)}`;
  } else if (type === 'SEMANTIC' && retrievedData.length > 0) {
    contextString = `INFO:\n${retrievedData.map((r: any, i: number) => `${i+1}. ${r.content}`).join('\n')}`;
  }

  const fallbackManual = `Eres un asistente de ventas amable y conciso. Hablas en español.`;
  const activeManual = operationalManual || fallbackManual;

  // Construir historial de conversación
  let historyString = '';
  if (conversationKey) {
    const history = getConversationHistory(conversationKey);
    if (history.length > 0) {
      historyString = `\nCONVERSACIÓN RECIENTE:\n${history.map(m => `${m.role === 'user' ? 'Cliente' : 'Tú'}: ${m.content}`).join('\n')}\n`;
    }
  }

  // Aprendizajes del tenant
  const learnings = tenantId ? getLearnings(tenantId) : '';

  const systemPrompt = `${activeManual}
${learnings}${contextString ? `\n${contextString}\n` : ''}${historyString}
ESTILO: Respuestas CORTAS y directas (1-3 frases). Usa el historial para entender el contexto sin pedir info que ya dieron. NO repitas saludos si ya saludaste. Sé natural como WhatsApp.`;

  const response = await callLLM(systemPrompt, userQuery, 200);

  // Guardar en memoria
  if (conversationKey) {
    addToConversation(conversationKey, 'user', userQuery);
    addToConversation(conversationKey, 'assistant', response);
  }

  // Detectar respuestas malas para aprendizaje
  if (tenantId && retrievedData.length > 0 && response.includes('no tenemos') && retrievedData.length > 0) {
    addLearning(tenantId, `Cuando hay productos en DATOS, NUNCA digas "no tenemos". Muestra los productos encontrados.`);
  }

  return response;
}

/**
 * Enrutador Heurístico Ultra-Rápido en TypeScript (Cero llamadas de clasificación a la API de LLM)
 * Clasifica la intención analizando patrones de texto locales en milisegundos.
 */
function classifyIntentHeuristically(query: string, history: ConversationMessage[] = []): { type: 'SALUDO_SOPORTE_GENERAL' | 'CATALOGO_SQL' | 'ENVIOS_SEMANTIC' | 'REGISTRO_PEDIDO' | 'TIENDAS' | 'ENVIO_CALCULO'; term: string } {
  const q = query.toLowerCase().trim();

  // 1. Detección de registro de pedidos
  const phonePattern = /(?:\+?240\s*)?[23569]\d{8}\b/;
  const isOrdering = q.includes('comprar') || q.includes('encargar') || q.includes('pedido') || q.includes('ordenar') || q.includes('mi nombre') || q.includes('llamo') || q.includes('confirmar');
  const orderClickPattern = /quiero\s+(encargar|comprar)\s+(el\s+)?producto/i;
  const isDirectOrderClick = orderClickPattern.test(q) || q.includes('encargar producto') || q.includes('quiero comprar');
  if (isDirectOrderClick || (phonePattern.test(q) && isOrdering)) {
    return { type: 'REGISTRO_PEDIDO', term: query };
  }

  // 1b. Confirmación de pedido pendiente (usuario dice "sí", ciudad, "confirmar", etc.)
  // Solo tratar como confirmación si el último mensaje del asistente le pedía confirmar datos o dirección de entrega
  const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
  const hasPendingOrderFlow = lastAssistantMsg && (
    lastAssistantMsg.content.toLowerCase().includes('enviar') || 
    lastAssistantMsg.content.toLowerCase().includes('dirección') || 
    lastAssistantMsg.content.toLowerCase().includes('ciudad') || 
    lastAssistantMsg.content.toLowerCase().includes('confirmar') ||
    lastAssistantMsg.content.toLowerCase().includes('habitual') ||
    lastAssistantMsg.content.toLowerCase().includes('comprar') ||
    lastAssistantMsg.content.toLowerCase().includes('encargar')
  );

  if (hasPendingOrderFlow) {
    const confirmPatterns = ['confirmar', 'confirmo', 'si por favor', 'sí', 'si', 'dale', 'ok', 'de acuerdo', 'perfecto', 'listo'];
    const cities = ['malabo', 'bata', 'ebebiyin', 'mongomo', 'evinayong', 'luba', 'riaba', 'accra', 'lomé', 'douala'];
    const isConfirming = confirmPatterns.some(p => q === p || q.startsWith(p));
    const mentionsCity = cities.some(c => q.includes(c));
    if (isConfirming || mentionsCity) {
      return { type: 'REGISTRO_PEDIDO', term: query };
    }
  }

  // 2. Detección de tiendas
  const storeKeywords = ['tienda', 'tiendas', 'vendedor', 'vendedores', 'seller', 'shop', 'store'];
  if (storeKeywords.some(kw => q.includes(kw)) && !q.includes('producto')) {
    return { type: 'TIENDAS', term: query };
  }

  // 3. Detección de cálculo de envío
  const shippingCalcPatterns = ['cuanto cuesta enviar', 'costo de envio', 'precio envio', 'calcular envio', 'enviar de', 'enviar a', 'envio de', 'envio a'];
  if (shippingCalcPatterns.some(kw => q.includes(kw))) {
    return { type: 'ENVIO_CALCULO', term: query };
  }

  // 4. Detección de info de envíos general (agencias, tarifas)
  const shippingKeywords = ['envio', 'envios', 'tarifa', 'tarifas', 'agencia', 'agencias', 'abeme', 'modjobuy'];
  if (shippingKeywords.some(kw => q.includes(kw))) {
    const catalogExclusions = ['lacoste', 'shure', 'audio-technica', 'focusrite', 'auriculares', 'peluca', 'wig', 'teclado'];
    if (!catalogExclusions.some(kw => q.includes(kw))) {
      return { type: 'ENVIOS_SEMANTIC', term: query };
    }
  }

  // 5. Detección de catálogo (productos, precios, stock)
  const catalogKeywords = [
    'zapatilla', 'zapatillas', 'zapato', 'zapatos', 'sneaker', 'sneakers', 'lacoste', 'nike', 'adidas',
    'peluca', 'pelucas', 'wig', 'wigs', 'frontal', 'lace', 'olivia', 'perruque',
    'auricular', 'auriculares', 'headphone', 'headphones', 'audio-technica', 'tws',
    'microfono', 'microfonos', 'mic', 'shure', 'sm7b',
    'teclado', 'teclados', 'focusrite', 'estudio', 'interfaz',
    'producto', 'productos', 'disponible', 'disponibles', 'catalogo', 'catálogo',
    'precio', 'precios', 'costo', 'stock', 'cantidad', 'inventario',
    'tienen', 'venden', 'mostrar', 'ver', 'hay', 'busco', 'necesito', 'quiero ver',
    'ropa', 'camisa', 'camisas', 'pantalon', 'pantalones', 'vestido', 'vestidos',
    'bolso', 'bolsos', 'accesorio', 'accesorios', 'joya', 'joyas',
    'perfume', 'perfumes', 'crema', 'cremas', 'maquillaje', 'sandalia', 'sandalias',
    'reloj', 'relojes', 'gafas', 'lentes', 'moda', 'calzado', 'calzados',
    'zapatilla', 'zapatillas', 'zapato', 'zapatos', 'sneaker', 'sneakers', 'tenis', 'baskets',
    'categoria', 'categorias', 'categoría', 'categorías'
  ];
  if (catalogKeywords.some(kw => q.includes(kw))) {
    let cleanQuery = q;
    const noisePatterns = [
      /quiero\s+(encargar|comprar)\s+(el\s+)?producto\s*:\s*/gi,
      /precio\s+de\s+l[ao]s?\s+/gi,
      /precio\s+de\s+/gi,
      /tienen\s+/gi, /busco\s+/gi, /venden\s+/gi,
      /necesito\s+/gi, /quiero\s+(ver|comprar|encargar)\s+/gi,
      /hay\s+/gi, /mostrar\s+/gi, /mu[eé]strame\s+/gi,
      /ense[nñ]ame\s+/gi, /dime\s+/gi, /cuales\s+/gi, /cu[aá]les\s+/gi,
      /hola\s+/gi, /saludos\s+/gi, /buenas\s+/gi, /gracias\s+/gi,
    ];
    noisePatterns.forEach(pat => { cleanQuery = cleanQuery.replace(pat, ''); });

    let searchTerms = cleanQuery.split(/\s+/).filter(word => {
      const cleanWord = word.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '');
      return cleanWord.length > 2 && !['que', 'del', 'los', 'las', 'con', 'para', 'una', 'uno', 'por', 'tiene', 'tienen', 'precio', 'cuesta', 'cuanto', 'como', 'donde', 'quiero', 'encargar', 'producto', 'productos', 'disponible', 'disponibles', 'mostrar', 'hay', 'ver', 'muestrame', 'muéstrame', 'enséñame', 'enseñame', 'dime', 'cuales', 'cuáles', 'hola', 'saludos', 'buenas', 'gracias', 'tienda', 'buscar', 'busca', 'puedes', 'podrías', 'podrias'].includes(cleanWord);
    });

    const finalTerm = searchTerms.length > 0 ? searchTerms.join(' ') : '';
    return { type: 'CATALOGO_SQL', term: finalTerm };
  }

  // 6. Fallback a conversación general
  return { type: 'SALUDO_SOPORTE_GENERAL', term: query };
}
/**
 * Enrutador híbrido de alto rendimiento.
 */
export async function hybridQuery(tenantId: string, userQuery: string, userId?: string) {
  console.log(`📨 Query recibida | tenant: ${tenantId} | prompt: "${userQuery.substring(0, 50)}"`);
  
  const conversationKey = getConversationKey(tenantId, userId);
  const history = getConversationHistory(conversationKey);
  
  // 1. Obtener manual operativo dinámico de la caché local
  const operationalManual = await getCachedOperationalManual(tenantId);

  // 2. Clasificación heurística instantánea
  const decision = classifyIntentHeuristically(userQuery, history);
  console.log(`⚡ Clasificación Heurística: [${decision.type}] | Término: "${decision.term}"`);

  const rotteriTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';

  // Flujo A: Saludo / Soporte General (1 sola llamada al LLM para responder)
  if (decision.type === 'SALUDO_SOPORTE_GENERAL') {
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual, conversationKey, tenantId);
    return {
      type: 'SALUDO_SOPORTE_GENERAL' as const,
      results: [],
      humanResponse
    };
  }

  // Flujo B: Consulta de catálogo en MySQL local (1 sola llamada al LLM para responder)
  if (decision.type === 'CATALOGO_SQL') {
    // Try external connector first (Req 8.1)
    const connectorResult = await tryConnectorDispatch(tenantId, userQuery, decision);
    if (connectorResult) {
      const humanResponse = await generateHumanResponse(userQuery, connectorResult.results, 'SQL', operationalManual, conversationKey, tenantId);
      return { type: 'SQL' as const, results: connectorResult.results, humanResponse };
    }

    let rawSqlResults;
    if (tenantId === rotteriTenantId) {
      // Para Rotteri: pasar solo el término de búsqueda (el proxy/MySQL local maneja la query)
      rawSqlResults = await executeLiveRotteriSql(decision.term);
    } else {
      // Para otros tenants: query directa a Postgres
      const sqlQuery = `SELECT name, price, stock, description, image_url FROM products WHERE name ILIKE '%${decision.term}%' OR description ILIKE '%${decision.term}%'`;
      rawSqlResults = await executeSecureSql(tenantId, sqlQuery);
    }
    
    const humanResponse = await generateHumanResponse(userQuery, rawSqlResults.results, 'SQL', operationalManual, conversationKey, tenantId);
    return {
      ...rawSqlResults,
      humanResponse
    };
  }

  // Flujo C: Consulta semántica de envíos RAG
  if (decision.type === 'ENVIOS_SEMANTIC') {
    // Para Rotteri: intentar usar el proxy para info de agencias
    if (tenantId === rotteriTenantId && ROTTERI_PROXY_URL) {
      try {
        const resp = await fetch(ROTTERI_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Chat-Token': ROTTERI_PROXY_TOKEN },
          body: JSON.stringify({ action: 'list_agencies' }),
        });
        if (resp.ok) {
          const json = await resp.json() as any;
          if (json.agencies && json.agencies.length > 0) {
            const humanResponse = await generateHumanResponse(userQuery, json.agencies, 'SQL', operationalManual, conversationKey, tenantId);
            return { type: 'SQL' as const, results: json.agencies, humanResponse };
          }
        }
      } catch (e) { /* fallback to semantic */ }
    }
    const rawSemanticResults = await executeSemanticSearch(tenantId, decision.term);
    const humanResponse = await generateHumanResponse(userQuery, rawSemanticResults.results, 'SEMANTIC', operationalManual, conversationKey, tenantId);
    return { ...rawSemanticResults, humanResponse };
  }

  // Flujo C2: Cálculo de envío específico
  if (decision.type === 'ENVIO_CALCULO' && tenantId === rotteriTenantId && ROTTERI_PROXY_URL) {
    // Extraer origen/destino del texto del usuario
    const shippingPrompt = `Extrae origen y destino del envío de este mensaje: "${userQuery}"
Responde SOLO JSON: {"origin":"ciudad o país","destination":"ciudad o país"}`;
    const extracted = await callLLM('Eres un extractor de datos. Solo JSON.', shippingPrompt, 60);
    let origin = '', destination = '';
    try {
      const match = extracted.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        origin = parsed.origin || '';
        destination = parsed.destination || '';
      }
    } catch {}

    if (origin || destination) {
      try {
        const resp = await fetch(ROTTERI_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Chat-Token': ROTTERI_PROXY_TOKEN },
          body: JSON.stringify({ action: 'calculate_shipping', origin, destination, weight: 1.0 }),
        });
        if (resp.ok) {
          const json = await resp.json() as any;
          const humanResponse = await generateHumanResponse(userQuery, json.options || [], 'SQL', operationalManual, conversationKey, tenantId);
          return { type: 'SQL' as const, results: json.options || [], humanResponse };
        }
      } catch (e) { /* fallback */ }
    }
    // Fallback to general response
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual, conversationKey, tenantId);
    return { type: 'SALUDO_SOPORTE_GENERAL' as const, results: [], humanResponse };
  }

  // Flujo E: Tiendas
  if (decision.type === 'TIENDAS' && tenantId === rotteriTenantId && ROTTERI_PROXY_URL) {
    try {
      const resp = await fetch(ROTTERI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chat-Token': ROTTERI_PROXY_TOKEN },
        body: JSON.stringify({ action: 'list_stores' }),
      });
      if (resp.ok) {
        const json = await resp.json() as any;
        const stores = json.stores || [];
        const humanResponse = await generateHumanResponse(userQuery, stores, 'SQL', operationalManual, conversationKey, tenantId);
        return { type: 'SQL' as const, results: stores, humanResponse };
      }
    } catch (e) { /* fallback */ }
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual, conversationKey, tenantId);
    return { type: 'SALUDO_SOPORTE_GENERAL' as const, results: [], humanResponse };
  }

  // Flujo D: Pedidos — Usa datos del usuario logueado, solo confirma
  if (decision.type === 'REGISTRO_PEDIDO') {

    // Extraer nombre del producto del mensaje
    let productName: string | null = null;
    const widgetOrderMatch = userQuery.match(/quiero\s+(?:encargar|comprar)\s+(?:el\s+)?producto\s*:\s*(.+)/i);
    if (widgetOrderMatch) {
      productName = widgetOrderMatch[1].trim();
    }

    // Si no se detectó del widget, extraer con LLM
    if (!productName) {
      const extractPrompt = `Del mensaje extrae solo el nombre del producto. Responde SOLO el nombre, nada más. Si no hay producto claro, responde: NONE`;
      const extracted = await callLLM(extractPrompt, userQuery, 50);
      if (extracted && !extracted.includes('NONE') && extracted.length < 100) {
        productName = extracted.trim().replace(/^["']|["']$/g, '');
      }
    }

    // Obtener datos del usuario desde la memoria de conversación / request
    // El widget envía user.name, user.phone en el body del request
    const conversationHistory = getConversationHistory(conversationKey);
    
    // Buscar producto para obtener precio
    let productId: number | null = null;
    let tiendaId: number | null = null;
    let precioProd: number = 0;

    if (productName) {
      const prod = await findProductByName(productName);
      if (prod) {
        productId = prod.id;
        tiendaId = prod.tienda_id;
        precioProd = parseFloat(String(prod.precio)) || 0;
      }
    }

    // Si no hay producto identificado, pedir aclaración
    if (!productName) {
      const response = '¿Qué producto te gustaría encargar? Puedes decirme el nombre o buscarlo primero.';
      addToConversation(conversationKey, 'user', userQuery);
      addToConversation(conversationKey, 'assistant', response);
      return { type: 'SALUDO_SOPORTE_GENERAL' as const, results: [], humanResponse: response };
    }

    // Devolver confirmación con datos pre-llenados del usuario
    // El frontend tiene los datos del usuario (window.__ETEBA_CHAT_USER__)
    // Solo pedimos confirmar la ciudad de entrega
    const priceStr = precioProd > 0 ? `${precioProd.toLocaleString('es-ES')} CFA` : 'consultar';
    
    const confirmResponse = await callLLM(
      operationalManual || 'Eres un asistente de ventas conciso y amable.',
      `El cliente quiere comprar: "${productName}" (${priceStr}). 
Ya tenemos sus datos de su cuenta (nombre, teléfono). 
Solo necesitamos confirmar la ciudad de entrega.
Pregunta brevemente: confirma si enviar a su ciudad habitual o indica otra ciudad.
NO pidas nombre ni teléfono — ya los tenemos.`,
      150
    );

    addToConversation(conversationKey, 'user', userQuery);
    addToConversation(conversationKey, 'assistant', confirmResponse);

    return {
      type: 'ORDER_CONFIRM' as const,
      results: [],
      humanResponse: confirmResponse,
      orderPending: {
        product_name: productName,
        product_id: productId,
        tienda_id: tiendaId,
        price: precioProd,
      }
    };
  }


  throw new Error('Intención desconocida.');
}

/**
 * Filtrado inteligente con LLM cuando el proxy devuelve catálogo completo
 */
async function smartFilterWithLLM(userQuery: string, products: any[]): Promise<any[]> {
  const productList = products.map((p, i) => `${i}: ${p.name} (${p.price} CFA)${p.tags ? ' [' + p.tags + ']' : ''}`).join('\n');
  
  const prompt = `El usuario busca: "${userQuery}"
Catálogo disponible:
${productList}

Responde SOLO con los números (índices) de productos relevantes, separados por comas.
Considera sinónimos y traducciones (español/francés/inglés).
Si ninguno coincide, responde: NONE`;

  const response = await callLLM('Eres un filtro de productos. Responde solo con números.', prompt, 50);
  
  if (response.includes('NONE') || response.includes('ninguno')) {
    return [];
  }

  const indices = response.match(/\d+/g);
  if (!indices) return products.slice(0, 5); // fallback: mostrar primeros 5

  return indices
    .map(i => products[parseInt(i)])
    .filter(p => p !== undefined)
    .slice(0, 8);
}

/**
 * Llama al proxy PHP (producción) o a MySQL directo (local).
 * En ambos casos devuelve el mismo formato de resultados.
 */
async function executeLiveRotteriSql(searchTerm: string) {
  console.log(`🔌 Buscando productos: "${searchTerm || '(todo)'}"`);

  // Expandir con el sistema de alias inteligente
  const expandedTerms = searchTerm ? expandSearchTerms(searchTerm) : [''];
  console.log(`🔍 Términos expandidos: [${expandedTerms.join(', ')}]`);

  // ─── PRODUCCIÓN: llamar al proxy PHP ────────────────────────────────────────
  if (ROTTERI_PROXY_URL) {
    // Estrategia: enviar múltiples llamadas al proxy con términos individuales
    // porque el LIKE del proxy busca un solo string. Los productos están en francés/inglés
    // pero los usuarios buscan en español, así que cada sinónimo se busca por separado.
    const searchTerms = expandedTerms.filter(t => t.length > 0 && t.length <= 50);
    
    // Primero intentar con el término original
    let allResults: any[] = [];
    let finalNote = 'like_match';
    const seenIds = new Set<number>();

    // Enviar el término original primero
    try {
      const resp = await fetch(ROTTERI_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chat-Token': ROTTERI_PROXY_TOKEN,
        },
        body: JSON.stringify({ action: 'search_products', term: searchTerm, limit: 15 }),
      });

      if (resp.ok) {
        const json = await resp.json() as { results: any[]; note?: string; count?: number };
        if (json.note === 'like_match' && json.results && json.results.length > 0) {
          // El término original encontró resultados directos
          for (const p of json.results) {
            if (!seenIds.has(p.id)) { seenIds.add(p.id); allResults.push(p); }
          }
        } else {
          finalNote = json.note || 'fallback_catalog';
        }
      }
    } catch (err: any) {
      console.error('⚠️ Proxy fetch error (original term):', err.message);
    }

    // Si el término original no encontró nada, intentar con cada sinónimo individualmente
    if (allResults.length === 0 && searchTerms.length > 1) {
      const synonymsToTry = searchTerms
        .filter(t => t !== searchTerm.toLowerCase().trim())
        .slice(0, 4); // max 4 sinónimos para no saturar

      for (const synonym of synonymsToTry) {
        try {
          const resp = await fetch(ROTTERI_PROXY_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Chat-Token': ROTTERI_PROXY_TOKEN,
            },
            body: JSON.stringify({ action: 'search_products', term: synonym, limit: 10 }),
          });

          if (resp.ok) {
            const json = await resp.json() as { results: any[]; note?: string };
            if (json.note === 'like_match' && json.results && json.results.length > 0) {
              for (const p of json.results) {
                if (!seenIds.has(p.id)) { seenIds.add(p.id); allResults.push(p); }
              }
              finalNote = 'like_match';
            }
          }
        } catch { /* skip failed synonym */ }

        // Si ya tenemos suficientes resultados, parar
        if (allResults.length >= 10) break;
      }
    }

    // Si después de todos los sinónimos aún no hay nada, hacer un último intento con fallback
    if (allResults.length === 0) {
      try {
        const resp = await fetch(ROTTERI_PROXY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Chat-Token': ROTTERI_PROXY_TOKEN,
          },
          body: JSON.stringify({ action: 'search_products', term: '', limit: 30 }),
        });

        if (resp.ok) {
          const json = await resp.json() as { results: any[]; note?: string };
          allResults = json.results || [];
          finalNote = 'fallback_catalog';
        }
      } catch (err: any) {
        console.error('⚠️ Proxy fetch error (fallback):', err.message);
        return { type: 'SQL' as const, sql: '/* proxy error */', results: [] };
      }
    }

    let results = allResults;
    console.log(`✅ Proxy: ${results.length} producto(s), note: ${finalNote}`);

    // Solo usar LLM para filtrar si fue un fallback completo del catálogo
    if (finalNote === 'fallback_catalog' && searchTerm && results.length > 5) {
      results = await smartFilterWithLLM(searchTerm, results);
    }

    // Limitar a 10 resultados máximo para la respuesta del chat
    results = results.slice(0, 10);

    // Aprender relaciones de los productos encontrados
    if (searchTerm && results.length > 0) {
      results.slice(0, 3).forEach((p: any) => {
        learnProductRelation(searchTerm, p.name || '');
      });
    }

    return { type: 'SQL' as const, sql: '/* proxy */', results };
  }

  // ─── LOCAL: MySQL directo ────────────────────────────────────────────────────
  const pool = await getMysqlPool();
  if (!pool) throw new Error('MySQL pool no inicializado');

  let mysqlQuery: string;
  let params: string[];

  if (!searchTerm) {
    mysqlQuery = `SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos WHERE cantidad > 0 ORDER BY nombre ASC LIMIT 10`;
    params = [];
  } else {
    const terms = expandedTerms.filter(t => t.length > 0);
    const whereClauses = terms.map(() =>
      '(nombre LIKE ? OR descripcion LIKE ?)'
    ).join(' OR ');
    params = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
    mysqlQuery = `SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos WHERE (${whereClauses}) AND cantidad > 0 ORDER BY nombre ASC LIMIT 10`;
  }

  console.log(`📝 SQL: ${mysqlQuery}`);

  try {
    const [rows] = await pool.execute(mysqlQuery, params);
    const results = (rows as any[]).map(row => ({
      name: row.nombre,
      price: row.precio,
      stock: row.cantidad,
      description: row.descripcion || '',
      image_url: row.imagen_url || null
    }));
    return { type: 'SQL' as const, sql: mysqlQuery, results };
  } catch (err: any) {
    console.error('❌ Error MySQL:', err.message || err);
    throw err;
  }
}

/**
 * Guarda un pedido: via proxy PHP (producción) o MySQL directo (local).

 */
async function savePedidoChat(data: {
  producto_nombre: string;
  cliente_nombre: string;
  cliente_telefono: string;
  ciudad_entrega: string;
  precio_producto: number;
  tienda_id: number | null;
  producto_id: number | null;
  notas: string;
}): Promise<number | null> {

  // ─── PRODUCCIÓN: proxy PHP ────────────────────────────────────────────────────
  if (ROTTERI_PROXY_URL) {
    const resp = await fetch(ROTTERI_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Token': ROTTERI_PROXY_TOKEN,
      },
      body: JSON.stringify({ action: 'insert_order', ...data }),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { insert_id?: number };
    return json.insert_id || null;
  }

  // ─── LOCAL: MySQL directo ────────────────────────────────────────────────────
  const pool = await getMysqlPool();
  if (!pool) return null;
  const [result] = await pool.execute(
    `INSERT INTO pedidos_chat (producto_nombre, cliente_nombre, cliente_telefono, ciudad_entrega, precio_producto, tienda_id, producto_id, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.producto_nombre, data.cliente_nombre, data.cliente_telefono, data.ciudad_entrega,
     data.precio_producto, data.tienda_id, data.producto_id, data.notas]
  ) as any[];
  return (result as any).insertId || null;
}

/**
 * Busca un producto por nombre para obtener ID y tienda.
 */
async function findProductByName(nombre: string): Promise<{ id: number; tienda_id: number; precio: number } | null> {
  if (ROTTERI_PROXY_URL) {
    const resp = await fetch(ROTTERI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Token': ROTTERI_PROXY_TOKEN },
      body: JSON.stringify({ action: 'find_product', nombre: nombre.split(' ').slice(0, 3).join(' ') }),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { product: any };
    return json.product || null;
  }
  const pool = await getMysqlPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    'SELECT id, tienda_id, precio FROM productos WHERE nombre LIKE ? LIMIT 1',
    [`%${nombre.split(' ').slice(0, 3).join(' ')}%`]
  ) as any[];
  return (rows as any[])[0] || null;
}


/**
 * Ejecuta SQL en Postgres nativo.
 */
async function executeSecureSql(tenantId: string, sqlQuery: string) {
  if (!/^\s*select\b/i.test(sqlQuery)) {
    throw new Error('Solo se permiten consultas SQL SELECT.');
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN;');
    await client.query('SET TRANSACTION READ ONLY;');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}';`);
    const response = await client.query(sqlQuery);
    await client.query('COMMIT;');
    return {
      type: 'SQL' as const,
      sql: sqlQuery,
      results: response.rows
    };
  } catch (err: any) {
    await client.query('ROLLBACK;');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Búsqueda semántica.
 */
async function executeSemanticSearch(tenantId: string, semanticQuery: string) {
  const extractor = await getExtractor();
  const output = await extractor(semanticQuery.trim(), {
    pooling: 'mean',
    normalize: true,
  });

  const embedding = Array.from(output.data) as number[];
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN;');
    await client.query('SET TRANSACTION READ ONLY;');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}';`);
    const response = await client.query(
      'SELECT id, content, similarity FROM match_knowledge($1::vector(384), $2::float, $3::int)',
      [JSON.stringify(embedding), 0.3, 3]
    );
    await client.query('COMMIT;');
    return {
      type: 'SEMANTIC' as const,
      query: semanticQuery,
      results: response.rows
    };
  } catch (err: any) {
    await client.query('ROLLBACK;');
    throw err;
  } finally {
    client.release();
  }
}

// Limpiar pools
export async function closeRouterConnections() {
  await pgPool.end();
  if (mysqlPool) await mysqlPool.end();
}
