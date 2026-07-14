# Configuración del Proxy PHP en el Workspace de Rotteri

## Objetivo

Configurar el archivo `chat-proxy.php` en el hosting de Rotteri para que el backend de **Eteba Chat** (desplegado en Render) pueda comunicarse con la base de datos MySQL de Rotteri de forma segura.

---

## Archivo a modificar

```
C:\xampp\htdocs\rotteri\public\api\chat-proxy.php
```

En producción (hosting):
```
/public_html/api/chat-proxy.php
```
o la ruta equivalente según tu hosting.

---

## 1. Configurar el Token de Seguridad

Buscar esta línea:

```php
define('CHAT_TOKEN', getenv('CHAT_PROXY_TOKEN') ?: 'TU_TOKEN_SECRETO_AQUI');
```

Reemplazar por:

```php
define('CHAT_TOKEN', getenv('CHAT_PROXY_TOKEN') ?: 'TU_TOKEN_SECRETO_AQUI');
```

> Este token DEBE ser idéntico al valor de `ROTTERI_PROXY_TOKEN` en el `.env.local` de Eteba Chat y en las variables de entorno de Render. Genera uno aleatorio y seguro.

---

## 2. Configurar las Credenciales de MySQL

Buscar estas líneas:

```php
define('DB_HOST', 'localhost');
define('DB_USER', 'TU_USUARIO_MYSQL');
define('DB_PASS', 'TU_PASSWORD_MYSQL');
define('DB_NAME', 'TU_NOMBRE_BD');
```

Reemplazar con los datos reales de tu base de datos MySQL en el hosting:

```php
define('DB_HOST', 'localhost');
define('DB_USER', 'rotteri_usuario');      // ← Tu usuario MySQL real (cPanel → MySQL Databases)
define('DB_PASS', 'tu_password_real');      // ← Tu contraseña MySQL real
define('DB_NAME', 'rotteri_basedatos');     // ← Nombre de tu BD (ej: user123_rotteri)
```

### ¿Dónde encontrar estos datos?

- **cPanel** → Bases de datos MySQL → ahí ves el nombre de la BD y usuarios
- **Plesk** → Bases de datos → detalles de conexión
- Si usas otro panel, busca la sección "MySQL" o "Bases de datos"

---

## 3. Tablas necesarias en MySQL

La base de datos de Rotteri debe tener estas tablas:

### Tabla `productos`

```sql
CREATE TABLE IF NOT EXISTS productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    precio DECIMAL(10,2) NOT NULL DEFAULT 0,
    cantidad INT NOT NULL DEFAULT 0,
    descripcion TEXT,
    imagen_url VARCHAR(500),
    tienda_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla `pedidos_chat`

```sql
CREATE TABLE IF NOT EXISTS pedidos_chat (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_nombre VARCHAR(255) NOT NULL,
    cliente_nombre VARCHAR(255) NOT NULL,
    cliente_telefono VARCHAR(50) NOT NULL,
    ciudad_entrega VARCHAR(255) NOT NULL,
    precio_producto DECIMAL(10,2) DEFAULT 0,
    tienda_id INT,
    producto_id INT,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> Si ya tienes estas tablas, no las vuelvas a crear. Solo verifica que tengan las columnas correctas.

---

## 4. Verificar que el Proxy Funciona

### Test local (XAMPP)

```bash
curl -X POST http://localhost/rotteri/public/api/chat-proxy.php \
  -H "Content-Type: application/json" \
  -H "X-Chat-Token: TU_TOKEN_SECRETO" \
  -d '{"action": "search_products", "term": "zapato"}'
```

Respuesta esperada:
```json
{"results": [{"name": "...", "price": "...", "stock": 0, "description": "...", "image_url": null}]}
```

### Test en producción

```bash
curl -X POST https://rotteri.com/api/chat-proxy.php \
  -H "Content-Type: application/json" \
  -H "X-Chat-Token: TU_TOKEN_SECRETO" \
  -d '{"action": "search_products", "term": "zapato"}'
```

---

## 5. Subir el Archivo al Hosting

1. Conéctate al hosting de rotteri.com por **FTP** o **File Manager de cPanel**
2. Sube `chat-proxy.php` a `/public_html/api/chat-proxy.php` (o la ruta correspondiente)
3. Verifica que sea accesible en: `https://rotteri.com/api/chat-proxy.php`
4. Prueba con el curl de arriba

---

## 6. Permisos del Archivo

```
chat-proxy.php → 644 (rw-r--r--)
```

No debe tener permisos de ejecución (no es CGI).

---

## Resumen de Valores Compartidos

| Concepto | Valor | Dónde se usa |
|----------|-------|--------------|
| Token secreto | *(definido en .env.local)* | `.env.local` de Eteba Chat + `chat-proxy.php` de Rotteri + Variables de Render |
| URL del proxy | `https://rotteri.com/api/chat-proxy.php` | `.env.local` de Eteba Chat + Variables de Render |
| Header del token | `X-Chat-Token` | Lo envía el backend Node.js, lo valida el PHP |

---

## Checklist Final

- [ ] Token configurado en `chat-proxy.php`
- [ ] Credenciales MySQL correctas en `chat-proxy.php`
- [ ] Tablas `productos` y `pedidos_chat` existen en la BD
- [ ] Archivo subido al hosting en la ruta `/api/chat-proxy.php`
- [ ] Test con curl responde correctamente
- [ ] Mismos valores de token en Render y en el PHP
