import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch'; // o usar global fetch en Node 18+

async function run() {
  const url = process.env.ROTTERI_PROXY_URL!;
  const token = process.env.ROTTERI_PROXY_TOKEN!;

  console.log(`🔌 Probando conexión directa al proxy: ${url}`);
  console.log(`🔑 Token: ${token}`);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Token': token,
      },
      body: JSON.stringify({ action: 'search_products', term: 'zapatilla', limit: 10 }),
    });

    console.log(`Status: ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    console.log('Response body:', text);

  } catch (err: any) {
    console.error('❌ Error de conexión:', err);
  }
}

run().catch(console.error);
