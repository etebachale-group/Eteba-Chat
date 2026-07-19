/**
 * Eteba Chat — Onboarding Wizard Module
 * 5-step guided setup for new tenants.
 * Requirements: 2.1–2.13
 */
const OnboardingWizard = (() => {
  'use strict';

  let _currentStep = 1;
  const _totalSteps = 5;
  let _stepData = {};
  let _preselectedPlan = null;
  let _trialUsed = false;

  function _token() {
    return typeof Auth !== 'undefined' ? Auth.getAccessToken() : localStorage.getItem('eteba_token');
  }

  function _apiHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${_token()}` };
  }

  async function init(preselectedPlan) {
    if (typeof Auth !== 'undefined') {
      const user = Auth.getUser();
      if (user && user.role === 'admin') {
        return; // Omitir onboarding para Super Admin
      }
    }

    _preselectedPlan = preselectedPlan || null;
    try {
      const r = await fetch('/api/onboarding/status', { headers: _apiHeaders() });
      if (!r.ok) return;
      const s = await r.json();
      if (s.completed) return;
      _currentStep = s.currentStep > 0 ? s.currentStep : 1;
      _stepData = s.stepData || {};

      // check trial usage
      try {
        const sr = await fetch('/api/subscription', { headers: _apiHeaders() });
        if (sr.ok) {
          const sd = await sr.json();
          _trialUsed = !!(sd.subscription && sd.subscription.trial_used_at);
        }
      } catch (_) {}

      _render();
    } catch (e) {
      console.error('[Onboarding] init error:', e);
    }
  }

  function show() { _render(); }

  function hide() {
    document.getElementById('onboarding-overlay')?.remove();
    const dash = document.getElementById('page-dashboard');
    if (dash) dash.style.display = '';
  }

  function _render() {
    document.getElementById('onboarding-overlay')?.remove();
    const html = `
<div id="onboarding-overlay" style="position:fixed;inset:0;background:#111827;z-index:9000;overflow-y:auto;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:640px;width:100%;padding:2rem;margin:auto;">
    <div style="margin-bottom:2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <span id="ow-step-counter" style="font-size:0.875rem;color:#9ca3af;">Paso 1 de 5</span>
        <span id="ow-skip-btn" style="font-size:0.8rem;color:#6b7280;cursor:pointer;text-decoration:underline;display:none;">Saltar configuración</span>
      </div>
      <div style="background:#374151;border-radius:9999px;height:6px;">
        <div id="ow-progress-bar" style="background:#6366f1;height:6px;border-radius:9999px;transition:width 0.3s;width:20%;"></div>
      </div>
    </div>
    <div id="ow-step-content" style="background:#1f2937;border:1px solid #374151;border-radius:1rem;padding:2rem;"></div>
    <div style="display:flex;justify-content:space-between;margin-top:1.5rem;">
      <button id="ow-back-btn" onclick="OnboardingWizard._back()" style="display:none;padding:0.6rem 1.2rem;background:transparent;border:1px solid #374151;border-radius:8px;color:#d1d5db;cursor:pointer;font-size:0.9rem;">← Atrás</button>
      <button id="ow-next-btn" onclick="OnboardingWizard._next()" style="margin-left:auto;padding:0.6rem 1.4rem;background:#6366f1;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.9rem;font-weight:600;">Continuar →</button>
    </div>
  </div>
</div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('ow-skip-btn').addEventListener('click', _skip);
    _renderStep(_currentStep);
  }

  function _renderStep(n) {
    _currentStep = n;
    const counter = document.getElementById('ow-step-counter');
    const bar = document.getElementById('ow-progress-bar');
    const backBtn = document.getElementById('ow-back-btn');
    const nextBtn = document.getElementById('ow-next-btn');
    const skipBtn = document.getElementById('ow-skip-btn');

    if (counter) counter.textContent = `Paso ${n} de ${_totalSteps}`;
    if (bar) bar.style.width = `${(n / _totalSteps) * 100}%`;
    if (backBtn) backBtn.style.display = n > 1 ? '' : 'none';
    if (nextBtn) nextBtn.textContent = n === 5 ? 'Finalizar configuración ✓' : 'Continuar →';
    if (skipBtn) skipBtn.style.display = n > 1 ? '' : 'none';

    const content = document.getElementById('ow-step-content');
    if (!content) return;

    switch (n) {
      case 1: content.innerHTML = _step1HTML(); _restoreStep1(); break;
      case 2: content.innerHTML = _step2HTML(); _restoreStep2(); break;
      case 3: content.innerHTML = _step3HTML(); _restoreStep3(); break;
      case 4: content.innerHTML = _step4HTML(); _restoreStep4(); break;
      case 5: content.innerHTML = _step5HTML(); break;
    }
  }

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  function _step1HTML() {
    return `
<h2 style="font-size:1.5rem;font-weight:700;margin:0 0 0.5rem;color:#f9fafb;">¡Bienvenido a Eteba Chat!</h2>
<p style="color:#9ca3af;margin:0 0 1.5rem;">Configura tu negocio en 5 minutos.</p>
<div style="margin-bottom:1rem;">
  <label style="display:block;font-size:0.875rem;font-weight:500;margin-bottom:0.4rem;color:#d1d5db;">Nombre de tu negocio *</label>
  <input id="ow-business-name" type="text" placeholder="Ej: Tienda Malabo" minlength="2" maxlength="128" style="width:100%;padding:0.625rem 0.875rem;background:#111827;border:1px solid #374151;border-radius:8px;color:#f9fafb;font-size:0.9375rem;box-sizing:border-box;outline:none;">
  <span id="ow-name-error" style="color:#f87171;font-size:0.8rem;display:none;">El nombre debe tener entre 2 y 128 caracteres</span>
</div>
<div>
  <label style="display:block;font-size:0.875rem;font-weight:500;margin-bottom:0.4rem;color:#d1d5db;">País / Región *</label>
  <select id="ow-country" style="width:100%;padding:0.625rem 0.875rem;background:#111827;border:1px solid #374151;border-radius:8px;color:#f9fafb;font-size:0.9375rem;box-sizing:border-box;">
    <option value="">Selecciona tu país</option>
    <option value="cameroon">Camerún</option>
    <option value="equatorial_guinea">Guinea Ecuatorial</option>
    <option value="gabon">Gabón</option>
    <option value="nigeria">Nigeria</option>
    <option value="senegal">Senegal</option>
    <option value="ivory_coast">Costa de Marfil</option>
    <option value="other">Otro</option>
  </select>
  <span id="ow-country-error" style="color:#f87171;font-size:0.8rem;display:none;">Selecciona tu país</span>
</div>`;
  }
  function _restoreStep1() {
    const d = _stepData['1'] || {};
    if (d.businessName) { const el = document.getElementById('ow-business-name'); if (el) el.value = d.businessName; }
    if (d.country) { const el = document.getElementById('ow-country'); if (el) el.value = d.country; }
  }
  function _validateStep1() {
    const name = (document.getElementById('ow-business-name')?.value || '').trim();
    const country = document.getElementById('ow-country')?.value || '';
    let ok = true;
    const nameErr = document.getElementById('ow-name-error');
    const cErr = document.getElementById('ow-country-error');
    if (nameErr) nameErr.style.display = (name.length < 2 || name.length > 128) ? '' : 'none';
    if (cErr) cErr.style.display = !country ? '' : 'none';
    if (name.length < 2 || name.length > 128) ok = false;
    if (!country) ok = false;
    return ok;
  }
  function _collectStep1() { return { businessName: document.getElementById('ow-business-name')?.value.trim(), country: document.getElementById('ow-country')?.value }; }

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  const _bizTypes = [
    { value: 'ecommerce',    icon: '🛒', label: 'Tienda / E-commerce',       desc: 'Vende productos en línea',         example: 'Ej: Ropa, electrónicos, artesanías' },
    { value: 'appointments', icon: '📅', label: 'Citas / Agenda',             desc: 'Gestiona reservas y citas',        example: 'Ej: Salón de belleza, médico' },
    { value: 'services',     icon: '🔧', label: 'Servicios Profesionales',    desc: 'Ofrece servicios especializados',  example: 'Ej: Consultoría, diseño, legal' },
    { value: 'restaurant',   icon: '🍽️', label: 'Restaurante / Delivery',     desc: 'Pedidos y menú digital',           example: 'Ej: Restaurante, cafetería, comida rápida' },
    { value: 'general',      icon: '💼', label: 'Negocio General',            desc: 'Cualquier tipo de negocio',        example: 'Ej: Empresa, ONG, proyecto' },
  ];
  function _step2HTML() {
    const cards = _bizTypes.map(t => `
<label style="display:block;cursor:pointer;border:1px solid #374151;border-radius:10px;padding:1rem;margin-bottom:0.75rem;transition:border-color 0.15s;" class="biz-card" for="biz-${t.value}">
  <input type="radio" id="biz-${t.value}" name="biz-type" value="${t.value}" style="display:none;" onchange="document.querySelectorAll('.biz-card').forEach(c=>c.style.borderColor='#374151');this.closest('.biz-card').style.borderColor='#6366f1'">
  <div style="display:flex;align-items:center;gap:0.75rem;">
    <span style="font-size:1.5rem;">${t.icon}</span>
    <div>
      <div style="font-weight:600;color:#f9fafb;">${t.label}</div>
      <div style="font-size:0.8rem;color:#9ca3af;">${t.desc} · ${t.example}</div>
    </div>
  </div>
</label>`).join('');
    return `<h2 style="font-size:1.3rem;font-weight:700;margin:0 0 1.25rem;color:#f9fafb;">¿Qué tipo de negocio tienes?</h2>${cards}`;
  }
  function _restoreStep2() {
    const d = _stepData['2'] || {};
    const val = d.businessType || 'general';
    const radio = document.getElementById(`biz-${val}`);
    if (radio) { radio.checked = true; radio.closest('.biz-card').style.borderColor = '#6366f1'; }
  }
  function _collectStep2() { return { businessType: document.querySelector('input[name="biz-type"]:checked')?.value || 'general' }; }

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  function _step3HTML() {
    const plans = [
      { id: 'free',       label: 'Free',       price: '$0',   desc: '500 consultas/mes · 50 productos · 1 conector' },
      { id: 'starter',    label: 'Starter',    price: '$19',  desc: '3,000 consultas/mes · 500 productos · 2 API keys' },
      { id: 'business',   label: 'Business',   price: '$49',  desc: '15,000 consultas/mes · 5,000 productos · Analytics' },
      { id: 'enterprise', label: 'Enterprise', price: 'Custom', desc: 'Ilimitado · Soporte dedicado · Custom integrations' },
    ];
    const cards = plans.map(p => `
<label style="display:block;cursor:pointer;border:1px solid #374151;border-radius:10px;padding:1rem;margin-bottom:0.75rem;" class="plan-card" for="plan-${p.id}">
  <input type="radio" id="plan-${p.id}" name="plan-select" value="${p.id}" style="display:none;" onchange="document.querySelectorAll('.plan-card').forEach(c=>c.style.borderColor='#374151');this.closest('.plan-card').style.borderColor='#6366f1'">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-weight:600;color:#f9fafb;">${p.label}</div>
      <div style="font-size:0.8rem;color:#9ca3af;">${p.desc}</div>
    </div>
    <div style="font-weight:700;color:#6366f1;font-size:1.1rem;">${p.price}</div>
  </div>
</label>`).join('');

    const trialBtn = _trialUsed ? '' : `
<div id="trial-option" style="border:1px dashed #6366f1;border-radius:10px;padding:1rem;margin-bottom:0.75rem;cursor:pointer;text-align:center;" onclick="OnboardingWizard._selectTrial()">
  <div style="font-size:1.1rem;">🎉 Prueba Business <strong>14 días gratis</strong></div>
  <div style="font-size:0.8rem;color:#9ca3af;">Sin tarjeta de crédito requerida</div>
</div>`;

    return `<h2 style="font-size:1.3rem;font-weight:700;margin:0 0 1.25rem;color:#f9fafb;">Elige tu plan</h2>${trialBtn}${cards}`;
  }
  function _restoreStep3() {
    const d = _stepData['3'] || {};
    const val = _preselectedPlan || d.planId || 'free';
    const radio = document.getElementById(`plan-${val}`);
    if (radio) { radio.checked = true; radio.closest('.plan-card').style.borderColor = '#6366f1'; }
  }
  function _collectStep3() { return { planId: document.querySelector('input[name="plan-select"]:checked')?.value || 'free' }; }
  function _selectTrial() {
    document.querySelectorAll('.plan-card').forEach(c => c.style.borderColor = '#374151');
    document.querySelectorAll('input[name="plan-select"]').forEach(r => r.checked = false);
    const td = document.getElementById('trial-option');
    if (td) td.style.borderColor = '#6366f1';
    _stepData['3'] = { planId: 'trial' };
  }

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  function _getTemplate() {
    const biz = _stepData['2']?.businessType || 'general';
    const name = _stepData['1']?.businessName || 'mi negocio';
    if (biz === 'ecommerce') return `Soy el asistente de ${name}. Ayudo a los clientes a encontrar productos, ver precios y hacer pedidos. Soy amable, rápido y eficiente.`;
    if (biz === 'restaurant') return `Soy el asistente de ${name}. Muestro el menú, tomo pedidos y respondo preguntas sobre horarios y disponibilidad.`;
    if (biz === 'appointments') return `Soy el asistente de ${name}. Ayudo a agendar citas, informo disponibilidad y confirmo reservas.`;
    return `Soy el asistente de ${name}. Ayudo a los clientes con información, preguntas frecuentes y atención personalizada.`;
  }
  function _step4HTML() {
    return `
<h2 style="font-size:1.3rem;font-weight:700;margin:0 0 1rem;color:#f9fafb;">Configura tu Asistente</h2>
<div style="margin-bottom:1rem;">
  <label style="display:block;font-size:0.875rem;font-weight:500;margin-bottom:0.4rem;color:#d1d5db;">Manual operativo (cómo debe responder)</label>
  <textarea id="ow-manual" rows="5" oninput="document.getElementById('ow-greeting-preview').textContent='Vista previa: '+this.value.slice(0,80)+'...'" style="width:100%;background:#111827;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:0.75rem;font-size:0.875rem;box-sizing:border-box;resize:vertical;outline:none;"></textarea>
</div>
<div style="margin-bottom:1rem;">
  <label style="display:block;font-size:0.875rem;font-weight:500;margin-bottom:0.4rem;color:#d1d5db;">Idioma principal</label>
  <select id="ow-language" style="width:100%;padding:0.625rem 0.875rem;background:#111827;border:1px solid #374151;border-radius:8px;color:#f9fafb;font-size:0.9375rem;box-sizing:border-box;">
    <option value="es">Español</option>
    <option value="fr">Francés</option>
    <option value="en">Inglés</option>
    <option value="multi">Multilingüe</option>
  </select>
</div>
<div id="ow-greeting-preview" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:0.75rem;font-style:italic;color:#9ca3af;font-size:0.875rem;">Vista previa: tu manual aparecerá aquí...</div>`;
  }
  function _restoreStep4() {
    const d = _stepData['4'] || {};
    const manual = document.getElementById('ow-manual');
    const lang = document.getElementById('ow-language');
    if (manual) { manual.value = d.assistantManual || _getTemplate(); document.getElementById('ow-greeting-preview').textContent = 'Vista previa: ' + manual.value.slice(0, 80) + '...'; }
    if (lang && d.language) lang.value = d.language;
  }
  function _collectStep4() { return { assistantManual: document.getElementById('ow-manual')?.value || '', language: document.getElementById('ow-language')?.value || 'es' }; }

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  function _step5HTML() {
    let tenantId = 'TU_TENANT_ID';
    try { const u = Auth.getUser(); if (u?.tenantId) tenantId = u.tenantId; } catch (_) {}
    const code = `<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=${tenantId}"><\/script>`;
    return `
<h2 style="font-size:1.3rem;font-weight:700;margin:0 0 0.5rem;color:#f9fafb;">Instala el Widget</h2>
<p style="color:#9ca3af;margin:0 0 1rem;font-size:0.875rem;">Copia este código y pégalo antes del &lt;/body&gt; de tu sitio web:</p>
<pre id="ow-widget-code" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:1rem;font-size:0.75rem;overflow-x:auto;word-break:break-all;color:#a78bfa;margin:0 0 0.75rem;">${code}</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('ow-widget-code').textContent).then(()=>{this.textContent='¡Copiado! ✓';setTimeout(()=>this.textContent='Copiar código',2000)})" style="padding:0.5rem 1rem;background:transparent;border:1px solid #374151;border-radius:8px;color:#d1d5db;cursor:pointer;font-size:0.875rem;">Copiar código</button>
<p style="margin:1.5rem 0 0.5rem;font-weight:500;color:#d1d5db;">Vista previa del widget:</p>
<div style="display:flex;align-items:center;justify-content:center;padding:1.5rem;background:#111827;border-radius:8px;border:1px solid #374151;">
  <div style="width:56px;height:56px;background:#6366f1;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(99,102,241,0.5);">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
  </div>
</div>`;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  async function _next() {
    if (_currentStep === 1 && !_validateStep1()) return;
    const data = _collectCurrentStep();
    if (data) _stepData[String(_currentStep)] = data;

    // persist (fire-and-forget)
    fetch('/api/onboarding/step', {
      method: 'POST',
      headers: _apiHeaders(),
      body: JSON.stringify({ step: _currentStep, data: _stepData[String(_currentStep)] })
    }).catch(() => {});

    if (_currentStep === 5) {
      // Finish
      const planId = _stepData['3']?.planId || 'free';
      try {
        await fetch('/api/onboarding/complete', {
          method: 'POST',
          headers: _apiHeaders(),
          body: JSON.stringify({ planId })
        });
      } catch (_) {}
      hide();
      if (typeof AppRouter !== 'undefined') AppRouter.navigate('dashboard');
      if (typeof Dashboard !== 'undefined') Dashboard.loadDashboardData();
      return;
    }
    _renderStep(_currentStep + 1);
  }

  function _back() {
    if (_currentStep > 1) _renderStep(_currentStep - 1);
  }

  async function _skip() {
    if (!confirm('¿Saltar la configuración? Podrás completarla más tarde desde el panel.')) return;
    try {
      await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: _apiHeaders(),
        body: JSON.stringify({ planId: 'free' })
      });
    } catch (_) {}
    hide();
    if (typeof AppRouter !== 'undefined') AppRouter.navigate('dashboard');
    if (typeof Dashboard !== 'undefined') Dashboard.loadDashboardData();
  }

  function _collectCurrentStep() {
    switch (_currentStep) {
      case 1: return _collectStep1();
      case 2: return _collectStep2();
      case 3: return _collectStep3();
      case 4: return _collectStep4();
      case 5: return { widgetCodeCopied: false };
      default: return null;
    }
  }

  return { init, show, hide, _next, _back, _skip, _selectTrial };
})();
