import { ingestKnowledge, insforge } from '../ingest.js';

(async () => {
  console.log('🚀 Iniciando pipeline de ingesta de prueba para Rotteri en ES Modules...');
  
  // ID de Tenant de prueba para la plataforma Rotteri (UUID)
  const testTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';
  
  // Manual Operativo de la Empresa Rotteri (Guinea Ecuatorial)
  const rotteriManual = `Somos Rotteri, el marketplace líder en Guinea Ecuatorial que conecta tiendas locales con compradores, agencias de envío y puntos de pago. Tu nombre es Asistente de Rotteri.
Habla de manera sumamente empática, humana, fluida, natural y comercial. Adáptate al tono de la consulta del cliente.

Reglas del negocio para atender consultas y compras:
1. Catálogo e Inventario: Contamos con zapatillas, auriculares profesionales, teclados y micrófonos de estudio. Ofrece siempre los productos basándote en los datos de la base de datos en Francos CFA (CFA).
2. Procesamiento de Pedidos (Ventas): Si un cliente decide hacer un pedido o encargar un producto de nuestro catálogo, pídele amablemente los siguientes tres datos:
   - Su Nombre Completo.
   - Su Número de Teléfono (con el prefijo de Guinea Ecuatorial +240).
   - Su Dirección o Ciudad de entrega (Malabo o Bata).
   Explícale que una vez tomados los datos, un asesor de la tienda se pondrá en contacto directo con él para acordar el pago y la entrega.
3. Envíos y Tarifas: Trabajamos de la mano con agencias asociadas como "Abeme Modjobuy Envios" para el tracking y entrega de paquetes.
4. Cero Alucinaciones: Cíñete estrictamente a las existencias, precios y reglas de este manual. Si te preguntan por un producto que no está en el catálogo, indica con amabilidad y honestidad que no contamos con stock por el momento.`;

  // Datos conceptuales para búsqueda semántica (reglas de envío y tarifas de Rotteri)
  const testContent = `En Rotteri colaboramos con agencias de envío líderes como "Abeme Modjobuy Envios" para enviar tus compras de forma segura.
Nuestras rutas de envíos internacionales conectan Ghana (Accra) y Togo (Lomé) con Guinea Ecuatorial (Malabo y Bata).
Tarifas de envío de Abeme Modjobuy Envios:
- De Ghana (Accra) a Guinea Ecuatorial (Malabo): Tarifa base de 6,000 CFA por kilo. Entrega en 3 a 7 días.
- De Ghana (Accra) a Guinea Ecuatorial (Bata): Tarifa base de 7,500 CFA por kilo. Entrega en 3 a 10 días.
- De Togo (Lomé) a Guinea Ecuatorial (Malabo): Tarifa base de 4,000 CFA por kilo. Entrega en 3 a 7 días.
- De Togo (Lomé) a Guinea Ecuatorial (Bata): Tarifa base de 6,000 CFA por kilo. Entrega en 3 a 10 envíos.
- Envíos nacionales e inter-países africanos (Togo a Ghana): 2,000 CFA por kilo.`;

  // Catálogo de productos reales extraídos de rotteric_rotteri_db.sql
  const testProducts = [
    {
      name: 'Zapatillas Lacoste Audyssor Zip OG',
      description: 'Calzado casual premium, Sneakers, Slip-on, Color negro con suela blanca y cierre de cremallera. Excelente estilo urbano de piel sintética.',
      price: 16000.00,
      stock: 13,
      image_url: 'assets/uploads/productos/prod_1766418951_b558af55e58e6252.jpg'
    },
    {
      name: 'Audio-Technica Ath-M20x Closedback Studio Headphone',
      description: 'Auriculares de estudio cerrados, circumaurales y dinámicos, ideales para mezcla y grabación. Brindan un gran aislamiento del ruido exterior y drivers de 40mm.',
      price: 70000.00,
      stock: 17,
      image_url: 'assets/uploads/productos/prod_1766420338_21d0551a1bcc3f17.jpg'
    },
    {
      name: 'Hp Wireless Keyboard Mouse H-528 2.4g',
      description: 'Combo inalámbrico ergonómico de teclado y ratón óptico de 1600 ppp. Conexión fiable a 2.4 GHz mediante un único receptor nano USB.',
      price: 10000.00,
      stock: 18,
      image_url: 'assets/uploads/productos/prod_1766420417_1cb557503edcc23f.png'
    },
    {
      name: 'Shure Sm7b Vocal Dynamic Microphone',
      description: 'Icónico micrófono dinámico cardioide de grado profesional para podcasting, locución y estudios. Ofrece una respuesta vocal suave y cálida.',
      price: 110000.00,
      stock: 20,
      image_url: 'assets/uploads/productos/prod_1766420375_5e4fc2a08b532ef2.jpg'
    },
    {
      name: '12inch Ring Light RGB',
      description: 'Aro de luz de 12 pulgadas LED con trípode y brillo ajustable. Ideal para streaming, maquillaje, fotografía y creación de contenidos.',
      price: 12000.00,
      stock: 20,
      image_url: 'assets/uploads/productos/prod_1766420278_3465a3e518c2b959.webp'
    }
  ];

  try {
    // 1. Crear/Actualizar la compañía de prueba "Rotteri" con su manual operativo personalizado
    console.log(`Checking if test company Rotteri exists...`);
    const { data: company, error: selectError } = await insforge.database
      .from('companies')
      .select('id')
      .eq('id', testTenantId)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (!company) {
      console.log(`Creating test company: Rotteri`);
      const { error: companyError } = await insforge.database
        .from('companies')
        .insert([{ 
          id: testTenantId, 
          name: 'Rotteri Marketplace',
          operational_manual: rotteriManual 
        }]);

      if (companyError) {
        throw companyError;
      }
    } else {
      console.log(`Updating test company Rotteri with manual...`);
      const { error: companyError } = await insforge.database
        .from('companies')
        .update({ 
          name: 'Rotteri Marketplace',
          operational_manual: rotteriManual 
        })
        .eq('id', testTenantId);

      if (companyError) {
        throw companyError;
      }
    }

    // 2. Inserción del catálogo de productos de Rotteri en la tabla de productos de InsForge
    console.log(`Poblando productos reales de Rotteri en InsForge...`);
    // Limpiar productos viejos para la demo
    await insforge.database.from('products').delete().eq('tenant_id', testTenantId);

    for (const prod of testProducts) {
      const { error: prodError } = await insforge.database
        .from('products')
        .insert([{
          tenant_id: testTenantId,
          name: prod.name,
          description: prod.description,
          price: prod.price,
          stock: prod.stock,
          image_url: prod.image_url
        }]);

      if (prodError) {
        throw prodError;
      }
    }
    console.log('✅ Catálogo de productos importado con éxito.');

    // 3. Ejecutar la ingesta de conocimiento semántico (tarifas de envío)
    console.log('Ingestando manual de envíos en knowledge_base...');
    const result = await ingestKnowledge(testTenantId, testContent);
    if (result.error) {
      console.error('❌ La prueba de ingesta falló.');
      process.exit(1);
    } else {
      console.log('✨ Ingesta y catálogo de Rotteri creados exitosamente.');
      process.exit(0);
    }
  } catch (err: any) {
    console.error('❌ Error catastrófico en la prueba de ingesta:', err.message || err);
    process.exit(1);
  }
})();
