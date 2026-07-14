# Prompt: Corregir búsqueda de productos en chat-proxy.php

## Problema

El widget de Eteba Chat no muestra productos cuando el usuario pregunta cosas genéricas como "¿qué productos tienen?" o "muéstrame lo disponible". Esto es porque el proxy PHP devuelve un array vacío cuando el término de búsqueda está vacío o es `%`.

## Archivo a modificar

```
C:\xampp\htdocs\rotteri\public\api\chat-proxy.php
```

## Cambio requerido

Busca la sección `action === 'search_products'` y reemplaza la lógica de búsqueda.

### ANTES (código actual):

```php
if ($action === 'search_products') {
    $term = $body['term'] ?? '';
    if (empty($term)) {
        echo json_encode(['results' => []]);
        exit;
    }

    $term = $conn->real_escape_string($term);
    // ... resto de la búsqueda con LIKE
```

### DESPUÉS (código corregido):

```php
if ($action === 'search_products') {
    $term = $body['term'] ?? '';
    
    // Si el término está vacío o es comodín, listar todos los productos disponibles
    if (empty($term) || $term === '%') {
        $result = $conn->query("SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos WHERE cantidad > 0 ORDER BY nombre ASC LIMIT 10");
    } else {
        // Búsqueda normal con LIKE
        $term = $conn->real_escape_string($term);
        $sql = "SELECT nombre, precio, cantidad, descripcion, imagen_url FROM productos 
                WHERE (nombre LIKE '%{$term}%' OR descripcion LIKE '%{$term}%') 
                AND cantidad > 0 
                ORDER BY nombre ASC 
                LIMIT 10";
        $result = $conn->query($sql);
    }

    if (!$result) {
        http_response_code(500);
        echo json_encode(['error' => 'Error en consulta: ' . $conn->error]);
        exit;
    }

    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = [
            'name'        => $row['nombre'],
            'price'       => $row['precio'],
            'stock'       => (int)$row['cantidad'],
            'description' => $row['descripcion'] ?? '',
            'image_url'   => $row['imagen_url'] ?? null,
        ];
    }
    echo json_encode(['results' => $rows]);
```

## Resumen del cambio

- Si `term` está vacío o es `%` → devolver los 10 primeros productos disponibles (en vez de array vacío)
- Si `term` tiene un valor → buscar normalmente con LIKE (sin cambios)

## Resultado esperado

Después de este cambio, cuando un usuario pregunte "¿qué tienen?" o "productos disponibles" en el widget de Eteba Chat, el bot mostrará los productos del catálogo de Rotteri con sus tarjetas de precio e imagen.

## Test

```bash
curl -X POST https://rotteri.com/api/chat-proxy.php \
  -H "Content-Type: application/json" \
  -H "X-Chat-Token: TU_TOKEN" \
  -d '{"action": "search_products", "term": "%"}'
```

Debería devolver productos en vez de `{"results": []}`.
