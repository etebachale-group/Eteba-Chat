# ⚡ Eteba Chat

**Plataforma de automatización comercial con IA para negocios africanos.**

Permite a cualquier empresa crear asistentes virtuales inteligentes que atienden clientes, buscan en catálogos en tiempo real y procesan pedidos — las 24 horas, sin intervención humana.

🌐 **Live:** [https://eteba-chat.onrender.com](https://eteba-chat.onrender.com)

---

## Características

- 🤖 **Asistente IA personalizable** — Manual operativo, tono e idioma configurables por negocio
- 🛒 **Búsqueda de catálogo en tiempo real** — Consulta inventario, precios y stock al instante
- 📦 **Gestión automática de pedidos** — Captura datos del cliente y registra la orden
- 🔌 **API REST documentada** — Integra el asistente en cualquier sistema o app
- 🌍 **Multi-tenant** — Cada negocio tiene su espacio aislado con datos propios
- 🔐 **Google OAuth** — Login con un click, registro automático
- 📊 **Dashboard** — Métricas, catálogo CRUD, configuración, API keys
- 📝 **Documentación integrada** — Guías, API reference, ejemplos en múltiples lenguajes
- 💬 **Widget embebible** — Una línea de código para instalar en cualquier web

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express + TypeScript |
| Base de datos | PostgreSQL (InsForge) + MySQL (proxy PHP) |
| IA / LLM | OpenRouter (modelos gratuitos) |
| Embeddings | Xenova/Transformers (all-MiniLM-L6-v2, 384d) |
| Autenticación | Google OAuth 2.0 |
| Frontend | HTML + CSS + JS vanilla (SPA) |
| Hosting | Render.com (free tier) |
| Repo | GitHub |

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
│   ├── 001-schema.sql      # Esquema base (companies, products, knowledge)
│   ├── 002-users-auth.sql  # Tabla users (Google OAuth)
│   └── 003-dashboard-policies.sql  # RLS + pedidos_chat
├── tests/
│   ├── test-ingest.ts      # Test de ingesta
│   ├── test-live-query.ts  # Test de query en vivo
│   └── test-router.ts      # Test del router IA
├── docs/
│   ├── configurar-rotteri.md       # Guía del proxy PHP
│   ├── configurar-google-auth.md   # Guía de OAuth
│   └── prompt-rotteri-widget.md    # Prompt para verificar widget
├── .env.example            # Plantilla de variables de entorno
├── .gitignore
├── package.json
├── tsconfig.json
├── Procfile                # Start command para Render
└── AGENTS.md               # Reglas para asistentes IA
```

---

## API Endpoints

### Públicos (sin auth)

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

## Motor IA (router.ts)

El router clasifica la intención del usuario **sin llamar al LLM** (latencia 0ms) usando heurísticas de texto:

| Intención | Acción | Fuente de datos |
|-----------|--------|-----------------|
| `CATALOGO_SQL` | Buscar productos | MySQL (proxy PHP) o Postgres |
| `ENVIOS_SEMANTIC` | Búsqueda semántica RAG | Postgres + embeddings |
| `REGISTRO_PEDIDO` | Capturar datos + guardar orden | LLM extracción + DB |
| `SALUDO_SOPORTE_GENERAL` | Respuesta conversacional | LLM + manual operativo |

Sinónimos bilingües soportados: wig↔peluca, sneaker↔zapatilla, headphone↔auricular.

---

## Widget Embebido

Instalar en cualquier sitio web:

```html
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=TU_TENANT_ID"></script>
```

Features:
- Auto-detecta entorno (local/producción)
- Tarjetas de producto con imagen, precio y CTA "Encargar"
- Responsive (móvil + desktop)
- Glassmorphism UI oscuro

---

## Variables de Entorno

```env
INSFORGE_BASE_URL=https://xxx.us-east.insforge.app
INSFORGE_API_KEY=ik_xxx
DATABASE_URL=postgresql://...
OPENROUTER_API_KEY=sk-or-v1-xxx
ROTTERI_PROXY_URL=https://rotteri.com/api/chat-proxy.php
ROTTERI_PROXY_TOKEN=xxx
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

---

## Desarrollo Local

```bash
# Instalar dependencias
npm install

# Compilar TypeScript
npm run build

# Iniciar servidor
npm start

# Desarrollo (compilar + iniciar)
npm run dev
```

Abre `http://localhost:3000`

---

## Deploy (Render)

El proyecto se despliega automáticamente desde GitHub:

- **Build:** `npm install && npm run build`
- **Start:** `node dist/server.js`
- **URL:** https://eteba-chat.onrender.com

---

## Bases de Datos

### PostgreSQL (InsForge) — Datos principales
- `companies` — Tenants (negocios registrados)
- `users` — Usuarios autenticados con Google
- `products` — Catálogo de productos/servicios
- `knowledge_base` — Chunks de conocimiento con embeddings (RAG)
- `pedidos_chat` — Pedidos de tenants sin proxy PHP

### MySQL (Rotteri via proxy PHP) — Integración legacy
- `productos` — Catálogo de Rotteri
- `pedidos_chat` — Pedidos generados desde el widget de Rotteri

---

## Integraciones

| Integración | Estado |
|-------------|--------|
| Widget Web embebido | ✅ Activo |
| Google OAuth login | ✅ Activo |
| Proxy PHP (MySQL Rotteri) | ✅ Activo |
| WhatsApp Business | 🔜 Próximamente |
| Telegram Bot | 🔜 Próximamente |
| Webhooks | 🔜 Próximamente |

---

## Licencia

ISC © [Eteba Chale Group](https://etebachalegroup.xo.je)
