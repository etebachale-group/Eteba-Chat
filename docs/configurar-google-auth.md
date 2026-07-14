# Configurar Google OAuth para Eteba Chat

## Requisitos

Para que "Iniciar Sesión con Google" funcione, necesitas:
1. Un proyecto en Google Cloud Console
2. Credenciales OAuth 2.0 configuradas
3. Las credenciales registradas en InsForge

---

## Paso 1: Google Cloud Console

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Crea un proyecto nuevo (o usa uno existente)
3. Ve a **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client IDs**
5. Tipo: **Web application**
6. Nombre: `Eteba Chat`
7. **Authorized redirect URIs** — agrega:
   ```
   https://2w3vbe39.us-east.insforge.app/auth/v1/callback
   ```
8. Click **Create** — copia el **Client ID** y **Client Secret**

---

## Paso 2: Configurar en InsForge

1. Ve a tu dashboard de InsForge: [insforge.app](https://insforge.app)
2. Selecciona el proyecto **Eteba AI**
3. Ve a **Authentication → Providers**
4. Activa **Google**
5. Pega tu **Client ID** y **Client Secret** de Google
6. Guarda

---

## Paso 3: Configurar URLs permitidas

En InsForge → Authentication → URL Configuration:

| Campo | Valor |
|-------|-------|
| Site URL | `https://eteba-chat.onrender.com` |
| Redirect URLs | `https://eteba-chat.onrender.com`, `http://localhost:3000` |

---

## Paso 4: Verificar

1. Ve a `https://eteba-chat.onrender.com`
2. Click "Iniciar Sesión" o "Comenzar Gratis"
3. Se redirige a Google → autorizas → vuelve al dashboard

---

## Troubleshooting

- **"redirect_uri_mismatch"** → La URL de redirect en Google Cloud no coincide. Debe ser exactamente `https://2w3vbe39.us-east.insforge.app/auth/v1/callback`
- **Pantalla en blanco después del login** → Verificar que la Site URL en InsForge sea `https://eteba-chat.onrender.com`
- **Error 401 en /auth/v1/user** → El token expiró. Se necesita refresh automático (ya implementado en el código)

---

## Para desarrollo local

Agrega también estos redirect URIs en Google Cloud:
```
http://localhost:3000
```

Y en InsForge, agrega `http://localhost:3000` a la lista de Redirect URLs.
