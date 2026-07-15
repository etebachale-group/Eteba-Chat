# Eteba Chat — Documentación Técnica Completa

> Plataforma B2B de automatización comercial con IA  
> Propiedad de [Eteba Chale Group](https://etebachalegroup.xo.je)  
> Live: https://eteba-chat.onrender.com

---

## 1. Visión General

Eteba Chat es una plataforma SaaS que permite a negocios (tiendas, servicios, restaurantes, agencias) crear asistentes virtuales de ventas con IA. El asistente:

- Atiende clientes en español, francés e inglés
- Busca productos/servicios en catálogos en tiempo real
- Procesa pedidos automáticamente usando datos de la sesión del usuario
- Aprende de cada interacción (alias de productos, errores)
- Funciona 24/7 sin intervención humana

---

## 2. Arquitectura

```
┌──────────────────┐      ┌─────────────────────────┐      ┌──────────────────┐
│  Sitio del       │      │     Eteba Chat API      │      │  Base de Datos   │
│  Negocio         │─────▶│     (Render.com)        │─────▶│  del Negocio     │
│  (Widget JS)     │◀─────│                         │◀─────│  (MySQL/PG)      │
└──────────────────┘      └─────────────────────────┘      └──────────────────┘
        │                          │         │
        │                   ┌──────┴───┐  ┌──┴──────────┐
        │                   │   Groq   │  │  InsForge   │
        │                   │  (LLM)   │  │  (Postgres) │
        │                   └──────────┘  └─────────────┘
        │
  ┌─────┴────────────────┐
  │ window.__ETEBA_CHAT   │
  │ _USER__ (datos del    │
  │ usuario logueado)     │
  └──────────────────────┘
```

### Componentes:

| Componente | Responsabilidad | Tecnología |
|------------|-----------------|-----------|
| Widget (widget.js) | UI del chat flotante + auth | JS vanilla |
| Frontend SPA (index.html) | Landing + Dashboard + Docs + Chat Universal | HTML/CSS/JS |
| API Backend (server.ts) | Endpoints REST + OAuth + Proxy connector | Express/TypeScript |
| Motor IA (router.ts) | Clasificación + RAG + LLM + Aliases + Memoria | TypeScript |
| Proxy PHP | Puente entre API y MySQL del negocio | PHP |
| InsForge | DB principal (users, companies, knowledge) | PostgreSQL |
| Groq | LLM para generar respuestas (~500ms) | Llama 3.1 8B |

---

## 3. Páginas de la Plataforma

### 3.1 Landing (`/`)
- Hero con CTA de registro
- Features (6 cards con iconos SVG)
- Social proof (logos de negocios conectados)
- Pricing (Starter gratis / Business / Enterprise)

### 3.2 Explorar (`/#explore`)
- Directorio de negocios conectados
- Buscador + filtros por categoría
- **Chat Universal integrado** — Click "Chatear" abre chat inline con cualquier negocio
- Tarjetas de producto con precio y botón "Encargar"

### 3.3 Dashboard (`/#dashboard`)
- Requiere autenticación (Google OAuth)
- Saludo personalizado (hora del día + nombre)
- Métricas dinámicas (pedidos, productos, tiempo respuesta)
- Quick actions (agregar producto, editar asistente, probar chat)
- Tabs: Overview, Conversaciones, Pedidos, Catálogo, Configuración, Integraciones, API Keys

### 3.4 Docs (`/#docs`)
- Introducción
- Inicio Rápido
- Widget Embebido
- API Reference
- Webhooks
- Autenticación
- Ejemplos
- **Prompt Vibecoder** — Prompt copiable para que IAs generen la integración

---

## 4. API Endpoints

### Públicos

| Método | Endpoint | Body | Descripción |
|--------|----------|------|-------------|
| POST | `/api/query` | `{tenantId, prompt, user?}` | Consulta al asistente |
| POST | `/api/ingest` | `{tenantId, content}` | Ingestar conocimiento RAG |

### Dashboard (requiere sesión)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/orders?tenantId=x` | Listar pedidos |
| GET | `/api/catalog?tenantId=x` | Listar productos |
| POST | `/api/catalog` | Agregar producto |
| POST | `/api/config` | Guardar configuración |
| POST | `/auth/link` | Verificar vinculación por email |

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/auth/google` | Iniciar OAuth |
| GET | `/auth/google/callback` | Callback OAuth |
| GET | `/auth/me?token=x` | Obtener usuario |

---

## 5. Motor IA (router.ts)

### 5.1 Flujo de una consulta

```
1. Request llega: {tenantId, prompt, user}
2. Cargar manual operativo (caché 10 min)
3. Clasificar intención (heurísticas, 0ms)
4. Según intención:
   a. CATALOGO_SQL → expandir aliases → proxy → Groq filter → respuesta
   b. TIENDAS → proxy list_stores → respuesta
   c. ENVIO_CALCULO → extraer origen/destino → proxy → respuesta
   d. REGISTRO_PEDIDO → detectar producto → confirmar → guardar
   e. SALUDO → LLM con manual + memoria
5. Guardar en memoria de conversación
6. Aprender de errores
7. Devolver respuesta
```

### 5.2 Sistema de Aliases

Diccionario de 200+ entradas con traducciones ES/FR/EN:

```typescript
'tenis' → ['zapatilla', 'sneaker', 'chaussure sport', 'basket']
'cascos' → ['auricular', 'headphone', 'écouteur', 'casque']
'perruque' → ['peluca', 'wig', 'hair']
'sudadera' → ['hoodie', 'sweat', 'buzo']
'regalo' → ['accesorio', 'perfume', 'joya', 'cadeau']
```

Se expanden automáticamente al buscar. Además aprende relaciones nuevas cuando una búsqueda tiene éxito.

### 5.3 Memoria de Conversación

```typescript
// Clave: tenantId:userId
// Almacena: últimos 8 mensajes
// TTL: 15 minutos sin actividad
// Uso: se inyecta en el prompt para contexto
```

### 5.4 Sistema de Aprendizaje

```typescript
// Si la IA dice "no tenemos" cuando HAY productos en los datos:
addLearning(tenantId, "Cuando hay productos en DATOS, muéstralos siempre");
// Se inyecta en futuros prompts como instrucción negativa
```

---

## 6. Widget (widget.js v3)

### 6.1 Autenticación

Lee `window.__ETEBA_CHAT_USER__`:
- `logged: true` → Chat abierto con saludo personalizado
- `logged: false` → Panel de login (Google + explorar sin cuenta)

### 6.2 Datos del usuario

```javascript
window.__ETEBA_CHAT_USER__ = {
  id: 62,                           // ID en el sistema del negocio
  name: "Wono Won",                 // Nombre (para personalizar)
  email: "wonferche@gmail.com",     // Email (vinculación universal)
  phone: "+240222520265",           // Teléfono (para pedidos)
  logged: true,                     // Estado de auth
  loginUrl: "https://..."           // URL de login (si no logueado)
};
```

### 6.3 Flujo visual

```
[Launcher button] → Click → [Chat window]
                              ├── Header (nombre negocio + status)
                              ├── Body (mensajes + product cards)
                              ├── Footer (input + send)
                              └── Watermark "Powered by Eteba Chat"
```

### 6.4 Product Cards

Cuando la API devuelve `type: "SQL"` con `results`, el widget renderiza tarjetas:
- Imagen del producto
- Nombre + precio en CFA
- Stock disponible + origen
- Botón "Encargar" (auto-envía el pedido)

---

## 7. Proxy PHP

### 7.1 Acciones disponibles

| Acción | Descripción |
|--------|-------------|
| `search_products` | Buscar por texto (con fallback a catálogo completo) |
| `find_product` | Buscar por nombre exacto |
| `get_product_detail` | Detalle + tienda |
| `list_stores` | Tiendas activas |
| `store_products` | Productos de una tienda |
| `list_categories` | Categorías |
| `products_by_category` | Filtrar por categoría |
| `list_agencies` | Agencias de envío |
| `shipping_rates` | Tarifas filtradas |
| `calculate_shipping` | Cálculo de costo |
| `insert_order` | Guardar pedido |
| `check_user_session` | Verificar usuario |

### 7.2 Respuesta de search_products

```json
{
  "results": [
    {"id": 12, "name": "Zapatillas Lacoste", "price": "16000.00", "stock": 13, "tags": "Moda", "origin": "Lomé, Togo"}
  ],
  "query": "zapatillas",
  "count": 5,
  "note": "like_match"
}
```

`note` posibles: `like_match`, `fallback_catalog`, `full_catalog`

Si `note === "fallback_catalog"`: Groq filtra semánticamente los resultados.

---

## 8. Autenticación y Vinculación

### 8.1 Flujo OAuth

```
Usuario → /auth/google → Google consent → /auth/google/callback
→ Buscar por EMAIL (no por google_id)
→ Si existe: vincular y actualizar
→ Si no: crear usuario + company
→ Token base64url → redirect a /?auth_token=xxx
```

### 8.2 Vinculación por Email

El email es el identificador universal:
- Si `wonferche@gmail.com` está en Rotteri y en Eteba Chat → misma identidad
- Los admins de negocios se configuran en el mapa `businessOwners` en server.ts

### 8.3 Admins de Negocios

```typescript
const businessOwners = {
  'rotterinzakus@gmail.com': { tenantId: 'e22e9ee0-...', role: 'admin' },
  // Agregar más aquí
};
```

Cuando un admin se loguea, su dashboard muestra datos de su negocio.

---

## 9. Base de Datos

### PostgreSQL (InsForge)

| Tabla | Campos clave |
|-------|-------------|
| `users` | id, google_id, email, name, avatar_url, role |
| `companies` | id, name, operational_manual, business_type, owner_id |
| `products` | id, tenant_id, name, price, stock, description, image_url |
| `knowledge_base` | id, tenant_id, content, embedding(384d) |
| `pedidos_chat` | id, tenant_id, producto_nombre, cliente_*, status |

### MySQL (Rotteri via proxy)

| Tabla | Campos clave |
|-------|-------------|
| `productos` | id, nombre, precio, cantidad, descripcion, imagen_url, tags |
| `pedidos_chat` | id, producto_nombre, cliente_nombre, ciudad_entrega |
| `tiendas` | id, nombre, slug, telefono |
| `agencias_envio` | id, nombre, telefono, cobertura |
| `tarifas_envio` | id, agencia_id, origen, destino, precio |

---

## 10. IA — Proveedores

### Primario: Groq
- Modelo: `llama-3.1-8b-instant`
- Latencia: ~300-800ms
- Free tier: 30 RPM, 6000 RPD
- Usado para: respuestas, extracción, filtrado

### Fallback: OpenRouter
- Modelo: `meta-llama/llama-3.1-8b-instruct:free`
- Se activa si Groq falla
- Free tier: variable

### Respuestas
- `max_tokens`: 150-200 (respuestas cortas)
- `temperature`: 0.3 (determinista pero natural)
- Estilo: WhatsApp (1-3 frases máximo)

---

## 11. Seguridad

| Aspecto | Implementación |
|---------|---------------|
| Auth | Google OAuth 2.0 + tokens base64url |
| Proxy | Header `X-Chat-Token` para autenticar |
| Multi-tenant | Datos aislados por tenant_id |
| RLS | Políticas en PostgreSQL |
| CORS | Habilitado solo para dominios autorizados |
| Secrets | En .env.local (no commiteados) + variables de Render |

---

## 12. Personalización CSS del Widget

```css
.eteba-ai-widget-container {
  --eteba-w-purple: #9D4EDD;   /* Color principal */
  --eteba-w-blue: #4361EE;     /* Secundario */
  --eteba-w-cyan: #00B4D8;     /* Acentos */
  --eteba-w-bg: #141B2D;       /* Fondo */
  bottom: 20px;                 /* Posición */
  right: 20px;
}
```

---

## 13. Moneda

- **Franco CFA (XAF)** por defecto
- Formato: `16.000 CFA` (punto como separador de miles)
- Configurable por tenant

---

## 14. Idiomas

| Idioma | Soporte |
|--------|---------|
| Español | Completo (interfaz + IA) |
| Francés | IA + aliases de productos |
| Inglés | IA + aliases de productos |

Detección automática: el bot responde en el idioma del mensaje del usuario.

---

## 15. Desarrollo Local

```bash
npm install
npm run build
npm start
# → http://localhost:3000
```

Variables necesarias en `.env.local` (copiar de `.env.example`).

---

## 16. Deploy

Render.com con auto-deploy desde `main`:
- Build: `npm install && npm run build`
- Start: `node dist/server.js`
- Variables de entorno en el dashboard de Render

---

## 17. Roadmap

| Feature | Estado | Prioridad |
|---------|--------|-----------|
| Widget v3 con auth | ✅ | — |
| Chat Universal (Explorar) | ✅ | — |
| Sistema de aliases trilingüe | ✅ | — |
| Memoria de conversación | ✅ | — |
| Pedidos sin fricción | ✅ | — |
| Vinculación por email | ✅ | — |
| Dashboard admin | ✅ | — |
| Docs + Prompt Vibecoder | ✅ | — |
| JWT real (expiración) | ⏳ | Alta |
| Webhooks reales | ⏳ | Media |
| WhatsApp Business | ⏳ | Media |
| Telegram Bot | ⏳ | Baja |
| Stripe/AfroPay pagos | ⏳ | Baja |
| Dashboard analytics gráficos | ⏳ | Baja |

---

## 18. Soporte

- **Web:** [eteba-chat.onrender.com](https://eteba-chat.onrender.com)
- **Empresa:** [Eteba Chale Group](https://etebachalegroup.xo.je)
- **Repo:** github.com/etebachale-group/Eteba-Chat

---

*Documentación generada: Julio 2026*
