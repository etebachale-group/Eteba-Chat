import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors'; // Habilitar CORS para consultas externas y locales del widget
import path from 'path';
import { fileURLToPath } from 'url';
import { hybridQuery } from './router.js';
import { ingestKnowledge } from './ingest.js';

const app = express();
const PORT = process.env.PORT || 3000;

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

// Levantar el servidor
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor Antigravity RAG levantado con éxito.`);
  console.log(`👉 Visita: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
