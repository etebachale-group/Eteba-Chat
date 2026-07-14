# Eteba Chat

**Plataforma B2B de automatización comercial con IA.**

Permite a negocios crear asistentes virtuales inteligentes que atienden clientes, buscan en catálogos en tiempo real y procesan pedidos — 24/7, sin intervención humana.

**Live:** [https://eteba-chat.onrender.com](https://eteba-chat.onrender.com)

---

## Características

- **Asistente IA personalizable** — Manual operativo, tono e idioma configurables por negocio
- **Búsqueda de catálogo en tiempo real** — Consulta inventario, precios y stock al instante
- **Gestión automática de pedidos** — Captura datos del cliente y registra la orden
- **API REST documentada** — Integra el asistente en cualquier sistema o app
- **Multi-tenant** — Cada negocio tiene su espacio aislado con datos propios
- **Google OAuth** — Login con un click, registro automático
- **Dashboard** — Métricas, catálogo CRUD, configuración, API keys
- **Documentación integrada** — Guías, API reference, ejemplos
- **Widget embebible** — Una línea de código para instalar en cualquier web

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express + TypeScript |
| Base de datos | PostgreSQL (InsForge) + MySQL (proxy PHP) |
| IA / LLM | OpenRouter |
| Embeddings | Xenova/Transformers (all-MiniLM-L6-v2, 384d) |
| Autenticación | Google OAuth 2.0 |
| Frontend | HTML + CSS + JS vanilla (SPA) |
| Hosting | Render.com |

---

## Estructura del Proyecto

```
Eteba Chat/
├── index.html              # Frontend SPA (Landing + Dashboard + Docs)
├── server.ts               # Express server + API endpoints + OAuth
├── router.ts               # Motor IA: clasificador heurístico + RAG híbrido
├── ingest.ts               # Pipeline de ingesta de conocimiento
├── styles/
│   ├── main.css            # Design system (variables, reset, componentes)
│   ├── landing.css         # Hero, features, pricing, explore
│   ├── dashboard.css       # Panel admin, modales, toasts, tablas
│   └── docs.css            # Documentación
├── scripts/
│   ├── router.js           # Navegación SPA (hash-based)
│   ├── auth.js             # Google OAuth (frontend)
│   ├── explore.js          # Directorio de negocios
│   ├── dashboard.js        # Panel admin + CRUD catálogo
│   └── app.js              # Entry point + utilidades
├── widget/
│   ├── widget.js           # Widget embebible (auto-contenido)
│   └── widget.css          # Estilos del widget
├── sql/
│   ├── 001-schema.sql      # Esquema base
│   ├── 002-users-auth.sql  # Tabla users (Google OAuth)
│   └── 003-dashboard-policies.sql  # RLS + pedidos_chat
├── tests/                  # Tests de desarrollo
├── docs/                   # Guías internas de configuración
├── .env.example            # Plantilla de variables de entorno
├── package.json
├── tsconfig.json
└── Procfile                # Start command para Render
```

---

## API Endpoints

### Públicos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/query` | Enviar consulta al asistente IA |
| `POST` | `/api/ingest` | Ingestar conocimiento (RAG semántico) |

### Dashboard (requiere sesión)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/orders?tenantId=x` | Listar pedidos del negocio |
| `GET` | `/api/catalog?tenantId=x` | Listar catálogo de productos |
| `POST` | `/api/catalog` | Agregar producto al catálogo |
| `POST` | `/api/config` | Guardar configuración del asistente |

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/auth/google` | Iniciar login con Google |
| `GET` | `/auth/google/callback` | Callback OAuth |
| `GET` | `/auth/me?token=x` | Obtener usuario actual |

---

## Motor IA

El router clasifica la intención del usuario **sin llamar al LLM** (latencia 0ms) usando heurísticas de texto:

| Intención | Acción | Fuente de datos |
|-----------|--------|-----------------|
| `CATALOGO_SQL` | Buscar productos | MySQL (proxy PHP) o Postgres |
| `ENVIOS_SEMANTIC` | Búsqueda semántica RAG | Postgres + embeddings 384d |
| `REGISTRO_PEDIDO` | Capturar datos + guardar orden | LLM extracción + DB |
| `SALUDO_SOPORTE_GENERAL` | Respuesta conversacional | LLM + manual operativo |

---

## Widget Embebido

```html
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=TU_TENANT_ID"></script>
```

- Auto-detecta entorno (local/producción)
- Tarjetas de producto con imagen, precio y CTA
- Responsive (móvil + desktop)
- Personalizable con CSS custom properties

---

## Variables de Entorno

Copia `.env.example` a `.env.local` y rellena con tus valores reales:

```env
# InsForge
INSFORGE_BASE_URL=https://xxx.us-east.insforge.app
INSFORGE_API_KEY=ik_xxx

# Postgres
DATABASE_URL=postgresql://...

# LLM
OPENROUTER_API_KEY=sk-or-v1-xxx

# Proxy MySQL (producción)
ROTTERI_PROXY_URL=https://tu-sitio.com/api/chat-proxy.php
ROTTERI_PROXY_TOKEN=tu_token_secreto

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

> **Nunca** subas `.env.local` al repositorio. Está excluido en `.gitignore`.

---

## Desarrollo Local

```bash
npm install
npm run build
npm start
```

Abre `http://localhost:3000`

---

## Deploy (Render)

Deploy automático desde GitHub en cada push a `main`:

- **Build:** `npm install && npm run build`
- **Start:** `node dist/server.js`
- **URL:** https://eteba-chat.onrender.com

Variables de entorno se configuran en el dashboard de Render.

---

## Bases de Datos

### PostgreSQL (InsForge)
- `companies` — Tenants (negocios registrados)
- `users` — Usuarios autenticados con Google
- `products` — Catálogo de productos/servicios
- `knowledge_base` — Chunks con embeddings (RAG)
- `pedidos_chat` — Pedidos de tenants sin proxy PHP

### MySQL (via proxy PHP)
- `productos` — Catálogo legacy
- `pedidos_chat` — Pedidos desde widget

---

## Integraciones

| Integración | Estado |
|-------------|--------|
| Widget Web embebido | Activo |
| Google OAuth | Activo |
| Proxy PHP (MySQL) | Activo |
| WhatsApp Business | Próximamente |
| Telegram Bot | Próximamente |
| Webhooks | Próximamente |

---

## Design System

Paleta de marca basada en el logo oficial:

- Purple Light: `#9D4EDD`
- Purple Main: `#7209B7`
- Blue Main: `#4361EE`
- Cyan: `#00B4D8`
- Background: `#141B2D`

UI: Glassmorphism oscuro elegante con backdrop-filter, bordes translúcidos y gradientes sutiles de marca.

---

## Licencia

ISC © [Eteba Chale Group](https://etebachalegroup.xo.je)
