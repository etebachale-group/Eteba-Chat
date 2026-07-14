# Integración Eteba Chat ↔ Rotteri — Especificación Completa

## Estado de Implementación

### ✅ Implementado (lado Eteba Chat)

1. **Widget v3.0 con autenticación**
   - Lee `window.__ETEBA_CHAT_USER__` inyectado por Rotteri
   - Si no logueado → Panel de login con Google + opción explorar
   - Si logueado → Chat completo con nombre personalizado
   - Datos del usuario se envían al backend en cada query

2. **Búsqueda inteligente con Groq**
   - Proxy devuelve catálogo → Groq filtra semánticamente
   - Soporta sinónimos bilingües y nombres técnicos

3. **Router con soporte proxy PHP**
   - `search_products` con fallback a catálogo completo
   - `insert_order` para pedidos
   - `find_product` para detalles

### ⏳ Pendiente (requiere actualización del proxy PHP en Rotteri)

4. **Nuevos endpoints del proxy:**
   - `get_product_detail` — Detalle completo + tienda
   - `list_stores` — Tiendas activas
   - `store_products` — Productos por tienda
   - `list_categories` — Categorías
   - `products_by_category` — Filtro por categoría
   - `list_agencies` — Agencias de envío
   - `shipping_rates` — Tarifas filtradas
   - `calculate_shipping` — Cálculo de costo
   - `checkout_info` — Info para checkout
   - `check_user_session` — Verificar usuario

5. **Flujo de checkout completo:**
   - Buscar → Seleccionar → Calcular envío → Confirmar → Guardar pedido

### ⏳ Pendiente (lado Rotteri PHP)

6. **Inyectar `window.__ETEBA_CHAT_USER__`** en layouts
7. **Actualizar `chat-proxy.php`** con nuevos endpoints
8. **Campo `note` en respuesta de `search_products`** (like_match / fallback_catalog / full_catalog)

## Moneda

Franco CFA (XAF). Formato: `16.000 CFA`

## Variables en Render

```
ROTTERI_PROXY_URL=https://rotteri.com/api/chat-proxy.php
ROTTERI_PROXY_TOKEN=eTb_pXy_9Kw4mR7qN2vL8jB3fZ6hD1
GROQ_API_KEY=gsk_xxx
```
