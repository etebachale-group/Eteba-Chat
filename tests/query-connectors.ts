import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

async function run() {
  console.log('🔍 Consultando conector_registry para Rotteri...');
  const { data: registry, error: regErr } = await insforge.database
    .from('connector_registry')
    .select('*');

  if (regErr) {
    console.error('❌ Error:', regErr);
    return;
  }

  console.log('🔌 Conectores registrados:', JSON.stringify(registry, null, 2));
}

run().catch(console.error);
