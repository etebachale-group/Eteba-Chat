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
    initApiKeyActions();
  }

  /** Cargar datos cuando el usuario entra al dashboard */
  function loadDashboardData() {
    const user = Auth.getUser();
    if (!user) return;

    const tenantId = user.tenantId || user.id;

    // Personalizar saludo
    const welcomeEl = document.getElementById('dash-welcome');
    const subtitleEl = document.getElementById('dash-subtitle');
    if (welcomeEl) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
      const name = user.name ? user.name.split(' ')[0] : '';
      welcomeEl.textContent = `${greeting}${name ? ', ' + name : ''}`;
    }
    if (subtitleEl && user.role === 'admin') {
      subtitleEl.textContent = 'Panel de administración de tu negocio';
    }

    loadMetrics(tenantId);
    loadRecentOrders(tenantId);
    loadCatalog(tenantId);
    displayTenantInfo();
    initQuickActions();
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
          }
        }
      });
    });
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

        if (valid.length === 0) {
          showToast('El formato del archivo no es válido', 'error');
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
            let msg = `Se importaron ${valid.length} productos`;
            if (skipped > 0) {
              msg += ` (${skipped} filas omitidas por datos incompletos)`;
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

  return { init, loadDashboardData, displayTenantInfo, showConfirmDialog };
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
