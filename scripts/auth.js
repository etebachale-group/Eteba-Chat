/**
 * Eteba Chat — Authentication Module
 * Google OAuth via InsForge SDK
 */
const Auth = (() => {
  const INSFORGE_BASE_URL = 'https://2w3vbe39.us-east.insforge.app';
  let currentUser = null;

  function getUser() {
    return currentUser;
  }

  function isLoggedIn() {
    return currentUser !== null;
  }

  async function signInWithGoogle() {
    // Redirigir al OAuth de InsForge con Google
    const redirectUrl = `${window.location.origin}${window.location.pathname}`;
    window.location.href = `${INSFORGE_BASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
  }

  async function signOut() {
    try {
      await fetch(`${INSFORGE_BASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAccessToken()}` }
      });
    } catch (e) {
      // Ignorar errores de red
    }
    localStorage.removeItem('eteba_access_token');
    localStorage.removeItem('eteba_user');
    currentUser = null;
    updateUI();
    AppRouter.navigate('landing');
  }

  function getAccessToken() {
    return localStorage.getItem('eteba_access_token');
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
        avatarEl.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:600;">${(currentUser.name || 'U')[0]}</span>`;
      }
    } else {
      guestEl.classList.remove('hidden');
      userEl.classList.add('hidden');
    }
  }

  function checkSession() {
    // Verificar si hay un token en URL (redirect de OAuth)
    const hashParams = new URLSearchParams(window.location.hash.replace('#', '?').replace('?', ''));
    const accessToken = hashParams.get('access_token');
    
    if (accessToken) {
      localStorage.setItem('eteba_access_token', accessToken);
      // Limpiar URL
      window.history.replaceState(null, '', window.location.pathname);
      fetchUser(accessToken);
      return;
    }

    // Verificar token guardado
    const savedToken = localStorage.getItem('eteba_access_token');
    const savedUser = localStorage.getItem('eteba_user');

    if (savedToken && savedUser) {
      try {
        currentUser = JSON.parse(savedUser);
        updateUI();
      } catch {
        localStorage.removeItem('eteba_user');
      }
    }
  }

  async function fetchUser(token) {
    try {
      const resp = await fetch(`${INSFORGE_BASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        currentUser = {
          id: data.id,
          email: data.email,
          name: data.user_metadata?.full_name || data.email?.split('@')[0],
          avatar_url: data.user_metadata?.avatar_url || null,
        };
        localStorage.setItem('eteba_user', JSON.stringify(currentUser));
        updateUI();
        AppRouter.navigate('dashboard');
      }
    } catch (e) {
      console.error('[Auth] Error fetching user:', e);
    }
  }

  function init() {
    // Botones de login
    document.getElementById('btn-login')?.addEventListener('click', signInWithGoogle);
    document.getElementById('btn-register')?.addEventListener('click', signInWithGoogle);
    document.getElementById('hero-cta')?.addEventListener('click', signInWithGoogle);

    // Avatar click → logout (temporal)
    document.getElementById('user-avatar')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) signOut();
    });

    checkSession();
  }

  return { init, getUser, isLoggedIn, signInWithGoogle, signOut, getAccessToken };
})();
