import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import { getExtractor } from './ingest.js';
import pg from 'pg';

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


// 3. Caché de manual operativo en memoria para reducir latencia de peticiones de red a InsForge (10 minutos)
const manualCache: { [tenantId: string]: { manual: string | null; timestamp: number } } = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

async function getCachedOperationalManual(tenantId: string): Promise<string | null> {
  const now = Date.now();
  if (manualCache[tenantId] && (now - manualCache[tenantId].timestamp) < CACHE_TTL) {
    return manualCache[tenantId].manual;
  }

  console.log(`🔒 Caché expirada o vacía. Recuperando manual operativo desde InsForge para: ${tenantId}...`);
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
    return manualCache[tenantId]?.manual || null; // Fallback a la caché vieja si falla la red
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
 * Genera la respuesta del bot en base al manual y el contexto recuperado (Única llamada al LLM)
 */
async function generateHumanResponse(
  userQuery: string,
  retrievedData: any[],
  type: 'SQL' | 'SEMANTIC' | 'SALUDO_SOPORTE_GENERAL',
  operationalManual: string | null
): Promise<string> {
  let contextString = '';
  if (type === 'SQL') {
    contextString = `RESULTADOS DE INVENTARIO:\n${JSON.stringify(retrievedData, null, 2)}`;
  } else if (type === 'SEMANTIC') {
    contextString = `INFORMACIÓN RELEVANTE:\n${retrievedData.map((r: any, i: number) => `[${i+1}]: ${r.content}`).join('\n')}`;
  }

  const fallbackManual = `Eres Asistente de Ventas. Habla en español de forma empática y concisa.`;
  const activeManual = operationalManual || fallbackManual;

  const systemPrompt = `${activeManual}

${contextString ? `DATOS CONSULTADOS:\n${contextString}\n` : ''}REGLAS: Responde en base al contexto. NO inventes datos. Si hay productos, menciona nombre y precio. Sé conciso.`;

  return await callLLM(systemPrompt, userQuery, 300);
}

/**
 * Enrutador Heurístico Ultra-Rápido en TypeScript (Cero llamadas de clasificación a la API de LLM)
 * Clasifica la intención analizando patrones de texto locales en milisegundos.
 */
function classifyIntentHeuristically(query: string): { type: 'SALUDO_SOPORTE_GENERAL' | 'CATALOGO_SQL' | 'ENVIOS_SEMANTIC' | 'REGISTRO_PEDIDO' | 'TIENDAS' | 'ENVIO_CALCULO'; term: string } {
  const q = query.toLowerCase().trim();

  // 1. Detección de registro de pedidos
  const phonePattern = /(?:\+?240\s*)?[23569]\d{8}\b/;
  const isOrdering = q.includes('comprar') || q.includes('encargar') || q.includes('pedido') || q.includes('ordenar') || q.includes('mi nombre') || q.includes('llamo') || q.includes('confirmar');
  const orderClickPattern = /quiero\s+(encargar|comprar)\s+(el\s+)?producto/i;
  const isDirectOrderClick = orderClickPattern.test(q) || q.includes('encargar producto') || q.includes('quiero comprar');
  if (isDirectOrderClick || (phonePattern.test(q) && isOrdering)) {
    return { type: 'REGISTRO_PEDIDO', term: query };
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
    'reloj', 'relojes', 'gafas', 'lentes', 'moda', 'calzado',
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
      /hay\s+/gi, /mostrar\s+/gi,
    ];
    noisePatterns.forEach(pat => { cleanQuery = cleanQuery.replace(pat, ''); });

    let searchTerms = cleanQuery.split(/\s+/).filter(word => {
      const cleanWord = word.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '');
      return cleanWord.length > 2 && !['que', 'del', 'los', 'las', 'con', 'para', 'una', 'uno', 'por', 'tiene', 'tienen', 'precio', 'cuesta', 'cuanto', 'como', 'donde', 'quiero', 'encargar', 'producto', 'productos', 'disponible', 'disponibles', 'mostrar', 'hay', 'ver'].includes(cleanWord);
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
export async function hybridQuery(tenantId: string, userQuery: string) {
  // 1. Obtener manual operativo dinámico de la caché local
  const operationalManual = await getCachedOperationalManual(tenantId);

  // 2. Clasificación heurística instantánea
  const decision = classifyIntentHeuristically(userQuery);
  console.log(`⚡ Clasificación Heurística: [${decision.type}] | Término: "${decision.term}"`);

  const rotteriTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';

  // Flujo A: Saludo / Soporte General (1 sola llamada al LLM para responder)
  if (decision.type === 'SALUDO_SOPORTE_GENERAL') {
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual);
    return {
      type: 'SALUDO_SOPORTE_GENERAL' as const,
      results: [],
      humanResponse
    };
  }

  // Flujo B: Consulta de catálogo en MySQL local (1 sola llamada al LLM para responder)
  if (decision.type === 'CATALOGO_SQL') {
    let rawSqlResults;
    if (tenantId === rotteriTenantId) {
      // Para Rotteri: pasar solo el término de búsqueda (el proxy/MySQL local maneja la query)
      rawSqlResults = await executeLiveRotteriSql(decision.term);
    } else {
      // Para otros tenants: query directa a Postgres
      const sqlQuery = `SELECT name, price, stock, description, image_url FROM products WHERE name ILIKE '%${decision.term}%' OR description ILIKE '%${decision.term}%'`;
      rawSqlResults = await executeSecureSql(tenantId, sqlQuery);
    }
    
    const humanResponse = await generateHumanResponse(userQuery, rawSqlResults.results, 'SQL', operationalManual);
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
            const humanResponse = await generateHumanResponse(userQuery, json.agencies, 'SQL', operationalManual);
            return { type: 'SQL' as const, results: json.agencies, humanResponse };
          }
        }
      } catch (e) { /* fallback to semantic */ }
    }
    const rawSemanticResults = await executeSemanticSearch(tenantId, decision.term);
    const humanResponse = await generateHumanResponse(userQuery, rawSemanticResults.results, 'SEMANTIC', operationalManual);
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
          const humanResponse = await generateHumanResponse(userQuery, json.options || [], 'SQL', operationalManual);
          return { type: 'SQL' as const, results: json.options || [], humanResponse };
        }
      } catch (e) { /* fallback */ }
    }
    // Fallback to general response
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual);
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
        const humanResponse = await generateHumanResponse(userQuery, stores, 'SQL', operationalManual);
        return { type: 'SQL' as const, results: stores, humanResponse };
      }
    } catch (e) { /* fallback */ }
    const humanResponse = await generateHumanResponse(userQuery, [], 'SALUDO_SOPORTE_GENERAL', operationalManual);
    return { type: 'SALUDO_SOPORTE_GENERAL' as const, results: [], humanResponse };
  }

  // Flujo D: Captura y validación estructurada de pedidos
  if (decision.type === 'REGISTRO_PEDIDO') {

    // Extracción local del nombre del producto (sin LLM) desde el patrón del botón del widget
    let productNameLocal: string | null = null;
    const widgetOrderMatch = userQuery.match(/quiero\s+(?:encargar|comprar)\s+(?:el\s+)?producto\s*:\s*(.+)/i);
    if (widgetOrderMatch) {
      productNameLocal = widgetOrderMatch[1].trim();
    }
    
    const extractionPrompt = `Extrae datos de pedido del mensaje. Responde SOLO con JSON válido:
{"customer_name": "nombre o null", "phone": "teléfono o null", "address": "ciudad o null", "product_name": "producto o null"}`;

    const rawJson = await callLLM(extractionPrompt, userQuery, 150);
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : rawJson;

    let data;
    try {
      data = JSON.parse(cleanJson);
    } catch {
      data = {};
    }

    // Priorizar el nombre extraído localmente (más fiable para frases del widget)
    if (productNameLocal && !data.product_name) {
      data.product_name = productNameLocal;
    }

    // Determinar si faltan datos requeridos por el manual
    const missingFields: string[] = [];
    if (!data.customer_name) missingFields.push('Nombre Completo');
    if (!data.phone) missingFields.push('Número de Teléfono (+240)');
    if (!data.address) missingFields.push('Ciudad de entrega (Malabo o Bata)');

    let humanResponse = '';
    if (missingFields.length > 0) {
      const productMention = data.product_name ? `"${data.product_name}"` : 'el producto';

      // Devolver tipo ORDER_FORM para que el widget renderice una tarjeta de formulario
      return {
        type: 'ORDER_FORM' as const,
        results: [],
        humanResponse: `Para completar tu pedido de ${productMention}, necesito los siguientes datos:`,
        orderForm: {
          product_name: data.product_name || null,
          missingFields: missingFields,
          filledFields: {
            customer_name: data.customer_name || null,
            phone: data.phone || null,
            address: data.address || null,
          }
        }
      };
    } else {
      // ✅ GUARDAR PEDIDO REAL (local: MySQL directo | producción: proxy PHP)
      let productId: number | null = null;
      let tiendaId: number | null = null;
      let precioProd: number = 0;
      let pedidoId: number | null = null;

      try {
        // Buscar el producto para obtener ID, tienda y precio reales
        if (data.product_name) {
          const prod = await findProductByName(data.product_name);
          if (prod) {
            productId = prod.id;
            tiendaId  = prod.tienda_id;
            precioProd = parseFloat(String(prod.precio)) || 0;
          }
        }

        // Guardar el pedido en la base de datos
        pedidoId = await savePedidoChat({
          producto_nombre: data.product_name || '',
          cliente_nombre: data.customer_name,
          cliente_telefono: data.phone,
          ciudad_entrega: data.address,
          precio_producto: precioProd,
          tienda_id: tiendaId,
          producto_id: productId,
          notas: ''
        });

        console.log(`✅ Pedido #${pedidoId} guardado en pedidos_chat para cliente: ${data.customer_name}`);
      } catch (dbErr: any) {
        console.error('⚠️ Error guardando pedido en MySQL:', dbErr.message);
        // Continuar igual — el cliente recibe confirmación aunque falle el guardado
      }

      const pedidoRef = pedidoId ? ` (Referencia #${pedidoId})` : '';
      const successPrompt = `Pedido${pedidoRef} completado:
- Nombre: ${data.customer_name}
- Teléfono: ${data.phone}
- Ciudad: ${data.address}
- Producto: ${data.product_name}${precioProd > 0 ? ` - ${precioProd.toLocaleString('es-ES')} CFA` : ''}
Confirma de forma cálida y breve. Menciona la referencia si existe.`;

      humanResponse = await callLLM(
        operationalManual || 'Eres un asistente de ventas amable.',
        successPrompt,
        200
      );
      if (!humanResponse || humanResponse.includes('error')) {
        humanResponse = `¡Pedido${pedidoRef} registrado con éxito! Pronto te contactaremos.`;
      }

      return {
        type: 'ORDER_SUCCESS' as const,
        results: [],
        humanResponse,
        orderConfirmation: {
          pedidoId: pedidoId,
          product_name: data.product_name,
          customer_name: data.customer_name,
          phone: data.phone,
          address: data.address,
          price: precioProd
        }
      };
    }

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

  // Expandir sinónimos bilingües (aplica tanto para proxy como local)
  const synonymMap: Record<string, string[]> = {
    wig: ['peluca'], wigs: ['peluca'], peluca: ['wig'], pelucas: ['wig'],
    sneaker: ['zapatilla'], sneakers: ['zapatilla'], zapatilla: ['sneaker'], zapatillas: ['sneaker'],
    headphone: ['auricular'], headphones: ['auricular'], auricular: ['headphone'], auriculares: ['headphone'],
    zapato: ['zapatilla'], zapatos: ['zapatilla'],
  };

  const terms = searchTerm ? [searchTerm] : [''];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    for (const [key, synonyms] of Object.entries(synonymMap)) {
      if (lower.includes(key)) {
        synonyms.forEach(s => { if (!terms.includes(s)) terms.push(s); });
      }
    }
  }

  // ─── PRODUCCIÓN: llamar al proxy PHP ────────────────────────────────────────
  if (ROTTERI_PROXY_URL) {
    // Enviar búsqueda al proxy con todos los sinónimos
    const searchTerms = terms.filter(t => t.length > 0);
    const effectiveTerm = searchTerms.length > 0 ? searchTerms[0] : '';

    try {
      const resp = await fetch(ROTTERI_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chat-Token': ROTTERI_PROXY_TOKEN,
        },
        body: JSON.stringify({ action: 'search_products', term: effectiveTerm, limit: 30 }),
      });

      if (!resp.ok) {
        console.error(`⚠️ Proxy error [${resp.status}]`);
        return { type: 'SQL' as const, sql: '/* proxy error */', results: [] };
      }

      const json = await resp.json() as { results: any[]; note?: string; count?: number };
      const results = json.results || [];
      console.log(`✅ Proxy: ${results.length} producto(s), note: ${json.note || 'none'}`);

      // Si el proxy devolvió catálogo completo (fallback) y tenemos término,
      // usar Groq para filtrar semánticamente
      if (json.note === 'fallback_catalog' && searchTerm && results.length > 5) {
        const filtered = await smartFilterWithLLM(searchTerm, results);
        return { type: 'SQL' as const, sql: '/* proxy+llm */', results: filtered };
      }

      return { type: 'SQL' as const, sql: '/* proxy */', results };
    } catch (err: any) {
      console.error('⚠️ Proxy fetch error:', err.message);
      return { type: 'SQL' as const, sql: '/* proxy error */', results: [] };
    }
  }

  // ─── LOCAL: MySQL directo ────────────────────────────────────────────────────
  const pool = await getMysqlPool();
  if (!pool) throw new Error('MySQL pool no inicializado');

  let mysqlQuery: string;
  let params: string[];

  if (!searchTerm) {
    // Listar todos los productos disponibles
    mysqlQuery = `SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos WHERE cantidad > 0 ORDER BY nombre ASC LIMIT 10`;
    params = [];
  } else {
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
