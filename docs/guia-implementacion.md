# Guía de Implementación — Eteba Chat

> Integra un asistente de ventas con IA en tu sitio web en menos de 30 minutos.

---

## Tabla de contenidos

1. [Requisitos previos](#requisitos-previos)
2. [Paso 1: Registro](#paso-1-registro)
3. [Paso 2: Configurar asistente](#paso-2-configurar-asistente)
4. [Paso 3: Instalar widget](#paso-3-instalar-widget)
5. [Paso 4: Autenticación de usuarios](#paso-4-autenticación-de-usuarios)
6. [Paso 5: Proxy PHP (opcional)](#paso-5-proxy-php-opcional)
7. [Paso 6: Probar](#paso-6-probar)
8. [API Reference](#api-reference)
9. [Personalización CSS](#personalización-css)
10. [Troubleshooting](#troubleshooting)

---

## Requisitos previos

| Elemento | Descripción |
|----------|-------------|
| Sitio web | Cualquier sitio con acceso al HTML (WordPress, PHP, React, etc.) |
| Cuenta Google | Para registrarte en Eteba Chat |
| HTTPS | Tu sitio debe servirse por HTTPS (obligatorio para el widget) |
| Navegador moderno | Chrome 80+, Firefox 78+, Safari 14+, Edge 80+ |

Opcional:
- **PHP 7.4+** y **MySQL/MariaDB** si quieres usar el proxy para conectar tu base de datos propia.
- **Catálogo de productos** en cualquier formato (CSV, JSON, base de datos) para alimentar al asistente.

---

## Paso 1: Registro

1. Ve a [https://eteba-chat.onrender.com](https://eteba-chat.onrender.com)
2. Haz clic en **"Iniciar con Google"**
3. Selecciona tu cuenta de Google empresarial
4. Se creará automáticamente tu **tenant** (espacio de trabajo)
5. Copia tu `tenant_id` desde el panel de configuración — lo necesitarás para el widget

> 💡 Cada tenant es independiente. Si gestionas varias tiendas, crea un tenant por cada una.

---

## Paso 2: Configurar asistente

Desde el panel de administración, configura:

### Manual operativo
Sube o escribe las instrucciones que definen cómo responde tu asistente:
- Qué productos/servicios vendes
- Políticas de envío, devoluciones, garantías
- Precios y moneda (por defecto: **CFA — Franco CFA**)
- Horarios de atención
- Información de contacto

### Tono de comunicación
El asistente responde en estilo **WhatsApp**: mensajes cortos de 1-3 frases, directos y amigables.

### Idiomas soportados
- 🇪🇸 Español
- 🇫🇷 Francés
- 🇬🇧 Inglés

El asistente detecta automáticamente el idioma del usuario y responde en el mismo.

### Aprendizaje de aliases
El sistema aprende automáticamente los alias de productos. Si un usuario escribe "zapatillas rojas" y tu producto se llama "Sneakers Rojo Premium", el asistente hace la conexión solo.

---

## Paso 3: Instalar widget

Pega este código **antes de `</body>`** en tu HTML:

```html
<!-- Eteba Chat Widget -->
<script>
  window.__ETEBA_CHAT_CONFIG__ = {
    tenantId: "TU_TENANT_ID"
  };
</script>
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=TU_TENANT_ID" defer></script>
```

Reemplaza `TU_TENANT_ID` por el ID que copiaste en el Paso 1.

### WordPress
Añade el snippet en **Apariencia → Editor de temas → footer.php** justo antes de `</body>`.

### React / Next.js
Añádelo en tu componente `Layout` o en `_document.js`:

```jsx
// pages/_document.js (Next.js)
<script
  dangerouslySetInnerHTML={{
    __html: `window.__ETEBA_CHAT_CONFIG__ = { tenantId: "TU_TENANT_ID" };`
  }}
/>
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=TU_TENANT_ID" defer />
```

---

## Paso 4: Autenticación de usuarios

El widget lee la variable global `window.__ETEBA_CHAT_USER__` para saber si el visitante está logueado.

### Si el usuario está logueado

```html
<script>
  window.__ETEBA_CHAT_USER__ = {
    id: "usr_12345",
    name: "Marie Dupont",
    email: "marie@example.com",
    phone: "+237600000000",
    logged: true,
    loginUrl: "/login"
  };
</script>
```

**Resultado:** El chat se abre directamente con un saludo personalizado:
> "¡Hola Marie! ¿En qué puedo ayudarte hoy?"

### Si el usuario NO está logueado

```html
<script>
  window.__ETEBA_CHAT_USER__ = {
    logged: false,
    loginUrl: "/login"
  };
</script>
```

**Resultado:** Se muestra un panel de login con botón de Google. El usuario debe autenticarse antes de chatear.

### Propiedades del objeto

| Propiedad | Tipo | Obligatorio | Descripción |
|-----------|------|-------------|-------------|
| `id` | string | Si (cuando logged) | ID único del usuario en tu sistema |
| `name` | string | Si (cuando logged) | Nombre para personalizar respuestas |
| `email` | string | Si (cuando logged) | Email del usuario |
| `phone` | string | No | Teléfono (para soporte) |
| `logged` | boolean | **Sí** | `true` si está autenticado, `false` si no |
| `loginUrl` | string | **Sí** | URL a donde redirigir para login |

> ⚠️ Inyecta `window.__ETEBA_CHAT_USER__` **antes** del script del widget para que lo lea al inicializarse.

---

## Paso 5: Proxy PHP (opcional)

Si necesitas que el asistente consulte datos en tiempo real de tu base de datos MySQL (stock, precios, pedidos), crea un proxy PHP.

### Archivo: `eteba-proxy.php`

```php
<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://eteba-chat.onrender.com');
header('Access-Control-Allow-Headers: Content-Type, X-Chat-Token');
header('Access-Control-Allow-Methods: POST, OPTIONS');

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Validar token
$token = $_SERVER['HTTP_X_CHAT_TOKEN'] ?? '';
if ($token !== 'TU_TOKEN_SECRETO') {
    http_response_code(401);
    echo json_encode(['error' => 'No autorizado']);
    exit;
}

// Conexión MySQL
$pdo = new PDO(
    'mysql:host=localhost;dbname=tu_tienda;charset=utf8mb4',
    'usuario',
    'contraseña',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

// Leer acción
$body = json_decode(file_get_contents('php://input'), true);
$action = $body['action'] ?? '';

switch ($action) {
    case 'search_products':
        $query = $body['query'] ?? '';
        $stmt = $pdo->prepare("SELECT id, name, price, stock FROM products WHERE name LIKE ? LIMIT 10");
        $stmt->execute(["%$query%"]);
        echo json_encode(['products' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        break;

    case 'get_order_status':
        $orderId = $body['order_id'] ?? '';
        $stmt = $pdo->prepare("SELECT status, tracking FROM orders WHERE id = ?");
        $stmt->execute([$orderId]);
        echo json_encode(['order' => $stmt->fetch(PDO::FETCH_ASSOC)]);
        break;

    case 'check_stock':
        $productId = $body['product_id'] ?? '';
        $stmt = $pdo->prepare("SELECT stock FROM products WHERE id = ?");
        $stmt->execute([$productId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        echo json_encode(['stock' => $row['stock'] ?? 0]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Acción no reconocida']);
}
```

### Configurar en el panel
En tu panel de Eteba Chat, ve a **Configuración → Proxy** y añade:
- **URL:** `https://tudominio.com/eteba-proxy.php`
- **Token:** El mismo valor que pusiste en `TU_TOKEN_SECRETO`

El asistente enviará requests al proxy con el header `X-Chat-Token` para autenticarse.

---

## Paso 6: Probar

### Checklist de verificación

- [ ] El widget aparece como burbuja flotante en la esquina inferior derecha
- [ ] Si `logged: false` → muestra panel de login con botón Google
- [ ] Si `logged: true` → abre chat con saludo personalizado
- [ ] Enviar un mensaje y recibir respuesta en < 3 segundos
- [ ] Las respuestas son cortas (1-3 frases, estilo WhatsApp)
- [ ] El asistente responde en el idioma del usuario
- [ ] (Si proxy) Los datos de productos/stock son correctos

### Probar desde consola del navegador

```javascript
// Verificar que el usuario está inyectado
console.log(window.__ETEBA_CHAT_USER__);

// Verificar que el widget está cargado
console.log(document.querySelector('#eteba-chat-widget'));

// Simular usuario logueado para testing
window.__ETEBA_CHAT_USER__ = {
  id: "test_001",
  name: "Test User",
  email: "test@test.com",
  logged: true,
  loginUrl: "/login"
};
```

---

## API Reference

### POST /api/query

Envía una pregunta al asistente y recibe una respuesta.

**URL:** `https://eteba-chat.onrender.com/api/query`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "tenantId": "tu_tenant_id",
  "prompt": "¿Tienen zapatillas talla 42?",
  "userId": "usr_12345",
  "lang": "es"
}
```

**Respuesta exitosa (200):**
```json
{
  "reply": "Sí, tenemos 3 modelos en talla 42. ¿Te muestro opciones?",
  "sources": ["products"],
  "confidence": 0.92
}
```

**Parámetros:**

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `tenantId` | string | **Sí** | Tu identificador de tenant |
| `prompt` | string | **Sí** | Pregunta del usuario |
| `userId` | string | No | ID del usuario (para contexto) |
| `lang` | string | No | Idioma preferido (`es`, `fr`, `en`) |

---

### POST /api/ingest

Sube documentos o datos para que el asistente los aprenda.

**URL:** `https://eteba-chat.onrender.com/api/ingest`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer TU_API_KEY
```

**Body:**
```json
{
  "tenantId": "tu_tenant_id",
  "documents": [
    {
      "title": "Política de envíos",
      "content": "Envío gratis a partir de 25.000 CFA. Entrega en 24-48h en Douala y Yaoundé."
    },
    {
      "title": "Zapatillas Running Pro",
      "content": "Precio: 45.000 CFA. Tallas: 38-45. Colores: negro, blanco, rojo. Stock: 23 unidades."
    }
  ]
}
```

**Respuesta exitosa (200):**
```json
{
  "ingested": 2,
  "status": "ok"
}
```

---

## Personalización CSS

El widget expone variables CSS que puedes sobrescribir:

```css
/* Añadir en tu CSS o en un <style> */
:root {
  /* Color principal del widget (burbuja y header) */
  --eteba-primary: #2563eb;

  /* Color del texto en el header */
  --eteba-header-text: #ffffff;

  /* Color de fondo del chat */
  --eteba-bg: #f9fafb;

  /* Color de los mensajes del bot */
  --eteba-bot-bubble: #e5e7eb;
  --eteba-bot-text: #1f2937;

  /* Color de los mensajes del usuario */
  --eteba-user-bubble: #2563eb;
  --eteba-user-text: #ffffff;

  /* Bordes redondeados */
  --eteba-radius: 12px;

  /* Tamaño de la burbuja flotante */
  --eteba-fab-size: 60px;

  /* Posición */
  --eteba-bottom: 20px;
  --eteba-right: 20px;

  /* Fuente */
  --eteba-font: 'Inter', sans-serif;
}
```

### Ejemplo: tema oscuro

```css
:root {
  --eteba-primary: #7c3aed;
  --eteba-bg: #1f2937;
  --eteba-bot-bubble: #374151;
  --eteba-bot-text: #f3f4f6;
  --eteba-user-bubble: #7c3aed;
  --eteba-user-text: #ffffff;
}
```

### Ejemplo: colores de marca personalizados

```css
:root {
  --eteba-primary: #e11d48;    /* Rosa corporativo */
  --eteba-user-bubble: #e11d48;
  --eteba-radius: 20px;        /* Más redondeado */
  --eteba-fab-size: 70px;      /* Burbuja más grande */
}
```

---

## Troubleshooting

### El widget no aparece

| Causa | Solución |
|-------|----------|
| `tenant_id` incorrecto | Verifica en tu panel de Eteba Chat |
| Script bloqueado por CSP | Añade `https://eteba-chat.onrender.com` a tu Content-Security-Policy |
| Script cargado antes del DOM | Usa `defer` en la etiqueta `<script>` |
| HTTPS no configurado | El widget requiere HTTPS. Usa Let's Encrypt |

### No recibe respuestas

| Causa | Solución |
|-------|----------|
| Sin documentos ingestados | Sube contenido en el panel o vía `/api/ingest` |
| Tenant sin configurar | Completa el manual operativo en el panel |
| Rate limit | Máximo 60 requests/minuto por tenant |

### El login no funciona

| Causa | Solución |
|-------|----------|
| `loginUrl` vacío | Define siempre `loginUrl` en `__ETEBA_CHAT_USER__` |
| `logged` no definido | Siempre incluye `logged: true` o `logged: false` |
| Popup bloqueado | Informa al usuario que permita popups |

### El proxy no conecta

| Causa | Solución |
|-------|----------|
| CORS bloqueado | Verifica los headers `Access-Control-Allow-*` |
| Token incorrecto | El header `X-Chat-Token` debe coincidir con tu config |
| PHP sin `json_decode` | Asegúrate de tener la extensión `json` habilitada |
| MySQL desconectado | Verifica credenciales y que el servicio esté corriendo |

### Respuestas lentas (> 5s)

1. Verifica tu conexión a internet
2. Reduce el tamaño de los documentos ingestados
3. Comprueba el status en [status.eteba-chat.onrender.com](https://eteba-chat.onrender.com)
4. Si usas proxy, optimiza las queries MySQL (añade índices)

---

## Soporte

- **Email:** soporte@eteba.chat
- **Panel:** [eteba-chat.onrender.com](https://eteba-chat.onrender.com)
- **Documentación:** Este archivo + README del proyecto

---

*Última actualización: Junio 2025*
