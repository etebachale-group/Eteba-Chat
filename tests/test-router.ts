import { hybridQuery, closeRouterConnections } from './router.js';

(async () => {
  console.log('🚀 Iniciando pruebas de enrutamiento híbrido RAG...');
  
  // Utilizaremos el tenant_id de prueba 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b'
  const testTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';

  try {
    // ----------------------------------------------------
    // PRUEBA 1: Consulta que debería enrutarse a SQL (estructurada)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 1: Consulta de Productos (Estructurada) ---');
    const sqlTestQuery = 'Muestra los productos disponibles que tengan stock mayor a 2 y precio menor a 100';
    const sqlResult = await hybridQuery(testTenantId, sqlTestQuery);
    console.log('📦 Resultado de la Prueba 1:', JSON.stringify(sqlResult, null, 2));

    // ----------------------------------------------------
    // PRUEBA 2: Consulta que debería enrutarse a SEMANTIC (conceptual)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Consulta Conceptual (Semántica) ---');
    const semanticTestQuery = '¿Qué soluciones desarrolla Eteba Chale Group y qué tecnologías usa?';
    const semanticResult = await hybridQuery(testTenantId, semanticTestQuery);
    console.log('📖 Resultado de la Prueba 2:', JSON.stringify(semanticResult, null, 2));

    console.log('\n✨ Todas las pruebas del enrutador finalizaron correctamente.');
  } catch (err: any) {
    console.error('\n❌ Ocurrió un error en las pruebas:', err.message || err);
  } finally {
    // Cerrar conexiones del pool para permitir una salida limpia de Node
    console.log('🔌 Cerrando conexiones de base de datos...');
    await closeRouterConnections();
    process.exit(0);
  }
})();
