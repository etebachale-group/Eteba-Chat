import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import { pipeline } from '@xenova/transformers';

// 1. Validar variables de entorno clave para InsForge
const baseUrl = process.env.INSFORGE_BASE_URL;
const apiKey = process.env.INSFORGE_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error('❌ Error: INSFORGE_BASE_URL o INSFORGE_API_KEY no están configurados en .env.local.');
}

// 2. Inicializar el cliente del SDK de InsForge para la Base de Datos
export const insforge = createClient({
  baseUrl: baseUrl,
  anonKey: apiKey,
});

// Variable para almacenar el pipeline en memoria y evitar recargarlo en cada consulta
let extractorInstance: any = null;

/**
 * Obtiene o inicializa la instancia local del modelo de embeddings de Hugging Face.
 * Utiliza Xenova/all-MiniLM-L6-v2 (384 dimensiones) de forma local y 100% gratuita.
 */
export async function getExtractor() {
  if (!extractorInstance) {
    console.log('🤖 Cargando modelo de embeddings local Xenova/all-MiniLM-L6-v2...');
    extractorInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✅ Modelo cargado con éxito.');
  }
  return extractorInstance;
}

/**
 * Genera el embedding de un texto usando el modelo local y lo guarda
 * en la tabla knowledge_base bajo el tenant_id especificado.
 * 
 * @param tenantId UUID del cliente multi-tenant
 * @param content Texto o documento a indexar
 */
export async function ingestKnowledge(tenantId: string, content: string) {
  try {
    console.log(`🤖 Generando embedding local para el tenant: ${tenantId}...`);
    const extractor = await getExtractor();

    // Generar el vector (tensor de salida) de forma local
    const output = await extractor(content.trim(), {
      pooling: 'mean',
      normalize: true,
    });

    // Convertir el tensor de ONNX Runtime a un array de floats nativo
    const embedding = Array.from(output.data) as number[];
    
    if (!embedding || embedding.length !== 384) {
      throw new Error(`Error en el embedding: se esperaban 384 dimensiones, se obtuvieron ${embedding?.length || 0}.`);
    }

    console.log('✅ Embedding local generado con éxito (384d). Guardando en InsForge...');

    // Insertar en la base de datos de InsForge
    const { data, error } = await insforge.database
      .from('knowledge_base')
      .insert([
        {
          tenant_id: tenantId,
          content: content,
          embedding: embedding, // Postgres pgvector mapea automáticamente el array a vector(384)
        }
      ])
      .select();

    if (error) {
      throw error;
    }

    console.log('🎉 Documento guardado con éxito en knowledge_base.');
    return { data, error: null };
  } catch (err: any) {
    console.error('❌ Error en el proceso de ingesta:', err.message || err);
    return { data: null, error: err };
  }
}
