import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import { getExtractor } from './ingest.js';
import OpenAI from 'openai';
import pg from 'pg';

const { Pool } = pg;

// 1. Validar variables de entorno clave
const databaseUrl = process.env.DATABASE_URL;
const openrouterKey = process.env.OPENROUTER_API_KEY;
const baseUrl = process.env.INSFORGE_BASE_URL;
const apiKey = process.env.INSFORGE_API_KEY;

if (!databaseUrl || !openrouterKey || !baseUrl || !apiKey) {
  console.error('❌ Error: Configuración incompleta en .env.local');
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

// 4. Inicializar OpenRouter
const getOpenRouterClient = () => {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openrouterKey,
  });
};

/**
 * Genera la respuesta del bot en base al manual y el contexto recuperado (Única llamada al LLM)
 */
async function generateHumanResponse(
  userQuery: string,
  retrievedData: any[],
  type: 'SQL' | 'SEMANTIC' | 'SALUDO_SOPORTE_GENERAL',
  operationalManual: string | null
): Promise<string> {
  const openai = getOpenRouterClient();
  
  let contextString = '';
  if (type === 'SQL') {
    contextString = `RESULTADOS DE INVENTARIO EN TIEMPO REAL:\n${JSON.stringify(retrievedData, null, 2)}`;
  } else if (type === 'SEMANTIC') {
    contextString = `REGLAS DE NEGOCIO Y TARIFAS DE ENVÍOS:\n${retrievedData.map((r: any, i: number) => `[Referencia #${i+1}]: ${r.content}`).join('\n\n')}`;
  } else {
    contextString = `CONVERSACIÓN GENERAL.`;
  }

  const fallbackManual = `Actúas como Asistente de Ventas de la tienda. Habla de forma muy empática y en español de Guinea Ecuatorial.`;
  const activeManual = operationalManual || fallbackManual;

  const systemPrompt = `${activeManual}

CONTEXTO DE BASE DE DATOS RECUPERADO (INFORMACIÓN EXACTA):
${contextString}

ADAPTACIÓN DE IDIOMA Y TRADUCCIÓN (CRÍTICO):
Varios productos pueden tener nombres técnicos en inglés (ej. 'Wig Olivia', 'Lace Frontal'). Al responder en español, traduce o adapta los nombres a su equivalente natural en español (ej. traduciendo 'Wig' como 'Peluca', 'Lace Frontal' como 'Encaje frontal'). Puedes dejar el nombre técnico original entre paréntesis para fines de búsqueda (ej. "Peluca Olivia (Wig Olivia)").

INSTRUCCIÓN CRÍTICA DE SEGURIDAD:
Responde de forma humana en base al manual. NO inventes productos, stock ni precios que no estén explícitamente detallados en el contexto anterior.`;

  const response = await openai.chat.completions.create({
    model: 'openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery }
    ],
    temperature: 0.3
  });

  return response.choices[0]?.message?.content || 'Disculpe las molestias, ¿podría repetir su consulta?';
}

/**
 * Enrutador Heurístico Ultra-Rápido en TypeScript (Cero llamadas de clasificación a la API de LLM)
 * Clasifica la intención analizando patrones de texto locales en milisegundos.
 */
function classifyIntentHeuristically(query: string): { type: 'SALUDO_SOPORTE_GENERAL' | 'CATALOGO_SQL' | 'ENVIOS_SEMANTIC' | 'REGISTRO_PEDIDO'; term: string } {
  const q = query.toLowerCase().trim();

  // 1. Detección de registro de pedidos (patrones de click en botón del widget o datos de contacto)
  const phonePattern = /(?:\+?240\s*)?[23569]\d{8}\b/;
  const isOrdering = q.includes('comprar') || q.includes('encargar') || q.includes('pedido') || q.includes('ordenar') || q.includes('mi nombre') || q.includes('llamo');
  
  // Patrón amplio para cualquier variante del botón "Encargar" del widget
  const orderClickPattern = /quiero\s+(encargar|comprar)\s+(el\s+)?producto/i;
  const isDirectOrderClick = orderClickPattern.test(q) || q.includes('encargar producto') || q.includes('quiero comprar');
  if (isDirectOrderClick || (phonePattern.test(q) && isOrdering)) {
    return { type: 'REGISTRO_PEDIDO', term: query };
  }

  // 2. Detección de envíos y tarifas semánticas
  const shippingKeywords = ['envio', 'envios', 'enviar', 'tarifa', 'tarifas', 'costo', 'precio de envio', 'bata', 'malabo', 'llegar', 'abeme', 'modjobuy', 'agencia', 'agencias'];
  if (shippingKeywords.some(kw => q.includes(kw))) {
    // Si contiene marcas o productos además de envío, priorizar catálogo
    const catalogExclusions = ['lacoste', 'shure', 'audio-technica', 'focusrite', 'auriculares', 'peluca', 'wig', 'teclado'];
    if (!catalogExclusions.some(kw => q.includes(kw))) {
      return { type: 'ENVIOS_SEMANTIC', term: query };
    }
  }

  // 3. Detección de catálogo (palabras de productos, consultas de inventario, stock, etc.)
  const catalogKeywords = [
    'zapatilla', 'zapatillas', 'zapato', 'sneaker', 'sneakers', 'lacoste', 
    'peluca', 'pelucas', 'wig', 'wigs', 'frontal', 'lace', 'olivia',
    'auricular', 'auriculares', 'headphone', 'headphones', 'audio-technica',
    'microfono', 'microfonos', 'mic', 'shure', 'sm7b',
    'teclado', 'teclados', 'focusrite', 'estudio', 'interfaz', 'precio', 'costo', 'stock', 'cantidad', 'inventario', 'tienen', 'venden', 'catalogo', 'encargar'
  ];
  if (catalogKeywords.some(kw => q.includes(kw))) {
    // Limpiar palabras conversacionales de ruido del término de búsqueda SQL
    let cleanQuery = q;
    const noisePatterns = [
      /quiero\s+(encargar|comprar)\s+(el\s+)?producto\s*:\s*/gi,
      /quiero\s+encargar\s*:\s*/gi,
      /quiero\s+comprar\s*:\s*/gi,
      /precio\s+de\s+l[ao]s?\s+/gi,
      /precio\s+de\s+/gi,
      /tienen\s+/gi,
      /busco\s+/gi,
      /venden\s+/gi,
      /necesito\s+/gi,
      /quiero\s+(ver|comprar|encargar)\s+/gi
    ];
    noisePatterns.forEach(pat => {
      cleanQuery = cleanQuery.replace(pat, '');
    });

    // Extraer palabras clave principales
    let searchTerms = cleanQuery.split(/\s+/).filter(word => {
      const cleanWord = word.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '');
      return cleanWord.length > 2 && !['que', 'del', 'los', 'con', 'para', 'una', 'uno', 'por', 'tiene', 'tienen', 'precio', 'cuesta', 'cuanto', 'como', 'donde', 'quiero', 'encargar', 'producto'].includes(cleanWord);
    });
    return { type: 'CATALOGO_SQL', term: searchTerms.join(' ') };
  }

  // 4. Fallback a conversación general/saludos
  return { type: 'SALUDO_SOPORTE_GENERAL', term: query };
}

/**
 * Enrutador híbrido de alto rendimiento.
 */
export async function hybridQuery(tenantId: string, userQuery: string) {
  // 1. Obtener manual operativo dinámico de la caché local (latencia de red reducida a 0ms en llamadas repetidas)
  const operationalManual = await getCachedOperationalManual(tenantId);

  // 2. Clasificación heurística instantánea en TypeScript (Latencia reducida de 3000ms a 0ms)
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
    // Construir consulta SQL flexible de búsqueda
    const sqlQuery = `SELECT name, price, stock, description, image_url FROM products WHERE name ILIKE '%${decision.term}%' OR description ILIKE '%${decision.term}%'`;
    
    let rawSqlResults;
    if (tenantId === rotteriTenantId) {
      rawSqlResults = await executeLiveRotteriSql(sqlQuery);
    } else {
      rawSqlResults = await executeSecureSql(tenantId, sqlQuery);
    }
    
    const humanResponse = await generateHumanResponse(userQuery, rawSqlResults.results, 'SQL', operationalManual);
    return {
      ...rawSqlResults,
      humanResponse
    };
  }

  // Flujo C: Consulta semántica de envíos RAG (1 sola llamada al LLM para responder)
  if (decision.type === 'ENVIOS_SEMANTIC') {
    const rawSemanticResults = await executeSemanticSearch(tenantId, decision.term);
    const humanResponse = await generateHumanResponse(userQuery, rawSemanticResults.results, 'SEMANTIC', operationalManual);
    return {
      ...rawSemanticResults,
      humanResponse
    };
  }

  // Flujo D: Captura y validación estructurada de pedidos
  if (decision.type === 'REGISTRO_PEDIDO') {
    const openai = getOpenRouterClient();

    // Extracción local del nombre del producto (sin LLM) desde el patrón del botón del widget
    let productNameLocal: string | null = null;
    const widgetOrderMatch = userQuery.match(/quiero\s+(?:encargar|comprar)\s+(?:el\s+)?producto\s*:\s*(.+)/i);
    if (widgetOrderMatch) {
      productNameLocal = widgetOrderMatch[1].trim();
    }
    
    const extractionPrompt = `Actúas como un extractor de datos de pedidos para "Eteba Chat".
Analiza la consulta del usuario y extrae la información de compra estructurada en un objeto JSON válido con las siguientes claves:
{
  "customer_name": "Nombre completo de la persona o null si no se proporciona",
  "phone": "Número de teléfono extraído (si no tiene prefijo, agrégalo o mantenlo) o null si no se proporciona",
  "address": "Dirección de entrega o ciudad (Malabo o Bata o similar) o null si no se proporciona",
  "product_name": "Nombre o tipo de producto que desea comprar o null si no se especifica"
}

Responde estrictamente con el JSON, sin texto adicional, sin bloques de código markdown.`;

    const extractionResponse = await openai.chat.completions.create({
      model: 'openrouter/free',
      messages: [
        { role: 'system', content: extractionPrompt },
        { role: 'user', content: userQuery }
      ],
      temperature: 0
    });

    let rawJson = extractionResponse.choices[0]?.message?.content || '{}';
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
      const missingPrompt = `El cliente desea hacer un pedido de ${productMention}.
Faltan los siguientes datos: ${missingFields.join(', ')}.
Solicítale de forma muy cálida y entusiasta en un único mensaje los datos restantes. Menciona el producto que quiere comprar para que sepa que lo registraste.`;

      const response = await openai.chat.completions.create({
        model: 'openrouter/free',
        messages: [
          { role: 'system', content: operationalManual || 'Eres un asistente de ventas muy amable de Rotteri.' },
          { role: 'user', content: missingPrompt }
        ],
        temperature: 0.3
      });
      humanResponse = response.choices[0]?.message?.content || 'Por favor, indícanos tus datos para procesar tu orden.';

      // No renderizar tarjeta de producto cuando faltan datos (el flujo continúa en próximos mensajes)
      return {
        type: 'SALUDO_SOPORTE_GENERAL' as const,
        results: [],
        humanResponse
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
      const successPrompt = `El cliente ha completado su pedido${pedidoRef}:
- Nombre: ${data.customer_name}
- Teléfono: ${data.phone}
- Ciudad de entrega: ${data.address}
- Producto: ${data.product_name}${precioProd > 0 ? `\n- Precio: ${precioProd.toLocaleString('es-ES')} CFA` : ''}
El pedido YA FUE GUARDADO en nuestro sistema${pedidoRef}. Confirma el pedido de forma muy cálida, menciona el número de referencia si lo tienes, y dile que pronto lo contactarán para coordinar la entrega en ${data.address}.`;

      const response = await openai.chat.completions.create({
        model: 'openrouter/free',
        messages: [
          { role: 'system', content: operationalManual || 'Eres un asistente de ventas muy amable de Rotteri.' },
          { role: 'user', content: successPrompt }
        ],
        temperature: 0.3
      });
      humanResponse = response.choices[0]?.message?.content || `¡Pedido${pedidoRef} registrado con éxito! Pronto te contactaremos.`;

      return {
        type: 'SALUDO_SOPORTE_GENERAL' as const,
        results: [],
        humanResponse
      };
    }

  }


  throw new Error('Intención desconocida.');
}

/**
 * Llama al proxy PHP (producción) o a MySQL directo (local).
 * En ambos casos devuelve el mismo formato de resultados.
 */
async function executeLiveRotteriSql(searchTerm: string) {
  console.log(`🔌 Buscando productos: "${searchTerm}"`);

  // ─── PRODUCCIÓN: llamar al proxy PHP ────────────────────────────────────────
  if (ROTTERI_PROXY_URL) {
    const resp = await fetch(ROTTERI_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Token': ROTTERI_PROXY_TOKEN,
      },
      body: JSON.stringify({ action: 'search_products', term: searchTerm }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Proxy PHP error ${resp.status}: ${errText}`);
    }

    const json = await resp.json() as { results: any[] };
    return { type: 'SQL' as const, sql: '/* proxy */', results: json.results || [] };
  }

  // ─── LOCAL: MySQL directo ────────────────────────────────────────────────────
  const pool = await getMysqlPool();
  if (!pool) throw new Error('MySQL pool no inicializado');

  // Expandir sinónimos bilingües para la búsqueda
  const synonymMap: Record<string, string[]> = {
    wig: ['peluca'], wigs: ['peluca'], peluca: ['wig'], pelucas: ['wig'],
    sneaker: ['zapatilla'], sneakers: ['zapatilla'], zapatilla: ['sneaker'], zapatillas: ['sneaker'],
    headphone: ['auricular'], headphones: ['auricular'], auricular: ['headphone'], auriculares: ['headphone'],
  };

  const terms = [searchTerm];
  const lower = searchTerm.toLowerCase();
  for (const [key, synonyms] of Object.entries(synonymMap)) {
    if (lower.includes(key)) {
      synonyms.forEach(s => { if (!terms.includes(s)) terms.push(s); });
    }
  }

  const whereClauses = terms.map(() =>
    '(nombre LIKE ? OR descripcion LIKE ?)'
  ).join(' OR ');
  const params = terms.flatMap(t => [`%${t}%`, `%${t}%`]);

  const mysqlQuery = `SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos WHERE (${whereClauses}) AND cantidad > 0 ORDER BY nombre ASC LIMIT 10`;
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
