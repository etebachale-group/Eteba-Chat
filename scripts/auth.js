/**
 * Eteba Chat — Authentication Module
 * Google OAuth 2.0 directo (sin InsForge Auth)
 */
const Auth = (() => {
  let currentUser = null;

  function getUser() {
    return currentUser;
  }

  function isLoggedIn() {
    return currentUser !== null;
  }

  /** Redirigir a Google OAuth (el backend maneja todo el flujo) */
  function signInWithGoogle() {
    window.location.href = '/auth/google';
  }

  function signOut() {
    localStorage.removeItem('eteba_token');
    localStorage.removeItem('eteba_user');
    currentUser = null;
    updateUI();
    AppRouter.navigate('landing');
  }

  function getAccessToken() {
    return localStorage.getItem('eteba_token');
  }

  function updateUI() {
    const guestEl = document.getElementById('auth-guest');
    const userEl = document.getElementById('auth-user');
    const avatarEl = document.getElementById('user-avatar');

    if (isLoggedIn()) {
      guestEl.classList.add('hidden');
      userEl.classList.remove('hidden');
      if (currentUser.avatar_url) {
        avatarEl.innerHTML = `<img src="${currentUser.avatar_url}" alt="${currentUser.name}">`;
      } else {
        const initial = (currentUser.name || currentUser.email || 'U')[0].toUpperCase();
        avatarEl.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:600;">${initial}</span>`;
      }
    } else {
      guestEl.classList.remove('hidden');
      userEl.classList.add('hidden');
    }
  }

  /** Verificar si hay un token en la URL (redirect de OAuth) o en localStorage */
  function checkSession() {
    // 1. Verificar si hay token en la URL (viene del callback de Google)
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('auth_token');

    if (authToken) {
      // Guardar token y limpiar URL
      localStorage.setItem('eteba_token', authToken);
      window.history.replaceState(null, '', window.location.pathname);
      decodeAndSetUser(authToken);
      return;
    }

    // 2. Verificar token guardado
    const savedToken = localStorage.getItem('eteba_token');
    if (savedToken) {
      decodeAndSetUser(savedToken);
    }
  }

  /** Decodificar token base64url y establecer usuario */
  function decodeAndSetUser(token) {
    try {
      const payload = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
      currentUser = {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        avatar_url: payload.avatar_url || null,
        role: payload.role || 'user',
        tenantId: payload.tenantId || payload.id,
      };
      localStorage.setItem('eteba_user', JSON.stringify(currentUser));
      updateUI();

      // Navegar al dashboard si viene de un login fresco
      if (window.location.search.includes('auth_token') || !window.location.hash) {
        AppRouter.navigate('dashboard');
        Dashboard.loadDashboardData();
      }
    } catch (e) {
      console.error('[Auth] Token inválido:', e);
      localStorage.removeItem('eteba_token');
      localStorage.removeItem('eteba_user');
    }
  }

  function init() {
    // Botones de login
    document.getElementById('btn-login')?.addEventListener('click', signInWithGoogle);
    document.getElementById('btn-register')?.addEventListener('click', signInWithGoogle);
    document.getElementById('hero-cta')?.addEventListener('click', signInWithGoogle);

    // Avatar click → menú/logout
    document.getElementById('user-avatar')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) signOut();
    });

    checkSession();
  }

  return { init, getUser, isLoggedIn, signInWithGoogle, signOut, getAccessToken };
})();
