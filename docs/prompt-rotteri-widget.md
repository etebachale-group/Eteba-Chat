# Prompt: Verificar Widget de Eteba Chat en Rotteri

## Contexto

El backend de Eteba Chat ya está desplegado y funcionando en Render:

- **URL del servicio:** `https://eteba-chat.onrender.com`
- **Estado:** ✅ Live y operativo
- **Modo:** Producción (usando proxy PHP para MySQL)

El widget del chat debe cargarse en rotteri.com desde esta URL:

```
https://eteba-chat.onrender.com/widget/widget.js?tenant_id=e22e9ee0-d29a-4172-88de-fb9ad14c9c1b
```

## Problema

El chat no aparece en rotteri.com. Necesito verificar y corregir la integración del widget.

## Lo que necesito que revises

### 1. Buscar el script tag del widget en los layouts

Busca en todos los archivos de layout (desktop y mobile) dónde se incluye el widget de Eteba Chat. Debería estar en alguno de estos lugares:

- `resources/views/layouts/*.blade.php`
- `resources/views/components/*.blade.php`
- O cualquier archivo que contenga `widget.js` o `eteba`

### 2. Verificar que el script tag sea correcto

El script tag DEBE ser exactamente:

```html
<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=e22e9ee0-d29a-4172-88de-fb9ad14c9c1b"></script>
```

**Errores comunes a corregir:**
- Si apunta a `localhost:3000` → cambiar a `https://eteba-chat.onrender.com`
- Si apunta a `railway` → cambiar a `https://eteba-chat.onrender.com`
- Si usa `http://` → cambiar a `https://`
- Si falta el `tenant_id` → agregarlo
- Si está comentado → descomentarlo

### 3. Ubicación del script tag

Debe estar justo antes del cierre `</body>` para no bloquear la carga de la página:

```html
    <!-- Eteba Chat Widget -->
    <script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=e22e9ee0-d29a-4172-88de-fb9ad14c9c1b"></script>
</body>
```

### 4. Verificar que no haya conflictos

- No debe haber CSP (Content-Security-Policy) que bloquee scripts externos de `onrender.com`
- No debe haber otro widget de chat que entre en conflicto (z-index, posición fixed bottom-right)
- Verificar que no haya un `if/else` de entorno que oculte el widget en producción

## Datos de referencia

| Concepto | Valor |
|----------|-------|
| Backend URL | `https://eteba-chat.onrender.com` |
| Widget JS | `https://eteba-chat.onrender.com/widget/widget.js` |
| Widget CSS | `https://eteba-chat.onrender.com/widget/widget.css` |
| Tenant ID | `e22e9ee0-d29a-4172-88de-fb9ad14c9c1b` |
| API Endpoint | `https://eteba-chat.onrender.com/api/query` |

## Resultado esperado

Después de la corrección, al visitar rotteri.com debería aparecer un botón verde circular (launcher) en la esquina inferior derecha que al hacer click abre la ventana del chat.
