/**
 * Eteba Chat — Registration & Login Modal Module
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.8
 *
 * Exposes a global `RegistrationPage` object with:
 *   - show(preselectedPlan?)  — render modal overlay
 *   - hide()                  — close modal
 */
const RegistrationPage = (() => {
  'use strict';

  /** Currently preselected plan (passed from pricing CTA buttons) */
  let _preselectedPlan = null;

  // ─── Styles Injection ──────────────────────────────────────────────────────

  const _STYLE_ID = 'reg-modal-styles';

  function _injectStyles() {
    if (document.getElementById(_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = _STYLE_ID;
    style.textContent = `
      /* ── Registration Modal — Base ── */
      .reg-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      .reg-modal-overlay.reg-modal--visible {
        opacity: 1;
      }

      /* ── Card ── */
      .reg-modal {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 16px;
        padding: 2rem;
        width: 100%;
        max-width: 420px;
        position: relative;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
        max-height: 90vh;
        overflow-y: auto;
        color: #f9fafb;
        transform: translateY(12px);
        transition: transform 0.25s ease;
      }
      .reg-modal-overlay.reg-modal--visible .reg-modal {
        transform: translateY(0);
      }

      /* ── Close button ── */
      .reg-modal__close {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        transition: color 0.15s, background 0.15s;
      }
      .reg-modal__close:hover {
        color: #f9fafb;
        background: rgba(255,255,255,0.08);
      }

      /* ── Header ── */
      .reg-modal__header {
        margin-bottom: 1.5rem;
      }
      .reg-modal__title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #f9fafb;
        margin: 0 0 0.25rem;
      }
      .reg-modal__subtitle {
        font-size: 0.875rem;
        color: #9ca3af;
        margin: 0;
      }

      /* ── Plan note ── */
      .reg-plan-note {
        margin-top: 0.5rem;
        font-size: 0.8125rem;
        color: #6ee7b7;
      }

      /* ── Panel visibility ── */
      .reg-panel {
        display: none;
      }
      .reg-panel.reg-panel--active {
        display: block;
      }

      /* ── Google button ── */
      .reg-btn-google {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.625rem;
        width: 100%;
        padding: 0.75rem 1rem;
        background: #fff;
        color: #111827;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, box-shadow 0.15s;
      }
      .reg-btn-google:hover {
        background: #f3f4f6;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      .reg-btn-google__icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      /* ── Divider ── */
      .reg-divider {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin: 1.25rem 0;
        color: #6b7280;
        font-size: 0.8125rem;
      }
      .reg-divider::before,
      .reg-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: #374151;
      }

      /* ── Form groups ── */
      .reg-form-group {
        margin-bottom: 1rem;
      }
      .reg-form-label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: #d1d5db;
        margin-bottom: 0.375rem;
      }
      .reg-input {
        width: 100%;
        padding: 0.625rem 0.875rem;
        background: #111827;
        border: 1px solid #374151;
        border-radius: 8px;
        color: #f9fafb;
        font-size: 0.9375rem;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .reg-input:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
      }
      .reg-input::placeholder {
        color: #6b7280;
      }
      .reg-input--error {
        border-color: #ef4444 !important;
      }
      .reg-input--error:focus {
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2) !important;
      }

      /* ── Field-level errors ── */
      .reg-field-error {
        display: block;
        font-size: 0.8125rem;
        color: #f87171;
        margin-top: 0.25rem;
        min-height: 1.1em;
      }

      /* ── Form-level error banner ── */
      .reg-form-error {
        display: none;
        width: 100%;
        box-sizing: border-box;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.4);
        border-radius: 8px;
        padding: 0.625rem 0.875rem;
        font-size: 0.875rem;
        color: #fca5a5;
        margin-bottom: 1rem;
      }
      .reg-form-error a {
        color: #93c5fd;
        text-decoration: underline;
        cursor: pointer;
      }

      /* ── Submit button ── */
      .reg-btn-submit {
        width: 100%;
        padding: 0.75rem 1rem;
        background: #3b82f6;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
        margin-top: 0.5rem;
      }
      .reg-btn-submit:hover:not(:disabled) {
        background: #2563eb;
      }
      .reg-btn-submit:active:not(:disabled) {
        transform: scale(0.98);
      }
      .reg-btn-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      /* ── Switch link ── */
      .reg-switch-link {
        text-align: center;
        font-size: 0.875rem;
        color: #9ca3af;
        margin-top: 1.25rem;
        margin-bottom: 0;
      }
      .reg-switch-link a {
        color: #60a5fa;
        text-decoration: none;
        font-weight: 500;
      }
      .reg-switch-link a:hover {
        text-decoration: underline;
      }

      /* ── Scrollbar for modal ── */
      .reg-modal::-webkit-scrollbar { width: 4px; }
      .reg-modal::-webkit-scrollbar-track { background: transparent; }
      .reg-modal::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
    `;
    document.head.appendChild(style);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Render the modal overlay with the registration form */
  function show(preselectedPlan) {
    _preselectedPlan = preselectedPlan || null;

    // Ensure styles are injected into <head>
    _injectStyles();

    // Remove any existing instance
    _destroy();

    document.body.insertAdjacentHTML('beforeend', _buildModalHTML());

    const overlay = document.getElementById('reg-modal-overlay');

    // Wire close triggers
    document.getElementById('reg-modal-close')?.addEventListener('click', hide);
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) hide();
    });
    document.addEventListener('keydown', _onEscKey);

    // Wire tab switchers
    document.getElementById('reg-switch-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      _showLoginPanel();
    });
    document.getElementById('reg-login-switch-to-register')?.addEventListener('click', (e) => {
      e.preventDefault();
      _showRegisterPanel();
    });

    // Wire Google OAuth
    document.getElementById('reg-google-btn')?.addEventListener('click', () => {
      window.location.href = '/auth/google';
    });
    document.getElementById('reg-login-google-btn')?.addEventListener('click', () => {
      window.location.href = '/auth/google';
    });

    // Wire inline validation
    _wireRegisterValidation();
    _wireLoginValidation();

    // Wire form submissions
    document.getElementById('reg-form')?.addEventListener('submit', _handleRegisterSubmit);
    document.getElementById('reg-login-form')?.addEventListener('submit', _handleLoginSubmit);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      overlay?.classList.add('reg-modal--visible');
    });
  }

  /** Close and remove the modal */
  function hide() {
    const overlay = document.getElementById('reg-modal-overlay');
    if (!overlay) return;

    overlay.classList.remove('reg-modal--visible');
    document.removeEventListener('keydown', _onEscKey);

    // Remove after transition
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    // Fallback for browsers that skip transitionend
    setTimeout(() => overlay.remove(), 400);
  }

  // ─── Panel Switchers ───────────────────────────────────────────────────────

  function _showLoginPanel() {
    document.getElementById('reg-panel-register')?.classList.remove('reg-panel--active');
    document.getElementById('reg-panel-login')?.classList.add('reg-panel--active');
  }

  function _showRegisterPanel() {
    document.getElementById('reg-panel-login')?.classList.remove('reg-panel--active');
    document.getElementById('reg-panel-register')?.classList.add('reg-panel--active');
  }

  // ─── HTML Builder ──────────────────────────────────────────────────────────

  function _buildModalHTML() {
    const planNote = _preselectedPlan
      ? `<p class="reg-plan-note">Plan seleccionado: <strong>${_capitalize(_preselectedPlan)}</strong></p>`
      : '';

    return `
<div id="reg-modal-overlay" class="reg-modal-overlay" role="dialog" aria-modal="true" aria-label="Crear cuenta">
  <div class="reg-modal">
    <!-- Close -->
    <button class="reg-modal__close" id="reg-modal-close" aria-label="Cerrar">&times;</button>

    <!-- ── Registration Panel ── -->
    <div id="reg-panel-register" class="reg-panel reg-panel--active">
      <div class="reg-modal__header">
        <h2 class="reg-modal__title">Crear cuenta</h2>
        <p class="reg-modal__subtitle">Empieza gratis. Sin tarjeta de crédito.</p>
        ${planNote}
      </div>

      <!-- Google OAuth -->
      <button class="reg-btn-google" id="reg-google-btn" type="button">
        <svg class="reg-btn-google__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </button>

      <div class="reg-divider"><span>o regístrate con email</span></div>

      <!-- Email/Password Registration Form -->
      <form id="reg-form" novalidate autocomplete="off">
        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-name">Nombre completo</label>
          <input
            type="text"
            id="reg-name"
            name="name"
            class="reg-input"
            placeholder="Tu nombre y apellido"
            autocomplete="name"
            required
          >
          <span class="reg-field-error" id="reg-name-error" aria-live="polite"></span>
        </div>

        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-email">Correo electrónico</label>
          <input
            type="email"
            id="reg-email"
            name="email"
            class="reg-input"
            placeholder="nombre@empresa.com"
            autocomplete="email"
            required
          >
          <span class="reg-field-error" id="reg-email-error" aria-live="polite"></span>
        </div>

        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-password">Contraseña</label>
          <input
            type="password"
            id="reg-password"
            name="password"
            class="reg-input"
            placeholder="Mínimo 8 caracteres"
            autocomplete="new-password"
            minlength="8"
            required
          >
          <span class="reg-field-error" id="reg-password-error" aria-live="polite"></span>
        </div>

        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-confirm">Confirmar contraseña</label>
          <input
            type="password"
            id="reg-confirm"
            name="passwordConfirm"
            class="reg-input"
            placeholder="Repite la contraseña"
            autocomplete="new-password"
            required
          >
          <span class="reg-field-error" id="reg-confirm-error" aria-live="polite"></span>
        </div>

        <span class="reg-form-error" id="reg-form-error" aria-live="polite"></span>

        <button type="submit" class="reg-btn-submit" id="reg-submit-btn">
          Crear cuenta
        </button>
      </form>

      <p class="reg-switch-link">
        ¿Ya tienes cuenta?
        <a href="#" id="reg-switch-to-login">Iniciar Sesión</a>
      </p>
    </div>

    <!-- ── Login Panel ── -->
    <div id="reg-panel-login" class="reg-panel">
      <div class="reg-modal__header">
        <h2 class="reg-modal__title">Iniciar sesión</h2>
        <p class="reg-modal__subtitle">Bienvenido de nuevo a Eteba Chat.</p>
      </div>

      <!-- Google OAuth -->
      <button class="reg-btn-google" id="reg-login-google-btn" type="button">
        <svg class="reg-btn-google__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </button>

      <div class="reg-divider"><span>o inicia sesión con email</span></div>

      <form id="reg-login-form" novalidate autocomplete="on">
        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-login-email">Correo electrónico</label>
          <input
            type="email"
            id="reg-login-email"
            name="email"
            class="reg-input"
            placeholder="nombre@empresa.com"
            autocomplete="email"
            required
          >
          <span class="reg-field-error" id="reg-login-email-error" aria-live="polite"></span>
        </div>

        <div class="reg-form-group">
          <label class="reg-form-label" for="reg-login-password">Contraseña</label>
          <input
            type="password"
            id="reg-login-password"
            name="password"
            class="reg-input"
            placeholder="Tu contraseña"
            autocomplete="current-password"
            required
          >
          <span class="reg-field-error" id="reg-login-password-error" aria-live="polite"></span>
        </div>

        <span class="reg-form-error" id="reg-login-form-error" aria-live="polite"></span>

        <button type="submit" class="reg-btn-submit" id="reg-login-submit-btn">
          Iniciar sesión
        </button>
      </form>

      <p class="reg-switch-link">
        ¿No tienes cuenta?
        <a href="#" id="reg-login-switch-to-register">Crear cuenta gratis</a>
      </p>
    </div>
  </div>
</div>`;
  }

  // ─── Client-Side Validation ────────────────────────────────────────────────

  function _wireRegisterValidation() {
    const passwordInput = document.getElementById('reg-password');
    const confirmInput  = document.getElementById('reg-confirm');

    passwordInput?.addEventListener('blur', () => {
      _clearFieldError('reg-password');
      const val = passwordInput.value;
      if (val && val.length < 8) {
        _setFieldError('reg-password', 'La contraseña debe tener al menos 8 caracteres');
      }
    });

    confirmInput?.addEventListener('blur', () => {
      _clearFieldError('reg-confirm');
      const pwd = document.getElementById('reg-password')?.value || '';
      const conf = confirmInput.value;
      if (conf && conf !== pwd) {
        _setFieldError('reg-confirm', 'Las contraseñas no coinciden');
      }
    });
  }

  function _wireLoginValidation() {
    // No extra inline validation needed for login beyond submit-time check
  }

  /** Returns true when all fields pass; false + shows inline errors otherwise */
  function _validateRegisterForm() {
    let valid = true;
    _clearAllRegisterErrors();

    const name    = document.getElementById('reg-name')?.value.trim() || '';
    const email   = document.getElementById('reg-email')?.value.trim() || '';
    const pwd     = document.getElementById('reg-password')?.value || '';
    const confirm = document.getElementById('reg-confirm')?.value || '';

    if (!name) {
      _setFieldError('reg-name', 'El nombre es obligatorio');
      valid = false;
    }

    if (!email || !_isValidEmail(email)) {
      _setFieldError('reg-email', 'Introduce un correo electrónico válido');
      valid = false;
    }

    if (pwd.length < 8) {
      _setFieldError('reg-password', 'La contraseña debe tener al menos 8 caracteres');
      valid = false;
    }

    if (pwd !== confirm) {
      _setFieldError('reg-confirm', 'Las contraseñas no coinciden');
      valid = false;
    }

    return valid;
  }

  // ─── Form Submission Handlers ──────────────────────────────────────────────

  async function _handleRegisterSubmit(e) {
    e.preventDefault();

    if (!_validateRegisterForm()) return;

    const name     = document.getElementById('reg-name').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const passwordConfirm = document.getElementById('reg-confirm').value;

    _setSubmitLoading('reg-submit-btn', true);
    _clearFormError('reg-form-error');

    try {
      const resp = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, passwordConfirm })
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 409 || data.code === 'email_exists') {
        // Email already registered — show error with Sign In link
        _setFormError(
          'reg-form-error',
          `Este correo ya está registrado. <a href="#" id="reg-err-signin-link">Iniciar Sesión</a>`
        );
        document.getElementById('reg-err-signin-link')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          _showLoginPanel();
        });
        return;
      }

      if (resp.status === 400 && data.fields) {
        // Field-level validation errors from server
        Object.entries(data.fields).forEach(([field, msg]) => {
          const errorId = _fieldErrorId(field);
          if (errorId) _setFieldError(errorId.replace('-error', ''), msg);
        });
        return;
      }

      if (!resp.ok) {
        _setFormError('reg-form-error', data.error || 'Error al crear la cuenta. Intenta de nuevo.');
        return;
      }

      // ── Success ──
      _storeSession(data);

      hide();

      if (data.isNewUser !== false) {
        // Attempt to launch onboarding wizard
        if (typeof OnboardingWizard !== 'undefined' && OnboardingWizard.init) {
          OnboardingWizard.init(_preselectedPlan);
        } else {
          AppRouter.navigate('dashboard');
          if (typeof Dashboard !== 'undefined') Dashboard.loadDashboardData();
        }
      } else {
        AppRouter.navigate('dashboard');
        if (typeof Dashboard !== 'undefined') Dashboard.loadDashboardData();
      }
    } catch (err) {
      _setFormError('reg-form-error', 'Error de conexión. Verifica tu red e intenta de nuevo.');
    } finally {
      _setSubmitLoading('reg-submit-btn', false);
    }
  }

  async function _handleLoginSubmit(e) {
    e.preventDefault();

    const email    = document.getElementById('reg-login-email')?.value.trim() || '';
    const password = document.getElementById('reg-login-password')?.value || '';

    _clearAllLoginErrors();

    let valid = true;
    if (!email || !_isValidEmail(email)) {
      _setFieldError('reg-login-email', 'Introduce un correo electrónico válido');
      valid = false;
    }
    if (!password) {
      _setFieldError('reg-login-password', 'La contraseña es obligatoria');
      valid = false;
    }
    if (!valid) return;

    _setSubmitLoading('reg-login-submit-btn', true);
    _clearFormError('reg-login-form-error');

    try {
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        _setFormError('reg-login-form-error', 'Correo o contraseña incorrectos');
        return;
      }

      if (!resp.ok) {
        _setFormError('reg-login-form-error', data.error || 'Error al iniciar sesión. Intenta de nuevo.');
        return;
      }

      // ── Success ──
      _storeSession(data);
      hide();
      AppRouter.navigate('dashboard');
      if (typeof Dashboard !== 'undefined') Dashboard.loadDashboardData();
    } catch (err) {
      _setFormError('reg-login-form-error', 'Error de conexión. Verifica tu red e intenta de nuevo.');
    } finally {
      _setSubmitLoading('reg-login-submit-btn', false);
    }
  }

  // ─── Session Storage ───────────────────────────────────────────────────────

  function _storeSession(data) {
    const token = data.token;
    if (!token) return;

    if (typeof Auth !== 'undefined' && Auth.setToken) {
      Auth.setToken(token);
    } else {
      localStorage.setItem('eteba_token', token);
    }

    if (data.user) {
      localStorage.setItem('eteba_user', JSON.stringify(data.user));
    }

    // Trigger Auth UI update if available
    if (typeof Auth !== 'undefined' && Auth.checkSession) {
      // Re-decode the newly stored token so Auth's internal state is populated
      Auth.checkSession();
    }
  }

  // ─── DOM Helpers ───────────────────────────────────────────────────────────

  function _setFieldError(fieldId, message) {
    const input = document.getElementById(fieldId);
    const errEl = document.getElementById(`${fieldId}-error`);
    if (input)  input.classList.add('reg-input--error');
    if (errEl)  errEl.textContent = message;
  }

  function _clearFieldError(fieldId) {
    const input = document.getElementById(fieldId);
    const errEl = document.getElementById(`${fieldId}-error`);
    if (input)  input.classList.remove('reg-input--error');
    if (errEl)  errEl.textContent = '';
  }

  function _setFormError(errorElId, htmlMessage) {
    const el = document.getElementById(errorElId);
    if (el) {
      el.innerHTML = htmlMessage;
      el.style.display = 'block';
    }
  }

  function _clearFormError(errorElId) {
    const el = document.getElementById(errorElId);
    if (el) {
      el.innerHTML = '';
      el.style.display = 'none';
    }
  }

  function _clearAllRegisterErrors() {
    ['reg-name', 'reg-email', 'reg-password', 'reg-confirm'].forEach(_clearFieldError);
    _clearFormError('reg-form-error');
  }

  function _clearAllLoginErrors() {
    ['reg-login-email', 'reg-login-password'].forEach(_clearFieldError);
    _clearFormError('reg-login-form-error');
  }

  function _setSubmitLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? 'Procesando…' : btn.dataset.originalText;
  }

  /** Map a server field name to its DOM error element prefix */
  function _fieldErrorId(serverField) {
    const map = {
      name:            'reg-name',
      email:           'reg-email',
      password:        'reg-password',
      passwordConfirm: 'reg-confirm',
    };
    return map[serverField] ? `${map[serverField]}-error` : null;
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function _capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function _onEscKey(e) {
    if (e.key === 'Escape') hide();
  }

  function _destroy() {
    document.getElementById('reg-modal-overlay')?.remove();
    document.removeEventListener('keydown', _onEscKey);
  }

  return { show, hide };
})();
