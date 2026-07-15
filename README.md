# Eteba Chat

**Plataforma B2B de automatización comercial con IA para negocios africanos y globales.**

Permite a cualquier empresa crear asistentes virtuales inteligentes que atienden clientes, buscan en catálogos multiidioma en tiempo real, procesan pedidos y aprenden de cada interacción — 24/7, sin intervención humana.

**Live:** [https://eteba-chat.onrender.com](https://eteba-chat.onrender.com)

---

## Características Principales

- **Asistente IA personalizable** — Manual operativo, tono e idioma por negocio
- **Búsqueda inteligente multiidioma** — Entiende español, francés e inglés simultáneamente
- **Sistema de alias auto-aprendizaje** — "tenis" = "zapatillas" = "sneakers" = "baskets"
- **Memoria de conversación** — Recuerda contexto 15 min, respuestas cortas estilo WhatsApp
- **Pedidos sin fricción** — Usa datos de sesión del usuario, solo confirma ciudad
- **Chat Universal** — Los visitantes chatean con cualquier negocio desde la plataforma
- **Vinculación por email** — Un email = una identidad en todo el ecosistema
- **Widget embebible** — Una línea de código para instalar en cualquier web
- **Dashboard admin** — Métricas, catálogo CRUD, configuración, API keys
- **API REST** — Integra en cualquier sistema, app móvil o workflow
- **Multi-tenant** — Cada negocio aislado con datos propios
- **Google OAuth** — Login con un click

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express + TypeScript |
| IA / LLM | Groq (Llama 3.1 8B Instant) + OpenRouter (fallback) |
| Embeddings | Xenova/Transformers (all-MiniLM-L6-v2, 384d) |
| Base de datos | PostgreSQL (InsForge) + MySQL (proxy PHP) |
| Autenticación | Google OAuth 2.0 |
| Frontend | HTML + CSS + JS vanilla (SPA) |
| Hosting | Render.com |

---

## Estructura del Proyecto

```
Eteba Chat/
├── index.html              # Frontend SPA (Landing + Explore + Dashboard + Docs)
├── server.ts               # Express server + API + OAuth
├── router.ts               # Motor IA: clasificador + RAG + aliases + memoria
├── ingest.ts               # Pipeline de ingesta de conocimiento
├── styles/
│   ├── main.css            # Design system (purple/blue/cyan brand)
│   ├── landing.css         # Hero, features, pricing, explore + chat
│   ├── dashboard.css       # Panel admin, métricas, modales
│   └── docs.css            # Documentación
├── scripts/
│   ├── router.js           # Navegación SPA
│   ├── auth.js             # Google OAuth frontend
│   ├── explore.js          # Directorio + chat universal
│   ├── dashboard.js        # Panel admin + CRUD
│   └── app.js              # Entry point
├── widget/
│   ├── widget.js           # Widget v3 (auth + chat + product cards)
│   └── widget.css          # Estilos del widget
├── sql/                    # Migraciones numeradas
├── tests/                  # Tests de desarrollo
├── docs/                   # Guías y prompts
├── .env.example            # Plantilla de variables
├── package.json
├── tsconfig.json
└── Procfile
```

---

## Motor IA

### Clasificación Heurística (0ms, sin LLM)

| Intención | Trigger | Acción |
|-----------|---------|--------|
| `CATALOGO_SQL` | productos, precios, stock | Proxy → Groq filter |
| `TIENDAS` | tiendas, vendedores | Proxy `list_stores` |
| `ENVIO_CALCULO` | cuánto cuesta enviar | Proxy `calculate_shipping` |
| `ENVIOS_SEMANTIC` | agencias, tarifas | Proxy o RAG |
| `REGISTRO_PEDIDO` | comprar, encargar, confirmar | Pre-fill con sesión |
| `SALUDO_SOPORTE_GENERAL` | hola, preguntas | LLM + manual |

### Sistema de Aliases (200+ entradas trilingües)

El diccionario cubre español, francés e inglés:
- "tenis" / "baskets" / "sneakers" → busca zapatillas
- "cascos" / "écouteurs" / "headphones" → busca auriculares
- "perruque" / "wig" / "peluca" → busca pelucas
- Aprende relaciones nuevas con cada búsqueda exitosa

### Memoria de Conversación

- 8 últimos mensajes por sesión (tenant:userId)
- TTL: 15 minutos de inactividad
- Permite respuestas contextuales sin repetir preguntas

### Aprendizaje de Errores

- Detecta respuestas incorrectas automáticamente
- Registra lecciones (max 10 por tenant)
- Las inyecta como instrucciones negativas en prompts futuros

---

## Flujo de Pedidos (sin fricción)

```
1. Usuario: "Quiero encargar Zapatillas Lacoste"
2. Bot busca producto → encuentra precio y stock
3. Bot: "Las Zapatillas Lacoste cuestan 16.000 CFA. ¿Envío a tu ciudad habitual?"
4. Usuario: "Malabo"
5. Bot guarda pedido con datos de sesión (nombre, teléfono de __ETEBA_CHAT_USER__)
6. Bot: "¡Pedido #23 registrado! Te contactaremos por WhatsApp."
```

No pide nombre ni teléfono — los toma de la sesión del usuario logueado.

---

## Variables de Entorno

```env
# InsForge (DB)
INSFORGE_BASE_URL=https://xxx.us-east.insforge.app
INSFORGE_API_KEY=ik_xxx
DATABASE_URL=postgresql://...

# IA
GROQ_API_KEY=gsk_xxx
OPENROUTER_API_KEY=sk-or-v1-xxx   # fallback

# Proxy MySQL
ROTTERI_PROXY_URL=https://tu-sitio.com/api/chat-proxy.php
ROTTERI_PROXY_TOKEN=tu_token_secreto

# OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

---

## Deploy

Auto-deploy desde GitHub en cada push a `main`:
- **Build:** `npm install && npm run build`
- **Start:** `node dist/server.js`
- **URL:** https://eteba-chat.onrender.com

---

## Design System

Paleta basada en el logo oficial:
- Purple Light: `#9D4EDD`
- Purple Main: `#7209B7`
- Blue Main: `#4361EE`
- Cyan: `#00B4D8`
- Background: `#141B2D`

UI: Glassmorphism elegante con backdrop-filter y gradientes de marca.

---

## Licencia

ISC © [Eteba Chale Group](https://etebachalegroup.xo.je)
