/**
 * Eteba Chat — Dashboard Module
 * Maneja la lógica del panel de administración
 */
const Dashboard = (() => {
  const API_BASE = window.location.origin;

  function init() {
    initSidebarTabs();
    initConfigForm();
    initCatalogActions();
  }

  /** Cargar datos cuando el usuario entra al dashboard */
  function loadDashboardData() {
    const user = Auth.getUser();
    if (!user) return;

    // Usar el tenantId vinculado (para admins de negocios usa el tenant del negocio)
    const tenantId = user.tenantId || user.id;

    loadMetrics(tenantId);
    loadRecentOrders(tenantId);
    loadCatalog(tenantId);
    displayTenantInfo();

    // Mostrar badge de rol si es admin
    const headerEl = document.querySelector('#tab-overview .dash-tab__header h2');
    if (headerEl && user.role === 'admin') {
      headerEl.textContent = `Panel de Administración`;
    }
  }

  /** Navegación entre tabs del dashboard */
  function initSidebarTabs() {
    document.querySelectorAll('.sidebar__item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = item.dataset.tab;
        if (!tabName) return;

        document.querySelectorAll('.sidebar__item').forEach(i => i.classList.remove('sidebar__item--active'));
        item.classList.add('sidebar__item--active');

        document.querySelectorAll('.dash-tab').forEach(tab => tab.classList.remove('active'));
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) targetTab.classList.add('active');
      });
    });
  }

  /** Cargar métricas del overview */
  async function loadMetrics(tenantId) {
    // TODO: Endpoint de métricas — por ahora mostrar datos de placeholder
    // Cuando tengamos el endpoint, hacer fetch y actualizar los valores
  }

  /** Cargar pedidos recientes */
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
            ${data.orders.slice(0, 5).map(order => `
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
      container.innerHTML = '<p class="text-muted">Los pedidos estarán disponibles cuando se configure la conexión.</p>';
    }
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
                  <button class="btn btn--ghost btn--sm" data-edit-product="${p.id}">Editar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
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

      try {
        const resp = await fetch(`${API_BASE}/api/catalog`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Auth.getAccessToken()}`
          },
          body: JSON.stringify({ tenantId: user.tenantId || user.id, name, description, price, stock, image_url })
        });

        if (resp.ok) {
          showToast('Producto agregado correctamente', 'success');
          modal.remove();
          loadCatalog(user.id);
        } else {
          showToast('Error al guardar producto', 'error');
        }
      } catch (err) {
        showToast('Error de conexión', 'error');
      }
    });
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

  return { init, loadDashboardData, displayTenantInfo };
})();
