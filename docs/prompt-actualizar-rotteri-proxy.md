# Prompt: Actualizar Proxy PHP e Inyectar Usuario — Workspace Rotteri

## Contexto

Eteba Chat (backend en Render) se comunica con la base de datos MySQL de Rotteri a través de un proxy PHP en `/public/api/chat-proxy.php`. El widget del chat se carga en todas las páginas de rotteri.com.

Necesito hacer 2 cosas:
1. **Actualizar el proxy PHP** para que soporte búsqueda mejorada + nuevos endpoints
2. **Inyectar datos del usuario** en un script global para que el widget sepa si está logueado

---

## 1. Actualizar `chat-proxy.php`

**Archivo:** `C:\xampp\htdocs\rotteri\public\api\chat-proxy.php`

### Cambios requeridos en `search_products`:

El endpoint `search_products` actualmente devuelve vacío si `$term` está vacío. Necesito que:
- Si `$term` está vacío → listar todos los productos disponibles (limit 30)
- Si `$term` tiene texto → buscar con LIKE como antes
- Si LIKE no encuentra nada → devolver catálogo completo como fallback
- Agregar campo `note` en la respuesta indicando el tipo de resultado
- Agregar campo `id`, `tags` y `origin` a cada producto

### Código actualizado de `search_products`:

```php
if ($action === 'search_products') {
    $term = $body['term'] ?? '';
    $limit = min((int)($body['limit'] ?? 30), 50);
    
    $results = [];
    $note = 'full_catalog';
    
    if (!empty($term) && $term !== '%') {
        // Intentar búsqueda LIKE
        $escapedTerm = $conn->real_escape_string($term);
        $sql = "SELECT id, nombre, precio, cantidad, descripcion, imagen_url, tags, pais_origen, ciudad_origen, tienda_id 
                FROM productos 
                WHERE (nombre LIKE '%{$escapedTerm}%' OR descripcion LIKE '%{$escapedTerm}%' OR tags LIKE '%{$escapedTerm}%') 
                AND cantidad > 0 
                ORDER BY nombre ASC 
                LIMIT {$limit}";
        $result = $conn->query($sql);
        
        if ($result && $result->num_rows > 0) {
            $note = 'like_match';
            while ($row = $result->fetch_assoc()) {
                $results[] = formatProduct($row);
            }
        } else {
            // LIKE no encontró nada → devolver catálogo completo para que la IA filtre
            $note = 'fallback_catalog';
            $result = $conn->query("SELECT id, nombre, precio, cantidad, descripcion, imagen_url, tags, pais_origen, ciudad_origen, tienda_id FROM productos WHERE cantidad > 0 ORDER BY RAND() LIMIT {$limit}");
            if ($result) {
                while ($row = $result->fetch_assoc()) {
                    $results[] = formatProduct($row);
                }
            }
        }
    } else {
        // Sin término → listar todo
        $note = 'full_catalog';
        $result = $conn->query("SELECT id, nombre, precio, cantidad, descripcion, imagen_url, tags, pais_origen, ciudad_origen, tienda_id FROM productos WHERE cantidad > 0 ORDER BY nombre ASC LIMIT {$limit}");
        if ($result) {
            while ($row = $result->fetch_assoc()) {
                $results[] = formatProduct($row);
            }
        }
    }
    
    echo json_encode([
        'results' => $results,
        'query' => $term,
        'count' => count($results),
        'note' => $note
    ]);
    $conn->close();
    exit;
}

// Función helper para formatear producto
function formatProduct($row) {
    $origin = '';
    if (!empty($row['ciudad_origen']) && !empty($row['pais_origen'])) {
        $origin = $row['ciudad_origen'] . ', ' . $row['pais_origen'];
    } elseif (!empty($row['pais_origen'])) {
        $origin = $row['pais_origen'];
    }
    
    return [
        'id'          => (int)$row['id'],
        'name'        => $row['nombre'],
        'price'       => $row['precio'],
        'stock'       => (int)$row['cantidad'],
        'description' => $row['descripcion'] ?? '',
        'image_url'   => $row['imagen_url'] ?? null,
        'tags'        => $row['tags'] ?? '',
        'origin'      => $origin,
        'tienda_id'   => isset($row['tienda_id']) ? (int)$row['tienda_id'] : null,
    ];
}
```

### Nuevos endpoints a agregar:

```php
// ─── Acción: detalle de producto ─────────────────────────────────────────────
} elseif ($action === 'get_product_detail') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) {
        echo json_encode(['product' => null]);
        exit;
    }
    
    $result = $conn->query("
        SELECT p.*, t.nombre as tienda_nombre, t.slug as tienda_slug, t.telefono as tienda_telefono
        FROM productos p
        LEFT JOIN tiendas t ON p.tienda_id = t.id
        WHERE p.id = {$id}
    ");
    
    $row = $result ? $result->fetch_assoc() : null;
    if (!$row) {
        echo json_encode(['product' => null]);
        exit;
    }
    
    echo json_encode(['product' => [
        'id' => (int)$row['id'],
        'name' => $row['nombre'],
        'description' => $row['descripcion'],
        'price' => $row['precio'],
        'stock' => (int)$row['cantidad'],
        'image_url' => $row['imagen_url'],
        'country' => $row['pais_origen'] ?? '',
        'city' => $row['ciudad_origen'] ?? '',
        'tags' => $row['tags'] ?? '',
        'store' => [
            'id' => (int)$row['tienda_id'],
            'name' => $row['tienda_nombre'] ?? '',
            'slug' => $row['tienda_slug'] ?? '',
            'phone' => $row['tienda_telefono'] ?? '',
        ],
        'url' => "https://rotteri.com/productos/detalle.php?id={$row['id']}"
    ]]);

// ─── Acción: listar tiendas ──────────────────────────────────────────────────
} elseif ($action === 'list_stores') {
    $result = $conn->query("
        SELECT t.*, COUNT(p.id) as total_products 
        FROM tiendas t 
        LEFT JOIN productos p ON p.tienda_id = t.id AND p.cantidad > 0
        WHERE t.activa = 1
        GROUP BY t.id
        ORDER BY total_products DESC
        LIMIT 20
    ");
    
    $stores = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $stores[] = [
                'id' => (int)$row['id'],
                'name' => $row['nombre'],
                'slug' => $row['slug'] ?? '',
                'country' => $row['pais'] ?? '',
                'city' => $row['ciudad'] ?? '',
                'phone' => $row['telefono'] ?? '',
                'photo' => $row['foto'] ?? null,
                'total_products' => (int)$row['total_products'],
                'url' => "https://rotteri.com/tiendas/" . ($row['slug'] ?? $row['id'])
            ];
        }
    }
    echo json_encode(['stores' => $stores]);

// ─── Acción: productos de una tienda ─────────────────────────────────────────
} elseif ($action === 'store_products') {
    $tiendaId = (int)($body['tienda_id'] ?? 0);
    $limit = min((int)($body['limit'] ?? 10), 30);
    
    if (!$tiendaId) {
        echo json_encode(['results' => []]);
        exit;
    }
    
    $result = $conn->query("SELECT id, nombre, precio, cantidad, descripcion, imagen_url, tags, pais_origen, ciudad_origen, tienda_id FROM productos WHERE tienda_id = {$tiendaId} AND cantidad > 0 ORDER BY nombre ASC LIMIT {$limit}");
    $results = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $results[] = formatProduct($row);
        }
    }
    echo json_encode(['results' => $results, 'count' => count($results)]);

// ─── Acción: listar categorías ───────────────────────────────────────────────
} elseif ($action === 'list_categories') {
    $result = $conn->query("SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria != '' AND cantidad > 0 ORDER BY categoria");
    $categories = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $categories[] = $row['categoria'];
        }
    }
    echo json_encode(['categories' => $categories]);

// ─── Acción: productos por categoría ─────────────────────────────────────────
} elseif ($action === 'products_by_category') {
    $category = $conn->real_escape_string($body['category'] ?? '');
    $limit = min((int)($body['limit'] ?? 10), 30);
    
    if (empty($category)) {
        echo json_encode(['results' => []]);
        exit;
    }
    
    $result = $conn->query("SELECT id, nombre, precio, cantidad, descripcion, imagen_url, tags, pais_origen, ciudad_origen, tienda_id FROM productos WHERE categoria LIKE '%{$category}%' AND cantidad > 0 ORDER BY nombre ASC LIMIT {$limit}");
    $results = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $results[] = formatProduct($row);
        }
    }
    echo json_encode(['results' => $results, 'count' => count($results)]);

// ─── Acción: listar agencias de envío ────────────────────────────────────────
} elseif ($action === 'list_agencies') {
    $result = $conn->query("SELECT * FROM agencias_envio WHERE activa = 1 ORDER BY nombre");
    $agencies = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $agencies[] = [
                'id' => (int)$row['id'],
                'name' => $row['nombre'],
                'phone' => $row['telefono'] ?? '',
                'coverage' => $row['cobertura'] ?? '',
            ];
        }
    }
    echo json_encode(['agencies' => $agencies]);

// ─── Acción: tarifas de envío ────────────────────────────────────────────────
} elseif ($action === 'shipping_rates') {
    $origin = $conn->real_escape_string($body['origin'] ?? '');
    $destination = $conn->real_escape_string($body['destination'] ?? '');
    
    $where = "1=1";
    if (!empty($origin)) $where .= " AND (origen LIKE '%{$origin}%')";
    if (!empty($destination)) $where .= " AND (destino LIKE '%{$destination}%')";
    
    $result = $conn->query("SELECT t.*, a.nombre as agencia_nombre, a.telefono as agencia_telefono FROM tarifas_envio t LEFT JOIN agencias_envio a ON t.agencia_id = a.id WHERE {$where} LIMIT 10");
    $rates = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $rates[] = [
                'agency_name' => $row['agencia_nombre'] ?? '',
                'agency_phone' => $row['agencia_telefono'] ?? '',
                'cost_raw' => (float)$row['precio'],
                'cost' => number_format($row['precio'], 0, ',', '.') . ' CFA',
                'origin' => $row['origen'] ?? '',
                'destination' => $row['destino'] ?? '',
                'delivery_time' => $row['tiempo_entrega'] ?? '',
                'service_type' => $row['tipo_servicio'] ?? 'estandar',
            ];
        }
    }
    echo json_encode(['options' => $rates]);

// ─── Acción: calcular envío ──────────────────────────────────────────────────
} elseif ($action === 'calculate_shipping') {
    $origin = $conn->real_escape_string($body['origin'] ?? '');
    $destination = $conn->real_escape_string($body['destination'] ?? '');
    $weight = (float)($body['weight'] ?? 1.0);
    
    $result = $conn->query("SELECT t.*, a.nombre as agencia_nombre, a.telefono as agencia_telefono FROM tarifas_envio t LEFT JOIN agencias_envio a ON t.agencia_id = a.id WHERE origen LIKE '%{$origin}%' AND destino LIKE '%{$destination}%' ORDER BY t.precio ASC LIMIT 5");
    $options = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $cost = (float)$row['precio'] * $weight;
            $options[] = [
                'agency_name' => $row['agencia_nombre'] ?? '',
                'agency_phone' => $row['agencia_telefono'] ?? '',
                'cost_raw' => $cost,
                'cost' => number_format($cost, 0, ',', '.') . ' CFA',
                'delivery_time' => $row['tiempo_entrega'] ?? '3-7 días',
                'service_type' => $row['tipo_servicio'] ?? 'estandar',
                'origin' => $row['origen'],
                'destination' => $row['destino'],
            ];
        }
    }
    echo json_encode(['options' => $options, 'query' => ['origin' => $origin, 'destination' => $destination, 'weight_kg' => $weight]]);

// ─── Acción: verificar sesión de usuario ─────────────────────────────────────
} elseif ($action === 'check_user_session') {
    $userId = (int)($body['user_id'] ?? 0);
    if (!$userId) {
        echo json_encode(['authenticated' => false]);
        exit;
    }
    
    $result = $conn->query("SELECT id, nombre, email, telefono, ciudad, pais, rol FROM usuarios WHERE id = {$userId}");
    $user = $result ? $result->fetch_assoc() : null;
    
    if ($user) {
        echo json_encode(['authenticated' => true, 'user' => [
            'id' => (int)$user['id'],
            'name' => $user['nombre'],
            'email' => $user['email'],
            'phone' => $user['telefono'] ?? '',
            'city' => $user['ciudad'] ?? '',
            'country' => $user['pais'] ?? '',
            'role' => $user['rol'] ?? 'cliente',
        ]]);
    } else {
        echo json_encode(['authenticated' => false]);
    }
```

---

## 2. Inyectar `window.__ETEBA_CHAT_USER__` en los Layouts

### Buscar en:
- `resources/views/layouts/app.blade.php` (desktop)
- `resources/views/layouts/mobile.blade.php` (mobile)
- O el layout principal que incluye el `</body>`

### Agregar ANTES del script tag del widget:

```php
<!-- Eteba Chat: Datos del usuario para el widget -->
<script>
window.__ETEBA_CHAT_USER__ = @json([
    'id' => auth()->check() ? auth()->id() : null,
    'name' => auth()->check() ? auth()->user()->name : null,
    'email' => auth()->check() ? auth()->user()->email : null,
    'phone' => auth()->check() ? (auth()->user()->phone ?? auth()->user()->telefono ?? null) : null,
    'logged' => auth()->check(),
    'loginUrl' => !auth()->check() ? 'https://accounts.google.com/o/oauth2/v2/auth?client_id=614093083430-ahqjs963e68ce1qqe9imd4vis1h119vp.apps.googleusercontent.com&redirect_uri=' . urlencode(url('/api/auth_google.php')) . '&response_type=code&scope=openid+email+profile&prompt=select_account' : null,
]);
</script>
<!-- Widget Eteba Chat -->
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=e22e9ee0-d29a-4172-88de-fb9ad14c9c1b"></script>
```

### Si NO usas Blade (PHP puro):

```php
<?php
$isLogged = isset($_SESSION['user_id']) && $_SESSION['user_id'] > 0;
$userData = $isLogged ? [
    'id' => $_SESSION['user_id'],
    'name' => $_SESSION['user_name'] ?? '',
    'email' => $_SESSION['user_email'] ?? '',
    'phone' => $_SESSION['user_phone'] ?? '',
    'logged' => true,
] : [
    'logged' => false,
    'loginUrl' => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=614093083430-ahqjs963e68ce1qqe9imd4vis1h119vp.apps.googleusercontent.com&redirect_uri=' . urlencode('https://rotteri.com/api/auth_google.php') . '&response_type=code&scope=openid+email+profile&prompt=select_account',
];
?>
<script>
window.__ETEBA_CHAT_USER__ = <?php echo json_encode($userData); ?>;
</script>
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=e22e9ee0-d29a-4172-88de-fb9ad14c9c1b"></script>
```

---

## 3. Columnas necesarias en la tabla `productos`

Verificar que la tabla `productos` tenga estas columnas (si no existen, agregarlas):

```sql
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tags VARCHAR(500) DEFAULT NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS pais_origen VARCHAR(100) DEFAULT NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ciudad_origen VARCHAR(100) DEFAULT NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria VARCHAR(100) DEFAULT NULL;
```

---

## 4. Tablas de envío (si no existen)

```sql
CREATE TABLE IF NOT EXISTS agencias_envio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    cobertura TEXT,
    activa TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tarifas_envio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agencia_id INT REFERENCES agencias_envio(id),
    origen VARCHAR(255) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    tiempo_entrega VARCHAR(100),
    tipo_servicio VARCHAR(50) DEFAULT 'estandar',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Datos de ejemplo
INSERT INTO agencias_envio (nombre, telefono, cobertura) VALUES
('Abeme Modjobuy Envios', '+233552988797', 'Ghana, Togo, Guinea Ecuatorial');

INSERT INTO tarifas_envio (agencia_id, origen, destino, precio, tiempo_entrega) VALUES
(1, 'Accra, Ghana', 'Malabo, Guinea Ecuatorial', 6000, '3-7 días'),
(1, 'Lomé, Togo', 'Malabo, Guinea Ecuatorial', 4000, '3-5 días'),
(1, 'Accra, Ghana', 'Bata, Guinea Ecuatorial', 7000, '5-10 días');
```

---

## 5. Función `formatProduct` — Dónde ubicarla

La función `formatProduct` debe estar ANTES de las acciones, a nivel global del archivo PHP (después de la conexión a la base de datos). Ejemplo de ubicación:

```php
// ... después de $conn = new mysqli(...)
// ... después de $conn->set_charset('utf8mb4')

// Helper function
function formatProduct($row) {
    // ... código de arriba
}

// Acciones
if ($action === 'search_products') {
    // ...
```

---

## 6. Checklist

- [ ] `search_products` actualizado con `note` y fallback
- [ ] Función `formatProduct()` agregada
- [ ] Endpoint `get_product_detail` agregado
- [ ] Endpoint `list_stores` agregado
- [ ] Endpoint `store_products` agregado
- [ ] Endpoint `list_categories` agregado
- [ ] Endpoint `products_by_category` agregado
- [ ] Endpoint `list_agencies` agregado
- [ ] Endpoint `shipping_rates` agregado
- [ ] Endpoint `calculate_shipping` agregado
- [ ] Endpoint `check_user_session` agregado
- [ ] `window.__ETEBA_CHAT_USER__` inyectado en layouts
- [ ] Columnas `tags`, `pais_origen`, `ciudad_origen`, `categoria` en tabla productos
- [ ] Tablas `agencias_envio` y `tarifas_envio` creadas
- [ ] Test con curl funciona

---

## 7. Test rápido

```bash
curl -X POST https://rotteri.com/api/chat-proxy.php \
  -H "Content-Type: application/json" \
  -H "X-Chat-Token: eTb_pXy_9Kw4mR7qN2vL8jB3fZ6hD1" \
  -d '{"action": "search_products", "term": "", "limit": 5}'
```

Debe devolver:
```json
{"results": [...], "query": "", "count": 5, "note": "full_catalog"}
```
