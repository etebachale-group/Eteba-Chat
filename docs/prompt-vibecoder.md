# Prompt para Vibecoders — Integrar Eteba Chat

> Copia y pega este prompt completo en tu AI coding assistant (Claude, ChatGPT, Cursor, Copilot, Windsurf, etc.) para integrar Eteba Chat en cualquier plataforma.

---

## El Prompt

```
Necesito integrar Eteba Chat en mi sitio web. Eteba Chat es un asistente de ventas con IA que funciona como widget flotante. Responde en estilo WhatsApp (1-3 frases cortas), soporta español, francés e inglés, y aprende automáticamente los alias de productos. La moneda es CFA (Franco CFA).

=== PASO 1: INSERTAR WIDGET ===

Añade este código antes de </body> en mi HTML principal:

<script>
  window.__ETEBA_CHAT_CONFIG__ = {
    tenantId: "MI_TENANT_ID"
  };
</script>
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=MI_TENANT_ID" defer></script>

Reemplaza MI_TENANT_ID por mi ID real del panel de https://eteba-chat.onrender.com

=== PASO 2: INYECTAR DATOS DE USUARIO ===

ANTES del script del widget, inyecta esta variable global con los datos del usuario actual de mi sistema:

<script>
  window.__ETEBA_CHAT_USER__ = {
    id: "USER_ID_DE_MI_SISTEMA",
    name: "Nombre del usuario",
    email: "email@ejemplo.com",
    phone: "+237600000000",
    logged: true,           // true si está autenticado, false si es visitante
    loginUrl: "/login"      // URL de mi página de login
  };
</script>

Comportamiento:
- Si logged: true → el chat se abre con saludo personalizado ("¡Hola [name]!")
- Si logged: false → muestra panel de login con botón de Google antes de chatear

Adapta esto a mi framework:
- PHP: usa $_SESSION para popular los campos
- React/Next: usa tu hook de auth (useAuth, useSession, etc.)
- WordPress: usa wp_get_current_user()
- Django: usa request.user
- Laravel: usa Auth::user()

=== PASO 3: PROXY PHP (OPCIONAL — solo si necesito conectar mi MySQL) ===

Crea este archivo si necesito que el asistente consulte datos en tiempo real de mi base de datos:

Archivo: eteba-proxy.php

<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://eteba-chat.onrender.com');
header('Access-Control-Allow-Headers: Content-Type, X-Chat-Token');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Validar token (configurado en panel de Eteba Chat)
$token = $_SERVER['HTTP_X_CHAT_TOKEN'] ?? '';
if ($token !== 'MI_TOKEN_SECRETO') {
    http_response_code(401);
    echo json_encode(['error' => 'No autorizado']);
    exit;
}

$pdo = new PDO(
    'mysql:host=localhost;dbname=MI_BASE_DE_DATOS;charset=utf8mb4',
    'MI_USUARIO',
    'MI_PASSWORD',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

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

    case 'get_user_orders':
        $userId = $body['user_id'] ?? '';
        $stmt = $pdo->prepare("SELECT id, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5");
        $stmt->execute([$userId]);
        echo json_encode(['orders' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        break;

    case 'get_categories':
        $stmt = $pdo->query("SELECT id, name FROM categories WHERE active = 1");
        echo json_encode(['categories' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        break;

    case 'get_product_detail':
        $productId = $body['product_id'] ?? '';
        $stmt = $pdo->prepare("SELECT * FROM products WHERE id = ?");
        $stmt->execute([$productId]);
        echo json_encode(['product' => $stmt->fetch(PDO::FETCH_ASSOC)]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Acción no reconocida']);
}

=== ACCIONES DISPONIBLES EN EL PROXY ===

| Acción              | Parámetros           | Devuelve                          | Uso                              |
|---------------------|----------------------|-----------------------------------|----------------------------------|
| search_products     | query (string)       | {products: [...]}                 | Buscar productos por nombre      |
| get_order_status    | order_id (string)    | {order: {status, tracking}}       | Estado de un pedido              |
| check_stock         | product_id (string)  | {stock: number}                   | Verificar disponibilidad         |
| get_user_orders     | user_id (string)     | {orders: [...]}                   | Últimos pedidos del usuario      |
| get_categories      | (ninguno)            | {categories: [...]}               | Listar categorías activas        |
| get_product_detail  | product_id (string)  | {product: {...}}                  | Detalle completo de un producto  |

=== API DIRECTA (sin proxy) ===

POST https://eteba-chat.onrender.com/api/query
Content-Type: application/json

{
  "tenantId": "mi_tenant_id",
  "prompt": "¿Tienen zapatillas talla 42?",
  "userId": "usr_123",
  "lang": "es"
}

Respuesta:
{
  "reply": "Sí, tenemos 3 modelos en talla 42. ¿Te muestro?",
  "sources": ["products"],
  "confidence": 0.92
}

POST https://eteba-chat.onrender.com/api/ingest
Content-Type: application/json
Authorization: Bearer MI_API_KEY

{
  "tenantId": "mi_tenant_id",
  "documents": [
    {"title": "Producto X", "content": "Descripción, precio 15.000 CFA, stock 50"}
  ]
}

=== FLUJOS DE CONVERSACIÓN EJEMPLO ===

Flujo 1 — Consulta de producto:
  Usuario: "¿Tienen camisetas negras?"
  Bot: "Sí, tenemos 4 modelos de camisetas negras desde 8.000 CFA. ¿Quieres ver opciones?"
  Usuario: "Sí"
  Bot: "1) Camiseta Básica - 8.000 CFA  2) Premium Cotton - 12.000 CFA  3) Sport Dry - 15.000 CFA  4) Oversize - 10.000 CFA"

Flujo 2 — Estado de pedido:
  Usuario: "¿Dónde está mi pedido #4521?"
  Bot: "Tu pedido #4521 está en camino. Tracking: CM2024XYZ. Entrega estimada: mañana."

Flujo 3 — Usuario no logueado:
  [Se muestra panel de login]
  Usuario: [clic en "Iniciar con Google"]
  [Redirige a loginUrl, usuario se autentica]
  [Widget se recarga con logged: true]
  Bot: "¡Hola Marie! ¿En qué puedo ayudarte?"

Flujo 4 — Producto con alias:
  Usuario: "quiero tenis rojos"
  Bot: "Tenemos Sneakers Rojo Premium por 45.000 CFA. Tallas 38-45. ¿Te interesa?"
  (El sistema reconoció "tenis" como alias de "sneakers")

=== PERSONALIZACIÓN CSS ===

Añade esto en tu CSS para cambiar la apariencia del widget:

:root {
  --eteba-primary: #2563eb;        /* Color principal (burbuja + header) */
  --eteba-header-text: #ffffff;    /* Texto del header */
  --eteba-bg: #f9fafb;            /* Fondo del chat */
  --eteba-bot-bubble: #e5e7eb;    /* Burbuja del bot */
  --eteba-bot-text: #1f2937;      /* Texto del bot */
  --eteba-user-bubble: #2563eb;   /* Burbuja del usuario */
  --eteba-user-text: #ffffff;     /* Texto del usuario */
  --eteba-radius: 12px;           /* Border radius */
  --eteba-fab-size: 60px;         /* Tamaño burbuja flotante */
  --eteba-bottom: 20px;           /* Distancia abajo */
  --eteba-right: 20px;            /* Distancia derecha */
  --eteba-font: 'Inter', sans-serif;
}

Tema oscuro:
:root {
  --eteba-primary: #7c3aed;
  --eteba-bg: #1f2937;
  --eteba-bot-bubble: #374151;
  --eteba-bot-text: #f3f4f6;
}

=== NOTAS IMPORTANTES ===

- El widget se autentica con el header X-Chat-Token al hablar con tu proxy
- Las respuestas son siempre cortas (estilo WhatsApp, 1-3 frases)
- Soporta español, francés e inglés (detección automática)
- Moneda por defecto: CFA (Franco CFA)
- El asistente aprende aliases de productos automáticamente
- Máximo 60 requests/min por tenant
- Tu sitio DEBE usar HTTPS
- Inyecta window.__ETEBA_CHAT_USER__ ANTES del script del widget

Ahora implementa esto en mi proyecto adaptándolo a mi framework y estructura de archivos.
```

---

## Cómo usar este prompt

1. **Copia** todo el bloque de código de arriba (desde ` ``` ` hasta ` ``` `)
2. **Pega** en tu AI coding assistant favorito (Claude, ChatGPT, Cursor, Windsurf, etc.)
3. **Añade contexto** sobre tu proyecto: framework, estructura de archivos, sistema de auth
4. La IA generará el código de integración adaptado a tu stack

### Ejemplo de uso en Cursor/Claude:

```
[Pega el prompt de arriba]

Mi proyecto usa:
- Next.js 14 con App Router
- NextAuth para autenticación
- Tailwind CSS
- PostgreSQL con Prisma

Archivos relevantes:
- app/layout.tsx (layout principal)
- lib/auth.ts (configuración de auth)
- app/api/auth/[...nextauth]/route.ts

Implementa la integración completa.
```

---

## Variantes rápidas

### Solo widget (sin proxy, sin auth)
Si solo quieres el chat básico sin personalización:

```
Añade Eteba Chat a mi sitio. Solo necesito el widget básico sin autenticación de usuarios.

<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=MI_TENANT_ID" defer></script>

Ponlo antes de </body>. MI_TENANT_ID es: [tu ID aquí]
```

### Widget + Auth (sin proxy)
Si quieres personalización pero sin conectar base de datos:

```
Integra Eteba Chat con autenticación. Mi sistema de login es [describe tu auth].
Necesito que inyectes window.__ETEBA_CHAT_USER__ con los datos del usuario actual.
Si no está logueado, pon logged: false y loginUrl apuntando a mi página de login.

Widget: https://eteba-chat.onrender.com/widget/widget.js?tenant_id=MI_TENANT_ID
```

---

*Última actualización: Junio 2025*
