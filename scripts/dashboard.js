/**
 * Eteba Chat — Dashboard Module
 * Maneja la lógica del panel de administración
 */
const Dashboard = (() => {
  const API_BASE = window.location.origin;
  let integrationsGridHTML = '';

  function init() {
    initSidebarTabs();
    initConfigForm();
    initCatalogActions();
    initApiKeyActions();

    // Guardar estructura inicial de integraciones
    const tabInt = document.getElementById('tab-integrations');
    if (tabInt) {
      integrationsGridHTML = tabInt.innerHTML;
    }
  }

  /** Cargar datos cuando el usuario entra al dashboard */
  function loadDashboardData() {
    const user = Auth.getUser();
    if (!user) return;

    // Si es Super Admin, cargar el panel de admin global
    if (user.role === 'admin') {
      initAdminDashboard(user);
      return;
    }

    const tenantId = user.tenantId || user.id;

    // Personalizar saludo
    const welcomeEl = document.getElementById('dash-welcome');
    if (welcomeEl) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
      const name = user.name ? user.name.split(' ')[0] : '';
      welcomeEl.textContent = `${greeting}${name ? ', ' + name : ''}`;
    }

    loadMetrics(tenantId);
    loadRecentOrders(tenantId);
    loadCatalog(tenantId);
    displayTenantInfo();
    initQuickActions();
    loadPlanBadge(tenantId);
    loadUsageSection(tenantId);
  }

  /** Quick action buttons */
  function initQuickActions() {
    document.querySelectorAll('.dash-quick-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // Activate sidebar tab
        document.querySelectorAll('.sidebar__item').forEach(i => i.classList.remove('sidebar__item--active'));
        document.querySelector(`.sidebar__item[data-tab="${tab}"]`)?.classList.add('sidebar__item--active');
        document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`)?.classList.add('active');
      });
    });

    // Test chat button → navigate to explore
    document.getElementById('btn-test-chat')?.addEventListener('click', () => {
      AppRouter.navigate('explore');
    });
  }

  /** Navegación entre tabs del dashboard (tenant normal) */
  function initSidebarTabs() {
    document.querySelectorAll('[data-tab]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = item.dataset.tab;
        if (!tabName) return;

        document.querySelectorAll('[data-tab]').forEach(i => i.classList.remove('sidebar__item--active'));
        item.classList.add('sidebar__item--active');

        document.querySelectorAll('.dash-tab').forEach(tab => { tab.classList.remove('active'); tab.classList.add('hidden'); });
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) { targetTab.classList.remove('hidden'); targetTab.classList.add('active'); }

        // Load data for specific tabs on activation
        const user = Auth.getUser();
        if (user) {
          const tenantId = user.tenantId || user.id;
          if (tabName === 'conversations') {
            loadConversations(tenantId);
          } else if (tabName === 'orders') {
            loadRecentOrders(tenantId);
          } else if (tabName === 'overview') {
            loadQueryMetrics(tenantId);
          } else if (tabName === 'billing') {
            loadBillingPortal();
          } else if (tabName === 'integrations') {
            const tabInt = document.getElementById('tab-integrations');
            if (tabInt && integrationsGridHTML) {
              tabInt.innerHTML = integrationsGridHTML;
            }
            initIntegrationsTab(tenantId);
          }
        }
      });
    });
  }

  /** Navegación entre tabs del Super Admin */
  function initSidebarAdminTabs() {
    document.querySelectorAll('[data-admin-tab]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = item.dataset.adminTab;
        if (!tabName) return;

        document.querySelectorAll('[data-admin-tab]').forEach(i => i.classList.remove('sidebar__item--active'));
        item.classList.add('sidebar__item--active');

        document.querySelectorAll('.dash-tab').forEach(tab => { tab.classList.remove('active'); tab.classList.add('hidden'); });
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) { targetTab.classList.remove('hidden'); targetTab.classList.add('active'); }

        // Load data for the activated admin tab
        if (tabName === 'admin-overview') loadAdminStats();
        else if (tabName === 'admin-tenants') loadAdminTenants();
        else if (tabName === 'admin-subscriptions') loadAdminSubscriptions();
        else if (tabName === 'admin-usage') loadAdminUsage();
        else if (tabName === 'admin-plans') loadAdminPlans();
      });
    });
  }

  // ─── SUPER ADMIN FUNCTIONS ──────────────────────────────────────────────────

  /** Inicializar el dashboard del Super Admin */
  function initAdminDashboard(user) {
    // Swap sidebar: hide tenant menu, show admin menu
    const tenantMenu = document.getElementById('sidebar-tenant-menu');
    const adminMenu  = document.getElementById('sidebar-admin-menu');
    if (tenantMenu) tenantMenu.classList.add('hidden');
    if (adminMenu)  adminMenu.classList.remove('hidden');

    // Hide all normal tabs, show the admin overview tab
    document.querySelectorAll('.dash-tab').forEach(t => { t.classList.remove('active'); t.classList.add('hidden'); });
    const adminOverview = document.getElementById('tab-admin-overview');
    if (adminOverview) { adminOverview.classList.remove('hidden'); adminOverview.classList.add('active'); }

    initSidebarAdminTabs();
    loadAdminStats();
  }

  /** Helper: get auth token for admin API calls */
  function getAdminToken() {
    return localStorage.getItem('eteba_token') || '';
  }

  /** GET /api/admin/stats */
  async function loadAdminStats() {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('admin-total-companies', data.total_companies?.toLocaleString() ?? '—');
      set('admin-total-users',     data.total_users?.toLocaleString() ?? '—');
      set('admin-mrr',             data.mrr_estimated > 0 ? `$${data.mrr_estimated.toLocaleString()}` : '$0');
      set('admin-total-queries',   data.total_queries_this_month?.toLocaleString() ?? '—');
      set('admin-new-companies',   data.new_companies_30d?.toLocaleString() ?? '—');

      // Render plan breakdown
      const breakdownEl = document.getElementById('admin-plan-breakdown');
      if (breakdownEl && data.plan_breakdown) {
        breakdownEl.innerHTML = data.plan_breakdown.map(p =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span><span class="plan-badge plan-badge--${p.plan_id}">${p.plan_id}</span> <span style="color:var(--color-text-muted);font-size:0.8rem;margin-left:6px;">${p.status}</span></span>
            <strong style="font-size:1rem;">${p.count} empresa${p.count != 1 ? 's' : ''}</strong>
          </div>`
        ).join('');
      }
    } catch (err) {
      console.error('Admin stats error:', err);
    }
  }

  /** GET /api/admin/tenants */
  async function loadAdminTenants(search = '') {
    const tableEl = document.getElementById('admin-tenants-table');
    if (!tableEl) return;
    tableEl.innerHTML = '<p class="text-muted" style="padding:1.5rem;">Cargando...</p>';

    try {
      const url = `${API_BASE}/api/admin/tenants${search ? '?search=' + encodeURIComponent(search) : ''}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();

      if (!data.tenants?.length) {
        tableEl.innerHTML = '<p class="text-muted" style="padding:1.5rem;">No hay empresas registradas aún.</p>';
        return;
      }

      const formatDate = d => d ? new Date(d).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' }) : '—';
      tableEl.innerHTML = `
        <table class="admin-table">
          <thead><tr>
            <th>Empresa</th><th>Owner</th><th>Plan</th><th>Estado</th><th>Consultas mes</th><th>Registro</th><th>Cambiar Plan / Estado</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${data.tenants.map(t => `
              <tr>
                <td><strong>${t.company_name || '—'}</strong></td>
                <td><div style="font-size:0.8rem;">${t.owner_name || ''}</div><div style="font-size:0.75rem;color:var(--color-text-muted);">${t.owner_email || ''}</div></td>
                <td><span class="plan-badge plan-badge--${t.plan_id || 'free'}">${t.plan_id || 'free'}</span></td>
                <td><span class="plan-badge plan-badge--${t.subscription_status === 'active' ? 'business' : t.subscription_status === 'trialing' ? 'trialing' : 'free'}">${t.subscription_status || '—'}</span></td>
                <td style="text-align:center;"><strong>${Number(t.queries_this_month).toLocaleString()}</strong></td>
                <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDate(t.created_at)}</td>
                <td>
                  <div style="display:flex;flex-direction:column;gap:4px;">
                    <select class="admin-plan-select" data-tenant-id="${t.tenant_id}" onchange="Dashboard.updateTenantSubscription('${t.tenant_id}', this.value, this.nextElementSibling.value)">
                      ${['free','starter','business','enterprise'].map(p =>
                        `<option value="${p}" ${t.plan_id === p ? 'selected' : ''}>Plan: ${p}</option>`
                      ).join('')}
                    </select>
                    <select class="admin-plan-select" onchange="Dashboard.updateTenantSubscription('${t.tenant_id}', this.previousElementSibling.value, this.value)">
                      ${['active','cancelled','trialing','past_due'].map(st =>
                        `<option value="${st}" ${t.subscription_status === st ? 'selected' : ''}>Estado: ${st}</option>`
                      ).join('')}
                    </select>
                  </div>
                </td>
                <td>
                  <button class="btn btn--outline btn--sm" style="border-color:rgba(239,68,68,0.4);color:#f87171;" onclick="Dashboard.resetTenantUsage('${t.tenant_id}', '${t.company_name?.replace(/'/g, "\\'")}')">
                    Restablecer Uso
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="padding:12px 16px;font-size:0.8rem;color:var(--color-text-muted);border-top:1px solid var(--color-border);">
          ${data.total} empresa${data.total !== 1 ? 's' : ''} en total
        </div>`;

      // Attach search debounce
      const searchInput = document.getElementById('admin-tenant-search');
      if (searchInput && !searchInput.dataset.initialized) {
        searchInput.dataset.initialized = 'true';
        let debounce;
        searchInput.addEventListener('input', () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => loadAdminTenants(searchInput.value.trim()), 350);
        });
      }
    } catch (err) {
      tableEl.innerHTML = `<p class="text-muted" style="padding:1.5rem;">Error: ${err.message}</p>`;
    }
  }

  /** GET /api/admin/plans */
  async function loadAdminPlans() {
    const gridEl = document.getElementById('admin-plans-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '<p class="text-muted" style="padding:1rem;">Cargando planes...</p>';

    try {
      const resp = await fetch(`${API_BASE}/api/admin/plans`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();

      if (!data.plans?.length) {
        gridEl.innerHTML = '<p class="text-muted" style="padding:1rem;">No se encontraron planes configurados.</p>';
        return;
      }

      const fmt = v => v === null || v === undefined ? 'Ilimitado' : v.toLocaleString();
      
      gridEl.innerHTML = '';
      data.plans.forEach(p => {
        const card = document.createElement('div');
        card.className = 'admin-plan-card';
        card.innerHTML = `
          <div class="admin-plan-card__name" style="display:flex;justify-content:between;align-items:center;width:100%;">
            <span class="plan-badge plan-badge--${p.id}">${p.id}</span>
            <button class="btn btn--outline btn--sm btn-edit-plan" style="margin-left:auto;font-size:0.75rem;padding:4px 8px;">Editar</button>
          </div>
          <div class="admin-plan-card__stat" style="margin-top:0.75rem;"><span>Consultas/mes</span><span>${fmt(p.monthly_query_limit)}</span></div>
          <div class="admin-plan-card__stat"><span>Catálogo Productos</span><span>${fmt(p.product_limit)}</span></div>
          <div class="admin-plan-card__stat"><span>Max Conectores</span><span>${fmt(p.connector_limit)}</span></div>
          <div class="admin-plan-card__stat"><span>Max API Keys</span><span>${fmt(p.api_key_limit)}</span></div>
          <div class="admin-plan-card__stat"><span>Precio Mensual</span><span>$${p.price_monthly_usd} USD</span></div>
          <div class="admin-plan-card__stat"><span>Precio Anual</span><span>$${p.price_yearly_usd} USD</span></div>
        `;
        card.querySelector('.btn-edit-plan').addEventListener('click', () => {
          showEditPlanModal(p);
        });
        gridEl.appendChild(card);
      });
    } catch (err) {
      gridEl.innerHTML = `<p class="text-muted" style="padding:1rem;">Error: ${err.message}</p>`;
    }
  }

  /** Mostrar modal para editar un plan */
  function showEditPlanModal(plan) {
    const modalHTML = `
      <div class="modal-backdrop" id="edit-plan-dialog" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:9999;">
        <div class="modal" style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;width:90%;max-width:500px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);animation:slideUp 0.2s ease-out;">
          <div class="modal__header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--color-border);">
            <h3 style="margin:0;font-size:1.15rem;font-weight:700;">Editar Plan: <span style="text-transform: capitalize;color:#a78bfa;">${plan.id}</span></h3>
            <button class="modal__close" id="edit-plan-close" style="background:none;border:none;color:var(--color-text-muted);font-size:1.5rem;cursor:pointer;">&times;</button>
          </div>
          <div class="modal__body" style="padding:20px;max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;">
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Límite de Consultas/Mes (vacío para ilimitado)</label>
              <input type="number" class="input" id="plan-query-limit" value="${plan.monthly_query_limit ?? ''}" style="width:100%;">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Límite de Productos en Catálogo (vacío para ilimitado)</label>
              <input type="number" class="input" id="plan-product-limit" value="${plan.product_limit ?? ''}" style="width:100%;">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Límite de Conectores</label>
              <input type="number" class="input" id="plan-connector-limit" value="${plan.connector_limit ?? 1}" style="width:100%;">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Límite de API Keys (vacío para ilimitado)</label>
              <input type="number" class="input" id="plan-api-limit" value="${plan.api_key_limit ?? ''}" style="width:100%;">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Precio Mensual (USD)</label>
              <input type="number" step="0.01" class="input" id="plan-price-monthly" value="${plan.price_monthly_usd ?? 0}" style="width:100%;">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:6px;">Precio Anual (USD)</label>
              <input type="number" step="0.01" class="input" id="plan-price-yearly" value="${plan.price_yearly_usd ?? 0}" style="width:100%;">
            </div>
          </div>
          <div class="modal__footer" style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid var(--color-border);background:rgba(255,255,255,0.01);">
            <button class="btn btn--ghost" id="edit-plan-cancel">Cancelar</button>
            <button class="btn btn--primary" id="edit-plan-save">Guardar Cambios</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('edit-plan-dialog');

    function close() {
      modal.remove();
    }

    document.getElementById('edit-plan-close').addEventListener('click', close);
    document.getElementById('edit-plan-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    document.getElementById('edit-plan-save').addEventListener('click', async () => {
      const qLimit = document.getElementById('plan-query-limit').value.trim();
      const pLimit = document.getElementById('plan-product-limit').value.trim();
      const cLimit = document.getElementById('plan-connector-limit').value.trim();
      const aLimit = document.getElementById('plan-api-limit').value.trim();
      const pMonthly = document.getElementById('plan-price-monthly').value.trim();
      const pYearly = document.getElementById('plan-price-yearly').value.trim();

      try {
        const resp = await fetch(`${API_BASE}/api/admin/plan/${plan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
          body: JSON.stringify({
            monthly_query_limit: qLimit === '' ? null : parseInt(qLimit),
            product_limit: pLimit === '' ? null : parseInt(pLimit),
            connector_limit: parseInt(cLimit) || 1,
            api_key_limit: aLimit === '' ? null : parseInt(aLimit),
            price_monthly_usd: parseFloat(pMonthly) || 0,
            price_yearly_usd: parseFloat(pYearly) || 0
          })
        });

        if (!resp.ok) throw new Error(await resp.text());
        showToast('Plan actualizado con éxito.', 'success');
        close();
        await loadAdminPlans();
      } catch (err) {
        alert('Error al guardar cambios: ' + err.message);
      }
    });
  }

  /** Actualizar suscripción completa (plan y/o estado) */
  async function updateTenantSubscription(tenantId, newPlan, newStatus) {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/tenant/${tenantId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ plan_id: newPlan, status: newStatus })
      });
      if (!resp.ok) throw new Error(await resp.text());
      showToast('Suscripción actualizada correctamente.', 'success');
      await loadAdminTenants(document.getElementById('admin-tenant-search')?.value || '');
    } catch (err) {
      alert('Error al cambiar plan: ' + err.message);
    }
  }

  /** Restablecer consultas consumidas de un tenant */
  async function resetTenantUsage(tenantId, companyName) {
    if (!confirm(`¿Restablecer el consumo de consultas a 0 para ${companyName} este mes?`)) return;
    try {
      const resp = await fetch(`${API_BASE}/api/admin/tenant/${tenantId}/reset-usage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      });
      if (!resp.ok) throw new Error(await resp.text());
      showToast('Consumo restablecido a 0.', 'success');
      await loadAdminTenants(document.getElementById('admin-tenant-search')?.value || '');
    } catch (err) {
      alert('Error al restablecer consumo: ' + err.message);
    }
  }

  /** Inicializar el botón de configurar webhooks en la grilla de integraciones */
  function initIntegrationsTab(tenantId) {
    const btnConfigure = document.getElementById('btn-configure-webhooks');
    if (btnConfigure) {
      btnConfigure.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof WebhooksTab !== 'undefined') {
          WebhooksTab.init(tenantId);
        }
      });
    }
  }

  /** Cargar métricas del overview */
  async function loadMetrics(tenantId) {
    try {
      // Contar pedidos
      const ordersResp = await fetch(`${API_BASE}/api/orders?tenantId=${tenantId}`);
      if (ordersResp.ok) {
        const ordersData = await ordersResp.json();
        const orderCount = ordersData.orders?.length || 0;
        const valOrders = document.getElementById('val-orders');
        if (valOrders) valOrders.textContent = orderCount.toString();
      }

      // Contar productos
      const catalogResp = await fetch(`${API_BASE}/api/catalog?tenantId=${tenantId}`);
      if (catalogResp.ok) {
        const catalogData = await catalogResp.json();
        const productCount = catalogData.products?.length || 0;
        const valProducts = document.getElementById('val-products');
        if (valProducts) valProducts.textContent = productCount.toString();
      }

      // Queries — loaded via dedicated function
      loadQueryMetrics(tenantId);
    } catch (err) {
      // Silently fail — metrics are non-critical
    }
  }

  /** Cargar métricas de queries */
  async function loadQueryMetrics(tenantId) {
    const valQueries = document.getElementById('val-queries');
    if (!valQueries) return;

    try {
      const resp = await fetch(`${API_BASE}/api/metrics/queries?tenantId=${tenantId}`);
      if (!resp.ok) throw new Error('Fetch failed');
      const data = await resp.json();
      valQueries.textContent = (data.count || 0).toString();
    } catch (err) {
      valQueries.textContent = '0';
    }
  }

  /** Cargar todos los pedidos */
  async function loadRecentOrders(tenantId) {
    const container = document.getElementById('recent-orders');
    if (!container) return;

    try {
      const resp = await fetch(`${API_BASE}/api/orders?tenantId=${tenantId}`);
      if (!resp.ok) throw new Error('No disponible');
      const data = await resp.json();

      if (!data.orders || data.orders.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay pedidos aún. Cuando tus clientes hagan pedidos por el chat, aparecerán aquí.</p>';
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cliente</th>
              <th>Ciudad</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${data.orders.map(order => `
              <tr>
                <td>${order.producto_nombre}</td>
                <td>${order.cliente_nombre}</td>
                <td>${order.ciudad_entrega}</td>
                <td>${formatDate(order.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = '<p class="text-muted text-error">Error al cargar los pedidos</p>';
    }
  }

  /** Cargar conversaciones (consultas realizadas al asistente) */
  async function loadConversations(tenantId) {
    const container = document.getElementById('conversations-list');
    if (!container) return;

    container.innerHTML = '<p class="text-muted">Cargando conversaciones...</p>';

    try {
      const resp = await fetch(`${API_BASE}/api/conversations?tenantId=${tenantId}`);
      if (!resp.ok) throw new Error('No disponible');
      const data = await resp.json();

      if (!data.conversations || data.conversations.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay conversaciones registradas aún</p>';
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Consulta</th>
              <th>Fecha</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            ${data.conversations.map(conv => `
              <tr>
                <td>${escapeHTML(conv.query_text)}</td>
                <td>${new Date(conv.created_at).toLocaleString('es-ES')}</td>
                <td>${conv.user_id ? escapeHTML(conv.user_id) : 'Anónimo'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = '<p class="text-muted">Error al cargar conversaciones. Intenta de nuevo más tarde.</p>';
    }
  }

  /** Escapar HTML para prevenir XSS */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Cargar catálogo de productos/servicios */
  async function loadCatalog(tenantId) {
    const container = document.getElementById('catalog-table');
    if (!container) return;

    try {
      const resp = await fetch(`${API_BASE}/api/catalog?tenantId=${tenantId}`);
      if (!resp.ok) throw new Error('No disponible');
      const data = await resp.json();

      if (!data.products || data.products.length === 0) {
        container.innerHTML = '<p class="text-muted">Tu catálogo está vacío. Agrega productos o servicios para que tu asistente pueda ofrecerlos.</p>';
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${data.products.map(p => `
              <tr>
                <td>${p.name || p.nombre}</td>
                <td>${formatPrice(p.price || p.precio)} CFA</td>
                <td>${p.stock || p.cantidad || '—'}</td>
                <td>
                  <button class="btn btn--ghost btn--sm" data-edit-product="${p.id}"
                    data-product-name="${(p.name || p.nombre || '').replace(/"/g, '&quot;')}"
                    data-product-description="${(p.description || p.descripcion || '').replace(/"/g, '&quot;')}"
                    data-product-price="${p.price || p.precio || 0}"
                    data-product-stock="${p.stock || p.cantidad || 0}"
                    data-product-image="${(p.image_url || p.imagen || '').replace(/"/g, '&quot;')}">Editar</button>
                  <button class="btn btn--ghost btn--sm" data-delete-product="${p.id}" style="color:var(--color-error, #e53e3e);">Eliminar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      // Wire edit buttons to open edit modal with product data
      container.querySelectorAll('[data-edit-product]').forEach(btn => {
        btn.addEventListener('click', () => {
          const product = {
            id: btn.dataset.editProduct,
            name: btn.dataset.productName,
            description: btn.dataset.productDescription,
            price: parseFloat(btn.dataset.productPrice) || 0,
            stock: parseInt(btn.dataset.productStock) || 0,
            image_url: btn.dataset.productImage
          };
          showProductModal(product);
        });
      });

      // Wire delete buttons to confirm and delete product
      container.querySelectorAll('[data-delete-product]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const productId = btn.dataset.deleteProduct;
          const confirmed = await showConfirmDialog('¿Estás seguro de eliminar este producto?');
          if (!confirmed) return;

          try {
            const resp = await fetch(`${API_BASE}/api/catalog/${productId}?tenantId=${tenantId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${Auth.getAccessToken()}` }
            });

            if (resp.ok) {
              showToast('Producto eliminado', 'success');
              loadCatalog(tenantId);
            } else {
              const errorData = await resp.json().catch(() => ({}));
              showToast(errorData.error || 'Error al eliminar producto', 'error');
            }
          } catch (err) {
            showToast('Error de conexión', 'error');
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<p class="text-muted">El catálogo se cargará cuando la conexión esté activa.</p>';
    }
  }

  /** Guardar configuración del asistente */
  function initConfigForm() {
    document.getElementById('btn-save-config')?.addEventListener('click', async () => {
      const name = document.getElementById('config-name')?.value;
      const manual = document.getElementById('config-manual')?.value;
      const type = document.getElementById('config-type')?.value;
      const user = Auth.getUser();

      if (!user) {
        alert('Debes iniciar sesión para guardar la configuración.');
        return;
      }

      const tenantId = user.tenantId || user.id;

      const btn = document.getElementById('btn-save-config');
      btn.textContent = 'Guardando...';
      btn.disabled = true;

      try {
        const resp = await fetch(`${API_BASE}/api/config`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Auth.getAccessToken()}`
          },
          body: JSON.stringify({ tenantId: tenantId, name, manual, type })
        });

        if (resp.ok) {
          showToast('Configuración guardada correctamente', 'success');
        } else {
          showToast('Error al guardar. Intenta de nuevo.', 'error');
        }
      } catch (err) {
        showToast('Error de conexión', 'error');
      } finally {
        btn.textContent = 'Guardar Configuración';
        btn.disabled = false;
      }
    });
  }

  /** Acciones del catálogo */
  function initCatalogActions() {
    document.getElementById('btn-add-product')?.addEventListener('click', () => {
      showProductModal();
    });

    document.getElementById('btn-import-catalog')?.addEventListener('click', () => {
      const user = Auth.getUser();
      if (!user) {
        showToast('Debes iniciar sesión para importar productos', 'error');
        return;
      }
      const tenantId = user.tenantId || user.id;
      handleCSVImport(tenantId);
    });
  }

  /** Importar productos desde archivo CSV */
  async function handleCSVImport(tenantId) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.remove();

      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const csvText = e.target.result;
        const { valid, skipped } = parseCSV(csvText);

        // Si el lote excede 500 productos válidos (Req 5.4)
        if (valid.length > 500) {
          showToast('Máximo 500 productos por importación', 'error');
          return;
        }

        // Si todos los productos fueron omitidos (Req 5.3)
        if (valid.length === 0) {
          if (skipped > 0) {
            showToast('No se encontraron productos válidos en el archivo', 'error');
          } else {
            showToast('El archivo está vacío o el formato no es válido', 'error');
          }
          return;
        }

        try {
          const resp = await fetch(`${API_BASE}/api/catalog/bulk`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Auth.getAccessToken()}`
            },
            body: JSON.stringify({ tenantId, products: valid })
          });

          if (resp.ok) {
            loadCatalog(tenantId);
            const data = await resp.json();
            
            // Mostrar Toast con conteo detallado (Req 4.2, 4.3)
            let msg = `Importación: ${data.created || 0} creados, ${data.updated || 0} actualizados, ${data.unchanged || 0} sin cambios`;
            if (skipped > 0) {
              msg += `. Omitidos por validación: ${skipped}`;
            }
            showToast(msg, 'success');
          } else {
            const errorData = await resp.json().catch(() => ({}));
            showToast(errorData.error || 'Error al importar productos', 'error');
          }
        } catch (err) {
          showToast('Error de conexión al importar', 'error');
        }
      };

      reader.onerror = () => {
        showToast('El formato del archivo no es válido', 'error');
      };

      reader.readAsText(file);
    });

    fileInput.click();
  }

  /** Wire API Key generation button */
  function initApiKeyActions() {
    document.getElementById('btn-generate-key')?.addEventListener('click', () => {
      const user = Auth.getUser();
      if (!user) {
        showToast('Debes iniciar sesión para generar una API Key', 'error');
        return;
      }
      const tenantId = user.tenantId || user.id;
      generateApiKey(tenantId);
    });
  }

  /** Reusable confirmation dialog — returns Promise<boolean> */
  function showConfirmDialog(message) {
    return new Promise((resolve) => {
      const modalHTML = `
        <div class="modal-overlay" id="confirm-dialog">
          <div class="modal" style="max-width:380px;">
            <div class="modal__header">
              <h3>Confirmar acción</h3>
              <button class="modal__close" id="confirm-close">&times;</button>
            </div>
            <div class="modal__body">
              <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);">${message}</p>
            </div>
            <div class="modal__footer">
              <button class="btn btn--ghost" id="confirm-cancel">Cancelar</button>
              <button class="btn btn--primary" id="confirm-accept">Confirmar</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);
      const modal = document.getElementById('confirm-dialog');

      function cleanup(result) {
        modal.remove();
        resolve(result);
      }

      document.getElementById('confirm-accept').addEventListener('click', () => cleanup(true));
      document.getElementById('confirm-cancel').addEventListener('click', () => cleanup(false));
      document.getElementById('confirm-close').addEventListener('click', () => cleanup(false));
      modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(false); });
    });
  }

  /** Modal para agregar producto */
  function showProductModal(product = null) {
    const isEdit = product !== null;
    const modalHTML = `
      <div class="modal-overlay" id="product-modal">
        <div class="modal">
          <div class="modal__header">
            <h3>${isEdit ? 'Editar' : 'Agregar'} Producto/Servicio</h3>
            <button class="modal__close" id="modal-close">&times;</button>
          </div>
          <div class="modal__body">
            <div class="form-group">
              <label class="form-label">Nombre</label>
              <input type="text" class="input" id="product-name" value="${product?.name || ''}" placeholder="Ej: Zapatilla Nike Air Max">
            </div>
            <div class="form-group">
              <label class="form-label">Descripción</label>
              <textarea class="input input--textarea" rows="3" id="product-desc" placeholder="Descripción breve del producto o servicio">${product?.description || ''}</textarea>
            </div>
            <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
              <div>
                <label class="form-label">Precio (CFA)</label>
                <input type="number" class="input" id="product-price" value="${product?.price || ''}" placeholder="0">
              </div>
              <div>
                <label class="form-label">Stock</label>
                <input type="number" class="input" id="product-stock" value="${product?.stock || ''}" placeholder="0">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">URL de imagen (opcional)</label>
              <input type="text" class="input" id="product-image" value="${product?.image_url || ''}" placeholder="https://...">
            </div>
          </div>
          <div class="modal__footer">
            <button class="btn btn--ghost" id="modal-cancel">Cancelar</button>
            <button class="btn btn--primary" id="modal-save">${isEdit ? 'Actualizar' : 'Agregar'}</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('product-modal');
    document.getElementById('modal-close').addEventListener('click', () => modal.remove());
    document.getElementById('modal-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('modal-save').addEventListener('click', async () => {
      const name = document.getElementById('product-name').value.trim();
      const description = document.getElementById('product-desc').value.trim();
      const price = parseFloat(document.getElementById('product-price').value) || 0;
      const stock = parseInt(document.getElementById('product-stock').value) || 0;
      const image_url = document.getElementById('product-image').value.trim();
      const user = Auth.getUser();

      if (!name) {
        alert('El nombre es obligatorio');
        return;
      }

      const tenantId = user.tenantId || user.id;

      try {
        const url = isEdit ? `${API_BASE}/api/catalog/${product.id}` : `${API_BASE}/api/catalog`;
        const method = isEdit ? 'PUT' : 'POST';

        const resp = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Auth.getAccessToken()}`
          },
          body: JSON.stringify({ tenantId, name, description, price, stock, image_url })
        });

        if (resp.ok) {
          showToast(isEdit ? 'Producto actualizado correctamente' : 'Producto agregado correctamente', 'success');
          modal.remove();
          loadCatalog(tenantId);
        } else {
          const errorData = await resp.json().catch(() => ({}));
          showToast(errorData.error || (isEdit ? 'Error al actualizar producto' : 'Error al guardar producto'), 'error');
        }
      } catch (err) {
        showToast('Error de conexión', 'error');
      }
    });
  }

  /** Generar API Key para el tenant */
  async function generateApiKey(tenantId) {
    try {
      const resp = await fetch(`${API_BASE}/api/keys/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getAccessToken()}`
        },
        body: JSON.stringify({ tenantId })
      });

      const data = await resp.json();

      if (resp.ok && data.success) {
        // Display the generated key in the API Keys section
        const container = document.querySelector('#tab-api-keys .api-keys__section');
        if (container) {
          // Check if a generated-key card already exists, remove it to show the new one
          const existingCard = document.getElementById('generated-key-card');
          if (existingCard) existingCard.remove();

          const keyCard = document.createElement('div');
          keyCard.className = 'card';
          keyCard.id = 'generated-key-card';
          keyCard.innerHTML = `
            <h3 class="card__title">Tu API Key</h3>
            <div class="api-key__display">
              <code id="display-api-key">${escapeHTML(data.key)}</code>
              <button class="btn btn--ghost btn--sm" id="btn-copy-api-key">Copiar</button>
            </div>
            <p class="text-muted" style="margin-top:0.5rem;font-size:var(--font-size-xs, 0.75rem);">Guarda esta clave en un lugar seguro. No se mostrará de nuevo.</p>
          `;
          container.appendChild(keyCard);

          // Wire copy button
          document.getElementById('btn-copy-api-key').addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(data.key);
              showToast('API Key copiada al portapapeles', 'success');
            } catch (err) {
              showToast('No se pudo copiar la clave', 'error');
            }
          });
        }

        showToast('API Key generada correctamente', 'success');
      } else {
        showToast(data.error || 'Error al generar API Key', 'error');
      }
    } catch (err) {
      showToast('Error de conexión al generar API Key', 'error');
    }
  }

  /** Mostrar el tenant ID del usuario en la sección API Keys */
  function displayTenantInfo() {
    const user = Auth.getUser();
    if (!user) return;

    const tenantId = user.tenantId || user.id;

    const tenantDisplay = document.getElementById('display-tenant-id');
    if (tenantDisplay) {
      tenantDisplay.textContent = tenantId;
    }

    const widgetCode = document.getElementById('widget-code');
    if (widgetCode) {
      widgetCode.textContent = `<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=${tenantId}"><\/script>`;
    }
  }

  /**
   * Parses a CSV string into an array of product objects.
   * Handles quoted fields (fields wrapped in double quotes may contain commas).
   * @param {string} csvText - Raw CSV file content
   * @returns {{ valid: Array<{name: string, description: string, price: number, stock: number, image_url: string}>, skipped: number }}
   */
  function parseCSV(csvText) {
    const result = { valid: [], skipped: 0 };
    if (!csvText || typeof csvText !== 'string') return result;

    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return result; // Need at least header + 1 data row

    // Parse a single CSV line respecting quoted fields
    function parseLine(line) {
      const fields = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            // Check for escaped quote (double quote "")
            if (i + 1 < line.length && line[i + 1] === '"') {
              current += '"';
              i++; // skip next quote
            } else {
              inQuotes = false;
            }
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ',') {
            fields.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
      }
      fields.push(current.trim());
      return fields;
    }

    // Parse header to identify column positions
    const headerFields = parseLine(lines[0]);
    const columnMap = {};
    const expectedColumns = ['name', 'description', 'price', 'stock', 'image_url'];
    headerFields.forEach((col, idx) => {
      const normalized = col.toLowerCase().trim();
      if (expectedColumns.includes(normalized)) {
        columnMap[normalized] = idx;
      }
    });

    // Process data rows
    for (let i = 1; i < lines.length; i++) {
      const fields = parseLine(lines[i]);

      const name = (columnMap.name !== undefined && fields[columnMap.name]) ? fields[columnMap.name] : '';
      const description = (columnMap.description !== undefined && fields[columnMap.description]) ? fields[columnMap.description] : '';
      const priceRaw = (columnMap.price !== undefined && fields[columnMap.price]) ? fields[columnMap.price] : '';
      const stockRaw = (columnMap.stock !== undefined && fields[columnMap.stock]) ? fields[columnMap.stock] : '0';
      const image_url = (columnMap.image_url !== undefined && fields[columnMap.image_url]) ? fields[columnMap.image_url] : '';

      // Validate: name must be non-empty, price must be numeric
      if (!name || name.trim() === '') {
        result.skipped++;
        continue;
      }

      const price = parseFloat(priceRaw);
      if (isNaN(price)) {
        result.skipped++;
        continue;
      }

      result.valid.push({
        name: name,
        description: description,
        price: price,
        stock: parseInt(stockRaw) || 0,
        image_url: image_url
      });
    }

    return result;
  }

  /** Toast notifications */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /** Utilidades de formato */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatPrice(price) {
    return parseFloat(price || 0).toLocaleString('es-ES');
  }

  // ── Plan Badge & Usage ──────────────────────────────────────────────────────

  /** Load Plan Badge in dashboard header and trial countdown (Req 8.1, 4.4, 8.6) */
  async function loadPlanBadge(tenantId) {
    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/subscription`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const plan = data.plan || {};
      const sub = data.subscription || {};
      const planId = plan.id || sub.plan_id || 'free';

      // Inject badge — prefer the dedicated container in the header, fall back to
      // prepending into .dash-header-actions for resilience
      let badge = document.getElementById('plan-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'plan-badge';
        const container = document.getElementById('plan-badge-container');
        if (container) {
          container.appendChild(badge);
        } else {
          const headerActions = document.querySelector('.dash-header-actions');
          if (headerActions) headerActions.prepend(badge);
        }
      }
      const colorMap = {
        free:       'plan-badge--free',
        starter:    'plan-badge--starter',
        business:   'plan-badge--business',
        enterprise: 'plan-badge--enterprise'
      };
      badge.className = `plan-badge ${colorMap[planId] || 'plan-badge--free'}`;
      badge.textContent = (plan.name || planId).toUpperCase();

      // Trial countdown banner (Req 4.4)
      if (sub.status === 'trialing' && data.daysUntilTrialEnd !== undefined) {
        _showTrialBanner(data.daysUntilTrialEnd);
      } else {
        document.getElementById('trial-banner')?.remove();
      }

      // Onboarding completion prompt (Req 8.6)
      // The API may return onboarding_completed at root level or nested under `user`
      const onboardingDone = data.onboarding_completed ??
                             data.user?.onboarding_completed ??
                             true; // default: assume done if not provided
      if (onboardingDone === false) {
        _showSetupBanner();
      } else {
        document.getElementById('onboarding-banner')?.remove();
      }
    } catch (_) {}
  }

  /** Render the trial countdown banner */
  function _showTrialBanner(daysLeft) {
    let el = document.getElementById('trial-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'trial-banner';
      el.className = 'trial-countdown-banner';
      const overviewHeader = document.querySelector('#tab-overview .dash-tab__header');
      if (overviewHeader) overviewHeader.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = `🎉 <strong>Prueba Business activa</strong> — te quedan <strong>${daysLeft} días</strong>. <a href="#" onclick="Dashboard.showBillingTab();return false;" class="trial-countdown-banner__link">Ver planes →</a>`;
  }

  /** Render the "Complete Setup" banner */
  function _showSetupBanner() {
    let el = document.getElementById('onboarding-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'onboarding-banner';
      el.className = 'complete-setup-banner';
      const overviewHeader = document.querySelector('#tab-overview .dash-tab__header');
      if (overviewHeader) overviewHeader.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = `
      <div class="complete-setup-banner__text">
        <strong>⚙️ Tu configuración está incompleta.</strong>
        Termina de configurar tu cuenta para sacar el máximo provecho de Eteba Chat.
      </div>
      <button class="complete-setup-banner__btn btn btn--primary btn--sm" id="btn-complete-setup">
        Completar Configuración
      </button>
    `;
    document.getElementById('btn-complete-setup')?.addEventListener('click', () => {
      if (typeof OnboardingWizard !== 'undefined') OnboardingWizard.show();
    });
  }

  /** Load Usage Section with progress bars (Req 8.2, 8.3, 8.4) */
  async function loadUsageSection(tenantId) {
    const token = Auth.getAccessToken();
    try {
      const resp = await fetch(`${API_BASE}/api/usage`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const s = await resp.json();
      const container = document.getElementById('usage-section');
      if (!container) return;

      const pct = s.percentages || {};
      const lim = s.limits || {};
      const resources = [
        { key: 'queries',    label: 'Consultas IA',  count: s.query_count,     limit: lim.monthly_query_limit, pctVal: pct.queries },
        { key: 'products',   label: 'Productos',     count: s.product_count,   limit: lim.product_limit,       pctVal: pct.products },
        { key: 'connectors', label: 'Conectores',    count: s.connector_count, limit: lim.connector_limit,     pctVal: pct.connectors },
        { key: 'api_keys',   label: 'API Keys',      count: s.api_key_count,   limit: lim.api_key_limit,       pctVal: pct.api_keys },
      ];

      container.innerHTML = `<h3 style="font-size:1rem;font-weight:600;margin:0 0 1rem;color:#d1d5db;">Uso del Plan — ${new Date().toLocaleString('es-ES',{month:'long',year:'numeric'})}</h3>` +
        resources.map(r => {
          const p = Math.min(r.pctVal || 0, 100);
          const cls = p >= 95 ? 'usage--critical' : p >= 80 ? 'usage--warning' : 'usage--normal';
          const limitLabel = r.limit === null ? '∞' : r.limit;
          return `
<div style="margin-bottom:1rem;">
  <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#9ca3af;margin-bottom:0.3rem;">
    <span>${r.label}</span><span>${r.count} / ${limitLabel}</span>
  </div>
  <div style="background:#374151;border-radius:9999px;height:6px;">
    <div class="${cls}" style="height:6px;border-radius:9999px;transition:width 0.4s;width:${p}%;"></div>
  </div>
</div>`;
        }).join('');

      // Warning banners
      if ((pct.queries || 0) >= 100) {
        _showBanner('limit-banner', '🚫 Has alcanzado el límite de consultas este mes. <a href="#" onclick="Dashboard.showBillingTab();return false;">Actualiza tu plan →</a>', 'error');
      } else if ((pct.queries || 0) >= 80) {
        _showBanner('softlimit-banner', '⚠️ Estás al ' + Math.round(pct.queries) + '% de tus consultas mensuales. <a href="#" onclick="Dashboard.showBillingTab();return false;">Ver planes</a>', 'warning');
      }
    } catch (_) {}
  }

  function _showBanner(id, html, type) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      const overviewHeader = document.querySelector('#tab-overview .dash-tab__header');
      if (overviewHeader) overviewHeader.insertAdjacentElement('afterend', el);
    }
    const colors = { info: '#1e40af', warning: '#92400e', error: '#7f1d1d' };
    el.style.cssText = `background:${colors[type]||colors.info};color:#e5e7eb;padding:0.625rem 1rem;border-radius:8px;font-size:0.875rem;margin-bottom:0.75rem;`;
    el.innerHTML = html;
  }

  /** Navigate to billing tab */
  function showBillingTab() {
    document.querySelectorAll('.sidebar__item').forEach(i => i.classList.remove('sidebar__item--active'));
    document.querySelector('.sidebar__item[data-tab="billing"]')?.classList.add('sidebar__item--active');
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-billing')?.classList.add('active');
    loadBillingPortal();
  }

  /** Load Billing Portal content (Req 7.1, 7.3, 7.5, 8.5) */
  async function loadBillingPortal() {
    const container = document.getElementById('billing-content');
    if (!container) return;
    const token = Auth.getAccessToken();
    container.innerHTML = '<p style="color:#9ca3af;">Cargando datos del plan...</p>';
    try {
      const [subResp, plansResp] = await Promise.all([
        fetch(`${API_BASE}/api/subscription`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/plans`)
      ]);
      if (!subResp.ok) throw new Error('No subscription');
      const subData = await subResp.json();
      const plansData = plansResp.ok ? await plansResp.json() : { plans: [] };
      const sub = subData.subscription || {};
      const currentPlan = subData.plan || {};
      const plans = plansData.plans || [];
      const TIER = { free: 0, starter: 1, business: 2, enterprise: 3 };
      const currentTier = TIER[currentPlan.id] || 0;
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('es-ES',{dateStyle:'long'}) : '—';

      container.innerHTML = `
<div style="margin-bottom:1.5rem;padding:1rem;background:#111827;border:1px solid #374151;border-radius:10px;">
  <div style="font-size:0.8rem;color:#9ca3af;margin-bottom:0.25rem;">Plan actual</div>
  <div style="font-size:1.25rem;font-weight:700;color:#f9fafb;">${currentPlan.name || currentPlan.id || 'Free'}</div>
  <div style="font-size:0.8rem;color:#6b7280;margin-top:0.25rem;">Estado: <strong style="color:#d1d5db;">${sub.status || 'active'}</strong> · Próxima renovación: ${periodEnd}</div>
  ${sub.scheduled_plan_id ? `<div style="margin-top:0.5rem;font-size:0.8rem;color:#f59e0b;">⏳ Cambio programado a <strong>${sub.scheduled_plan_id}</strong> el ${periodEnd}</div>` : ''}
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
  ${plans.map(p => {
    const tier = TIER[p.id] || 0;
    const isCurrent = p.id === currentPlan.id;
    const isUpgrade = tier > currentTier;
    const isDowngrade = tier < currentTier;
    const price = p.price_monthly_usd > 0 ? `$${p.price_monthly_usd}/mes` : 'Gratis';
    let btn = '';
    if (isCurrent) btn = `<button class="btn btn--ghost btn--sm" disabled style="opacity:0.5;">Plan actual</button>`;
    else if (isUpgrade) btn = `<button class="btn btn--primary btn--sm" onclick="Dashboard._upgradePlan('${p.id}')">Actualizar</button>`;
    else if (isDowngrade && p.id !== 'enterprise') btn = `<button class="btn btn--ghost btn--sm" onclick="Dashboard._downgradePlan('${p.id}')">Cambiar</button>`;
    return `<div style="background:#111827;border:1px solid ${isCurrent?'#6366f1':'#374151'};border-radius:10px;padding:1rem;">
      <div style="font-weight:600;color:#f9fafb;margin-bottom:0.2rem;">${p.name}</div>
      <div style="font-size:0.85rem;color:#6366f1;font-weight:700;margin-bottom:0.5rem;">${price}</div>
      ${btn}
    </div>`;
  }).join('')}
</div>
${sub.status !== 'cancelled' ? `<button class="btn btn--ghost btn--sm" style="color:#ef4444;" onclick="Dashboard._cancelSubscription()">Cancelar suscripción</button>` : ''}
`;
    } catch (e) {
      container.innerHTML = '<p style="color:#9ca3af;">Error al cargar el portal de facturación.</p>';
    }
  }

  async function _upgradePlan(planId) {
    if (!confirm(`¿Actualizar al plan ${planId}?`)) return;
    const token = Auth.getAccessToken();
    try {
      const r = await fetch(`${API_BASE}/api/subscription/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPlanId: planId })
      });
      const d = await r.json();
      if (r.ok) { showToast('Plan actualizado correctamente', 'success'); loadBillingPortal(); loadPlanBadge(); }
      else showToast(d.error || 'Error al actualizar plan', 'error');
    } catch (_) { showToast('Error de conexión', 'error'); }
  }

  async function _downgradePlan(planId) {
    if (!confirm(`¿Programar cambio al plan ${planId} al final del período actual?`)) return;
    const token = Auth.getAccessToken();
    try {
      const r = await fetch(`${API_BASE}/api/subscription/downgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPlanId: planId })
      });
      const d = await r.json();
      if (r.ok) { showToast(`Cambio a ${planId} programado para el ${new Date(d.effective_date).toLocaleDateString('es-ES')}`, 'success'); loadBillingPortal(); }
      else showToast(d.error || 'Error al programar cambio', 'error');
    } catch (_) { showToast('Error de conexión', 'error'); }
  }

  async function _cancelSubscription() {
    if (!confirm('¿Cancelar tu suscripción? Conservarás el acceso hasta el final del período actual.')) return;
    const token = Auth.getAccessToken();
    try {
      const r = await fetch(`${API_BASE}/api/subscription/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      if (r.ok) { showToast('Suscripción cancelada. Acceso hasta ' + new Date(d.access_until).toLocaleDateString('es-ES'), 'success'); loadBillingPortal(); }
      else showToast(d.error || 'Error al cancelar', 'error');
    } catch (_) { showToast('Error de conexión', 'error'); }
  }

  return { init, loadDashboardData, displayTenantInfo, showConfirmDialog, loadPlanBadge, loadUsageSection, showBillingTab, loadBillingPortal, _upgradePlan, _downgradePlan, _cancelSubscription, updateTenantSubscription, resetTenantUsage };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// DATA CONNECTOR SECTION
// Requirements: 9.1–9.7, 10.4, 11.7–11.8, 12.5
// ═══════════════════════════════════════════════════════════════════════════════

const ConnectorManager = (() => {
  const API_BASE = window.location.origin;

  function getAuthHeader() {
    const token = localStorage.getItem('eteba_auth_token') || sessionStorage.getItem('eteba_auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  /** Inject the connector section HTML into the dashboard */
  function injectSection() {
    const target = document.getElementById('connector-section') || document.getElementById('settings-tab') || document.querySelector('[data-tab="settings"]');
    if (!target) return;

    target.insertAdjacentHTML('beforeend', `
      <section class="connector-section card" id="connector-card">
        <h3 class="connector-section__title">🔌 Conector de Datos</h3>
        <p class="connector-section__desc">Conecta tu base de datos externa al asistente de IA.</p>

        <!-- Status badge -->
        <div id="connector-status-badge" class="connector-badge connector-badge--hidden">
          <span id="connector-status-dot" class="connector-dot"></span>
          <span id="connector-status-text">–</span>
        </div>

        <!-- Form -->
        <form id="connector-form" class="connector-form" novalidate>
          <div class="form-group">
            <label for="connector-display-name">Nombre del conector *</label>
            <input type="text" id="connector-display-name" placeholder="Mi Tienda Online" maxlength="128" required />
          </div>
          <div class="form-group">
            <label for="connector-proxy-url">URL del proxy (HTTPS) *</label>
            <input type="url" id="connector-proxy-url" placeholder="https://mi-sitio.com/proxy.php" required />
          </div>
          <div class="form-group connector-form__token-row">
            <label for="connector-token">Token de autenticación *</label>
            <div class="input-with-action">
              <input type="text" id="connector-token" placeholder="64-char hex token" required />
              <button type="button" id="btn-generate-token" class="btn btn--sm btn--secondary">Generar</button>
            </div>
          </div>
          <div class="form-group">
            <label for="connector-business-type">Tipo de negocio</label>
            <select id="connector-business-type">
              <option value="general">General</option>
              <option value="ecommerce">E-commerce</option>
              <option value="appointments">Citas / Clínica</option>
              <option value="restaurant">Restaurante</option>
              <option value="services">Servicios</option>
            </select>
          </div>

          <div class="connector-form__actions">
            <button type="submit" class="btn btn--primary" id="btn-save-connector">Guardar</button>
            <button type="button" class="btn btn--danger btn--sm" id="btn-delete-connector" style="display:none">Eliminar</button>
          </div>
          <p id="connector-form-msg" class="connector-msg" aria-live="polite"></p>
        </form>

        <!-- Test connection -->
        <div class="connector-test">
          <button type="button" class="btn btn--secondary" id="btn-test-connector">🔁 Probar Conexión</button>
          <p id="connector-test-msg" class="connector-msg" aria-live="polite"></p>
        </div>

        <!-- Template download -->
        <div class="connector-template">
          <h4>📄 Descargar plantilla proxy</h4>
          <select id="template-language">
            <option value="nodejs">Node.js (Express)</option>
            <option value="php">PHP</option>
            <option value="python">Python (Flask)</option>
          </select>
          <button type="button" class="btn btn--secondary btn--sm" id="btn-download-template">Descargar</button>
        </div>
      </section>
    `);

    bindEvents();
    loadConnector();
  }

  function bindEvents() {
    document.getElementById('connector-form')?.addEventListener('submit', saveConnector);
    document.getElementById('btn-generate-token')?.addEventListener('click', generateToken);
    document.getElementById('btn-test-connector')?.addEventListener('click', testConnector);
    document.getElementById('btn-delete-connector')?.addEventListener('click', deleteConnector);
    document.getElementById('btn-download-template')?.addEventListener('click', downloadTemplate);
  }

  function setMsg(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `connector-msg${isError ? ' connector-msg--error' : ' connector-msg--ok'}`;
  }

  function setStatus(status) {
    const badge = document.getElementById('connector-status-badge');
    const dot = document.getElementById('connector-status-dot');
    const text = document.getElementById('connector-status-text');
    if (!badge || !dot || !text) return;

    badge.classList.remove('connector-badge--hidden');
    const map = { active: ['🟢', 'Activo'], inactive: ['⚫', 'Inactivo'], error: ['🔴', 'Error'] };
    const [icon, label] = map[status] || ['⚪', status];
    dot.textContent = icon;
    text.textContent = label;
    dot.className = `connector-dot connector-dot--${status}`;
  }

  async function loadConnector() {
    try {
      const res = await fetch(`${API_BASE}/api/connectors`, { headers: getAuthHeader() });
      if (res.status === 404) { showEmptyForm(); return; }
      const { connector } = await res.json();
      if (connector) populateForm(connector);
    } catch { showEmptyForm(); }
  }

  function showEmptyForm() {
    document.getElementById('btn-delete-connector').style.display = 'none';
    setStatus('inactive');
  }

  function populateForm(c) {
    document.getElementById('connector-display-name').value = c.display_name || '';
    document.getElementById('connector-proxy-url').value = c.proxy_url || '';
    document.getElementById('connector-token').value = c.connector_token || '';
    document.getElementById('connector-business-type').value = c.business_type || 'general';
    document.getElementById('btn-delete-connector').style.display = 'inline-block';
    setStatus(c.status || 'active');
  }

  async function saveConnector(e) {
    e.preventDefault();
    const displayName = document.getElementById('connector-display-name').value.trim();
    const proxyUrl = document.getElementById('connector-proxy-url').value.trim();
    const token = document.getElementById('connector-token').value.trim();
    const businessType = document.getElementById('connector-business-type').value;

    if (!displayName || !proxyUrl || !token) { setMsg('connector-form-msg', 'Completa todos los campos obligatorios.', true); return; }
    if (!proxyUrl.startsWith('https://')) { setMsg('connector-form-msg', 'La URL debe comenzar con https://', true); return; }

    const body = { display_name: displayName, proxy_url: proxyUrl, connector_token: token, business_type: businessType };

    // Try PUT first, fall back to POST
    let res = await fetch(`${API_BASE}/api/connectors`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(body) });
    if (res.status === 404) {
      res = await fetch(`${API_BASE}/api/connectors`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(body) });
    }

    const json = await res.json();
    if (!res.ok) { setMsg('connector-form-msg', json.error || 'Error al guardar', true); return; }
    setMsg('connector-form-msg', '✅ Conector guardado correctamente.');
    populateForm(json.connector);
  }

  async function deleteConnector() {
    if (!confirm('¿Eliminar el conector? Se detendrá toda comunicación con el proxy.')) return;
    const res = await fetch(`${API_BASE}/api/connectors`, { method: 'DELETE', headers: getAuthHeader() });
    if (res.ok) { setMsg('connector-form-msg', 'Conector eliminado.'); showEmptyForm(); }
    else { const j = await res.json(); setMsg('connector-form-msg', j.error || 'Error al eliminar', true); }
  }

  async function generateToken() {
    const res = await fetch(`${API_BASE}/api/connectors/generate-token`, { method: 'POST', headers: getAuthHeader() });
    const { token } = await res.json();
    if (token) document.getElementById('connector-token').value = token;
  }

  async function testConnector() {
    const proxyUrl = document.getElementById('connector-proxy-url').value.trim();
    const token = document.getElementById('connector-token').value.trim();
    if (!proxyUrl || !token) { setMsg('connector-test-msg', 'Ingresa URL y token antes de probar.', true); return; }
    setMsg('connector-test-msg', '⏳ Probando conexión…');
    try {
      const res = await fetch(`${API_BASE}/api/connectors/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ proxy_url: proxyUrl, connector_token: token }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg('connector-test-msg', `✅ Conexión exitosa — tipo: ${json.data?.business_type || '?'}, versión: ${json.data?.version || '?'}`);
        setStatus('active');
      } else {
        const hint = json.error?.includes('timeout') ? 'El proxy no respondió a tiempo. Verifica que esté en línea.'
          : json.error?.includes('auth') ? 'Token incorrecto. Verifica que coincida con el proxy.'
          : 'El proxy no está accesible. Verifica la URL.';
        setMsg('connector-test-msg', `❌ ${json.error || 'Fallo'} — ${hint}`, true);
        setStatus('error');
      }
    } catch { setMsg('connector-test-msg', '❌ Error de red al contactar el servidor.', true); }
  }

  function downloadTemplate() {
    const lang = document.getElementById('template-language').value;
    const bizType = document.getElementById('connector-business-type').value || 'general';
    const token = encodeURIComponent(localStorage.getItem('eteba_auth_token') || '');
    window.location.href = `${API_BASE}/api/connectors/template?language=${lang}&businessType=${bizType}&token=${token}`;
  }

  return { init: injectSection };
})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ConnectorManager.init());
} else {
  ConnectorManager.init();
}
