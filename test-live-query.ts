import { hybridQuery, closeRouterConnections } from './router.js';

(async () => {
  console.log('🧪 Iniciando prueba aislada de PEDIDO COMPLETO...');
  const tenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b'; // Rotteri
  
  try {
    console.log('\n--- PRUEBA 4: Pedido Exitoso (Lead Completo) ---');
    const res4 = await hybridQuery(tenantId, 'Quiero hacer el pedido de las zapatillas Lacoste. Mi nombre es Fernando Chalé, mi dirección es Malabo y mi teléfono es +240222391641');
    console.log('Intención Detectada:', res4.type);
    console.log('Resultados de Producto:', JSON.stringify(res4.results, null, 2));
    console.log('IA:', res4.humanResponse);

  } catch (err: any) {
    console.error('❌ La prueba falló:', err.message || err);
  } finally {
    await closeRouterConnections();
    process.exit(0);
  }
})();
