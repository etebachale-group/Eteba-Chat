/**
 * Eteba Chat — Webhook Integrations Module
 * Maneja la pestaña de "Integraciones" del panel
 */
const WebhooksTab = (() => {
  const API_BASE = window.location.origin;
  let currentEndpointIdForLogs = null;
  let currentLogsPage = 1;

  /**
   * Initializes the Webhooks tab UI and loads data.
   */
  async function init(tenantId) {
    const container = document.getElementById('tab-integrations');
    if (!container) return;

    // Render Webhook layout structure if not already rendered
    container.innerHTML = `
      <div class="tab-header" style="display:flex;justify-content:between;align-items:center;margin-bottom:1.5rem;gap:1rem;">
        <button class="btn btn--ghost btn--sm" id="btn-back-integrations" style="display:flex;align-items:center;gap:0.3rem;padding:6px 12px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M19 12H5m7-7l-7 7 7 7"/></svg> Volver
        </button>
        <div style="flex-grow:1;">
          <h2 style="font-size:1.5rem;font-weight:600;color:var(--color-text-primary,#ffffff);margin:0;">Integraciones Webhooks</h2>
          <p class="text-muted" style="margin-top:0.25rem;font-size:0.85rem;">Notificaciones HTTP en tiempo real para tu negocio.</p>
        </div>
        <button class="btn btn--primary" id="btn-add-webhook">Agregar Webhook</button>
      </div>

      <div class="card" style="margin-bottom:1.5rem;">
        <div class="card__body" id="webhooks-list-container">
          <p class="text-muted">Cargando endpoints de webhooks...</p>
        </div>
      </div>
    `;

    // Wire "Volver" button (simulates clicking integrations in sidebar to restore grid)
    document.getElementById('btn-back-integrations').addEventListener('click', () => {
      const integrationsSidebarItem = document.querySelector('.sidebar__item[data-tab="integrations"]');
      if (integrationsSidebarItem) integrationsSidebarItem.click();
    });

    // Wire "Agregar Webhook" button
    document.getElementById('btn-add-webhook').addEventListener('click', () => {
      showWebhookModal(tenantId);
    });

    await loadWebhooks(tenantId);
  }

  /**
   * Fetches and renders the list of webhook endpoints.
   */
  async function loadWebhooks(tenantId) {
    const listContainer = document.getElementById('webhooks-list-container');
    if (!listContainer) return;

    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Failed to load webhooks');
      const data = await resp.json();

      if (!data.endpoints || data.endpoints.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state" style="text-align:center;padding:2rem;">
            <div style="font-size:3rem;margin-bottom:1rem;color:#4b5563;">🔌</div>
            <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;color:#e5e7eb;">No tienes webhooks configurados</h3>
            <p class="text-muted" style="max-width:320px;margin:0 auto 1.5rem;">Configura un endpoint para recibir eventos como cuando tus clientes te envíen mensajes o actualices el catálogo.</p>
            <button class="btn btn--ghost btn--sm" onclick="document.getElementById('btn-add-webhook').click()">Configurar mi primer Webhook</button>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>URL de Destino</th>
              <th>Eventos Suscritos</th>
              <th style="width:100px;text-align:center;">Activo</th>
              <th style="width:300px;text-align:right;">Acciones</th>
            </tr>
          </thead>
          <tbody id="webhooks-tbody"></tbody>
        </table>
      `;

      const tbody = document.getElementById('webhooks-tbody');
      data.endpoints.forEach(ep => {
        const tr = document.createElement('tr');
        
        // 1. URL Column
        const urlTd = document.createElement('td');
        urlTd.style.maxWidth = '300px';
        urlTd.style.overflow = 'hidden';
        urlTd.style.textOverflow = 'ellipsis';
        urlTd.style.whiteSpace = 'nowrap';
        urlTd.textContent = ep.url;
        tr.appendChild(urlTd);

        // 2. Events Badges Column
        const eventsTd = document.createElement('td');
        const badgeColors = {
          'order.created': '#10b981', // green
          'message.received': '#8b5cf6', // purple
          'catalog.updated': '#f97316', // orange
          'test.ping': '#3b82f6' // blue
        };
        ep.events.forEach(ev => {
          const badge = document.createElement('span');
          badge.style.display = 'inline-block';
          badge.style.padding = '2px 8px';
          badge.style.borderRadius = '9999px';
          badge.style.fontSize = '0.7rem';
          badge.style.fontWeight = '500';
          badge.style.marginRight = '4px';
          badge.style.marginBottom = '2px';
          badge.style.color = '#ffffff';
          badge.style.backgroundColor = badgeColors[ev] || '#6b7280';
          badge.textContent = ev;
          eventsTd.appendChild(badge);
        });
        tr.appendChild(eventsTd);

        // 3. Active Toggle Switch Column
        const activeTd = document.createElement('td');
        activeTd.style.textAlign = 'center';
        activeTd.innerHTML = `
          <label class="switch" style="position:relative;display:inline-block;width:38px;height:20px;margin:0;">
            <input type="checkbox" id="toggle-${ep.id}" ${ep.is_active ? 'checked' : ''} style="opacity:0;width:0;height:0;">
            <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#374151;transition:0.3s;border-radius:20px;"></span>
          </label>
        `;
        
        // Custom styling for slider (will be added via CSS fallback script inside code if stylesheet loads later)
        const toggleInput = activeTd.querySelector(`#toggle-${ep.id}`);
        const sliderSpan = activeTd.querySelector('.slider');
        
        function updateSliderStyle(checked) {
          sliderSpan.style.backgroundColor = checked ? '#8b5cf6' : '#374151';
        }
        updateSliderStyle(ep.is_active);
        
        toggleInput.addEventListener('change', async () => {
          const checked = toggleInput.checked;
          updateSliderStyle(checked);
          await toggleWebhook(ep.id, tenantId, toggleInput);
        });
        activeTd.appendChild(toggleInput.parentNode);
        tr.appendChild(activeTd);

        // 4. Action Buttons Column
        const actionTd = document.createElement('td');
        actionTd.style.textAlign = 'right';
        actionTd.innerHTML = `
          <button class="btn btn--ghost btn--sm" data-test="${ep.id}" style="margin-right:4px;">Probar</button>
          <button class="btn btn--ghost btn--sm" data-edit="${ep.id}" style="margin-right:4px;">Editar</button>
          <button class="btn btn--ghost btn--sm" data-logs="${ep.id}" style="margin-right:4px;">Logs</button>
          <button class="btn btn--ghost btn--sm" data-delete="${ep.id}" style="color:var(--color-error,#ef4444);">Eliminar</button>
        `;

        // Wire Action Events
        actionTd.querySelector(`[data-test="${ep.id}"]`).addEventListener('click', () => testWebhook(ep.id));
        actionTd.querySelector(`[data-edit="${ep.id}"]`).addEventListener('click', () => showWebhookModal(tenantId, ep));
        actionTd.querySelector(`[data-logs="${ep.id}"]`).addEventListener('click', () => showLogsPanel(ep.id, ep.url));
        actionTd.querySelector(`[data-delete="${ep.id}"]`).addEventListener('click', () => deleteWebhook(ep.id, tenantId));

        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      listContainer.innerHTML = '<p class="text-error" style="color:#ef4444;">Error al cargar los webhooks de conexión.</p>';
    }
  }

  /**
   * Sends a PATCH call to toggle active state.
   */
  async function toggleWebhook(id, tenantId, checkboxEl) {
    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Toggle failed');
      const data = await resp.json();
      
      Dashboard.showToast(data.is_active ? 'Webhook activado' : 'Webhook desactivado', 'success');
      loadWebhooks(tenantId);
    } catch (err) {
      Dashboard.showToast('Error al cambiar el estado del webhook', 'error');
      checkboxEl.checked = !checkboxEl.checked; // Revert checkbox UI on failure
    }
  }

  /**
   * Calls POST /api/webhooks/:id/test to trigger a ping test.
   */
  async function testWebhook(id) {
    Dashboard.showToast('Enviando entrega de prueba...', 'info');
    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await resp.json();
      if (resp.ok && data.success) {
        Dashboard.showToast('Webhook de prueba recibido con éxito (HTTP 200)', 'success');
      } else {
        const details = data.error ? `: ${data.error}` : '';
        const code = data.statusCode ? ` (HTTP ${data.statusCode})` : '';
        Dashboard.showToast(`Error en la entrega de prueba${code}${details}`, 'error');
      }
    } catch (err) {
      Dashboard.showToast('Error de red al probar webhook', 'error');
    }
  }

  /**
   * Prompts user and deletes a webhook.
   */
  async function deleteWebhook(id, tenantId) {
    const confirmed = await Dashboard.showConfirmDialog('¿Estás seguro de eliminar este Webhook? Todos los logs de entrega se eliminarán permanentemente.');
    if (!confirmed) return;

    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (resp.ok) {
        Dashboard.showToast('Webhook eliminado', 'success');
        loadWebhooks(tenantId);
      } else {
        const errorData = await resp.json().catch(() => ({}));
        Dashboard.showToast(errorData.error || 'Error al eliminar webhook', 'error');
      }
    } catch (err) {
      Dashboard.showToast('Error de conexión', 'error');
    }
  }

  /**
   * Creates or updates a webhook endpoint.
   */
  function showWebhookModal(tenantId, endpoint = null) {
    const isEdit = endpoint !== null;
    const modalHTML = `
      <div class="modal-overlay" id="webhook-modal">
        <div class="modal" style="max-width:500px;">
          <div class="modal__header">
            <h3>${isEdit ? 'Editar' : 'Agregar'} Webhook</h3>
            <button class="modal__close" id="webhook-modal-close">&times;</button>
          </div>
          <div class="modal__body">
            <div class="form-group" style="margin-bottom:1.2rem;">
              <label class="form-label">URL de destino (debe ser HTTPS)</label>
              <input type="text" class="input" id="webhook-url" value="${endpoint?.url || ''}" placeholder="https://mi-servidor.com/webhook" style="width:100%;">
            </div>
            
            <div class="form-group" style="margin-bottom:1.2rem;">
              <label class="form-label">Eventos a enviar</label>
              <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.3rem;">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                  <input type="checkbox" name="webhook-events" value="message.received" ${!isEdit || endpoint.events.includes('message.received') ? 'checked' : ''}>
                  <span>message.received (Al recibir un mensaje del cliente)</span>
                </label>
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                  <input type="checkbox" name="webhook-events" value="catalog.updated" ${!isEdit || endpoint.events.includes('catalog.updated') ? 'checked' : ''}>
                  <span>catalog.updated (Al agregar/editar/eliminar productos)</span>
                </label>
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                  <input type="checkbox" name="webhook-events" value="order.created" ${!isEdit || endpoint.events.includes('order.created') ? 'checked' : ''}>
                  <span>order.created (Al crear un nuevo pedido)</span>
                </label>
              </div>
            </div>

            ${isEdit ? `
            <div style="border-top:1px solid #374151;padding-top:1rem;margin-top:1rem;">
              <label class="form-label">Firma Secreta</label>
              <p class="text-muted" style="font-size:0.75rem;margin-bottom:0.5rem;">Se utiliza para verificar la autenticidad de las notificaciones enviadas a tu servidor.</p>
              <div style="display:flex;gap:0.5rem;">
                <button class="btn btn--ghost btn--sm" id="btn-regenerate-secret" style="width:100%;">Regenerar Secreto de Firma</button>
              </div>
            </div>
            ` : ''}
          </div>
          <div class="modal__footer">
            <button class="btn btn--ghost" id="webhook-modal-cancel">Cancelar</button>
            <button class="btn btn--primary" id="webhook-modal-save">${isEdit ? 'Actualizar' : 'Agregar'}</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('webhook-modal');

    // Close Actions
    document.getElementById('webhook-modal-close').addEventListener('click', () => modal.remove());
    document.getElementById('webhook-modal-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Save Action
    document.getElementById('webhook-modal-save').addEventListener('click', async () => {
      const url = document.getElementById('webhook-url').value.trim();
      const selectedEvents = Array.from(document.querySelectorAll('input[name="webhook-events"]:checked')).map(el => el.value);

      if (!url) {
        alert('La URL es obligatoria');
        return;
      }
      if (!url.toLowerCase().startsWith('https://')) {
        alert('La URL debe usar HTTPS obligatoriamente (iniciar con https://)');
        return;
      }
      if (selectedEvents.length === 0) {
        alert('Debes seleccionar al menos un tipo de evento');
        return;
      }

      try {
        const token = Auth.getAccessToken();
        const apiPath = isEdit ? `/api/webhooks/${endpoint.id}` : '/api/webhooks';
        const method = isEdit ? 'PUT' : 'POST';

        const resp = await fetch(`${API_BASE}${apiPath}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ url, events: selectedEvents })
        });

        const data = await resp.json();

        if (resp.ok) {
          modal.remove();
          loadWebhooks(tenantId);

          if (!isEdit && data.signing_secret) {
            // Show the signing secret dialog only once on creation
            showSecretDialog(data.signing_secret);
          } else {
            Dashboard.showToast(isEdit ? 'Webhook actualizado' : 'Webhook agregado', 'success');
          }
        } else {
          alert(data.error || 'Error al guardar el webhook');
        }
      } catch (err) {
        alert('Error de conexión con el servidor');
      }
    });

    // Regenerate secret action (edit mode only)
    if (isEdit) {
      document.getElementById('btn-regenerate-secret').addEventListener('click', async () => {
        const confirmed = await Dashboard.showConfirmDialog('¿Estás seguro de regenerar el secreto de firma? Tu servidor rechazará las firmas antiguas.');
        if (!confirmed) return;

        try {
          const token = Auth.getAccessToken();
          const resp = await fetch(`${API_BASE}/api/webhooks/${endpoint.id}/regenerate-secret`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          });

          const data = await resp.json();
          if (resp.ok && data.signing_secret) {
            modal.remove();
            showSecretDialog(data.signing_secret);
          } else {
            alert(data.error || 'Error al regenerar el secreto');
          }
        } catch (err) {
          alert('Error de conexión');
        }
      });
    }
  }

  /**
   * Displays the signing secret modal to be copied once.
   */
  function showSecretDialog(secret) {
    const modalHTML = `
      <div class="modal-overlay" id="secret-modal">
        <div class="modal" style="max-width:420px;border:1px solid var(--color-primary,#8b5cf6);">
          <div class="modal__header">
            <h3 style="color:#ef4444;">🔑 Secreto de Firma Creado</h3>
          </div>
          <div class="modal__body">
            <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);margin-bottom:1rem;">
              Copia este secreto en la configuración de tu servidor para validar las solicitudes entrantes. 
              <strong>No se mostrará nuevamente.</strong>
            </p>
            <div class="api-key__display" style="background:#1f2937;padding:0.75rem;border-radius:6px;display:flex;justify-content:between;align-items:center;font-family:monospace;font-size:0.85rem;color:#e5e7eb;border:1px solid #374151;">
              <code style="word-break:break-all;">${secret}</code>
              <button class="btn btn--primary btn--sm" id="btn-copy-webhook-secret" style="margin-left:0.5rem;flex-shrink:0;">Copiar</button>
            </div>
          </div>
          <div class="modal__footer">
            <button class="btn btn--primary" id="btn-close-secret" style="width:100%;">He copiado el secreto seguro</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('secret-modal');

    document.getElementById('btn-copy-webhook-secret').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(secret);
        Dashboard.showToast('Secreto copiado al portapapeles', 'success');
      } catch (err) {
        alert('No se pudo copiar de forma automática. Por favor cópialo manualmente.');
      }
    });

    document.getElementById('btn-close-secret').addEventListener('click', () => modal.remove());
  }

  /**
   * Displays the Delivery Logs panel for a webhook endpoint.
   */
  function showLogsPanel(endpointId, url) {
    currentEndpointIdForLogs = endpointId;
    currentLogsPage = 1;

    const modalHTML = `
      <div class="modal-overlay" id="logs-modal">
        <div class="modal" style="max-width:850px;width:95%;">
          <div class="modal__header">
            <div>
              <h3 style="margin:0;">Logs de Entrega</h3>
              <p class="text-muted" style="font-size:0.75rem;margin-top:0.15rem;word-break:break-all;">${url}</p>
            </div>
            <button class="modal__close" id="logs-modal-close">&times;</button>
          </div>
          <div class="modal__body" style="padding-top:0;max-height:480px;overflow-y:auto;" id="logs-list-container">
            <p class="text-muted" style="padding:1.5rem 0;">Cargando logs de entrega...</p>
          </div>
          <div class="modal__footer" style="display:flex;justify-content:between;align-items:center;" id="logs-pagination-container">
            <!-- Pagination injected here -->
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('logs-modal');

    document.getElementById('logs-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    loadLogsPage(1);
  }

  /**
   * Fetches and renders a page of logs.
   */
  async function loadLogsPage(page) {
    currentLogsPage = page;
    const container = document.getElementById('logs-list-container');
    const pagContainer = document.getElementById('logs-pagination-container');
    if (!container || !pagContainer) return;

    container.innerHTML = '<p class="text-muted" style="padding:1.5rem 0;">Cargando logs de entrega...</p>';
    pagContainer.innerHTML = '';

    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks/${currentEndpointIdForLogs}/logs?page=${page}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Failed to load logs');
      const data = await resp.json();

      if (!data.logs || data.logs.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:3rem 0;color:#9ca3af;">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">📥</div>
            <p style="margin:0;">No hay entregas registradas para este endpoint</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <table class="data-table" style="font-size:0.8rem;">
          <thead>
            <tr>
              <th style="width:50px;"></th>
              <th>Evento</th>
              <th>Fecha y Hora</th>
              <th>Intento</th>
              <th>Código</th>
              <th>Estado</th>
              <th style="text-align:right;">Acción</th>
            </tr>
          </thead>
          <tbody id="logs-tbody"></tbody>
        </table>
      `;

      const tbody = document.getElementById('logs-tbody');
      data.logs.forEach(log => {
        const tr = document.createElement('tr');
        
        // 1. Expand Arrow Column
        const expandTd = document.createElement('td');
        expandTd.innerHTML = `<span class="expand-icon-${log.id}" style="cursor:pointer;font-size:1rem;color:#9ca3af;">▶</span>`;
        expandTd.style.textAlign = 'center';
        tr.appendChild(expandTd);

        // 2. Event Name Badge Column
        const eventTd = document.createElement('td');
        eventTd.innerHTML = `
          <span style="font-weight:500;">${log.event_type}</span>
          ${log.is_test ? '<span style="font-size:0.6rem;background:#4b5563;color:#e5e7eb;padding:1px 4px;border-radius:4px;margin-left:4px;font-weight:600;">PRUEBA</span>' : ''}
        `;
        tr.appendChild(eventTd);

        // 3. Time Column
        const timeTd = document.createElement('td');
        timeTd.textContent = new Date(log.created_at).toLocaleString('es-ES');
        tr.appendChild(timeTd);

        // 4. Attempt Number Column
        const attemptTd = document.createElement('td');
        attemptTd.textContent = `#${log.attempt_number}`;
        tr.appendChild(attemptTd);

        // 5. Code Column
        const codeTd = document.createElement('td');
        codeTd.textContent = log.status_code !== null ? log.status_code : '—';
        tr.appendChild(codeTd);

        // 6. Status Column
        const statusTd = document.createElement('td');
        const color = log.status === 'delivered' ? '#10b981' : log.status === 'permanently_failed' ? '#ef4444' : '#f59e0b';
        const txt = log.status === 'delivered' ? 'Entregado' : log.status === 'permanently_failed' ? 'Error Final' : 'Fallo Temporal';
        statusTd.innerHTML = `<span style="color:${color};font-weight:600;">● ${txt}</span>`;
        tr.appendChild(statusTd);

        // 7. Manual Retry Button Column
        const actionTd = document.createElement('td');
        actionTd.style.textAlign = 'right';
        if (log.status === 'permanently_failed' || log.status === 'failed') {
          actionTd.innerHTML = `<button class="btn btn--ghost btn--sm" data-retry-log="${log.id}" style="padding: 2px 8px; font-size: 0.75rem;">Reintentar</button>`;
          actionTd.querySelector(`[data-retry-log="${log.id}"]`).addEventListener('click', (e) => {
            e.stopPropagation();
            retryLog(log.id);
          });
        } else {
          actionTd.innerHTML = '<span style="color:#6b7280;font-size:0.75rem;">N/A</span>';
        }
        tr.appendChild(actionTd);

        tbody.appendChild(tr);

        // 8. Expandable Row Details Container
        const detailsTr = document.createElement('tr');
        detailsTr.id = `details-${log.id}`;
        detailsTr.style.display = 'none';
        detailsTr.innerHTML = `
          <td colspan="7" style="background:#111827;padding:1rem;border-left:2px solid ${color};">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
              <div>
                <strong style="display:block;margin-bottom:0.25rem;color:#9ca3af;font-size:0.75rem;">Payload Enviado:</strong>
                <pre style="margin:0;padding:0.5rem;background:#1f2937;border:1px solid #374151;border-radius:4px;overflow-x:auto;color:#10b981;font-family:monospace;font-size:0.7rem;max-height:160px;overflow-y:auto;">${JSON.stringify(log.payload, null, 2)}</pre>
              </div>
              <div>
                <strong style="display:block;margin-bottom:0.25rem;color:#9ca3af;font-size:0.75rem;">Respuesta del Servidor:</strong>
                <pre style="margin:0;padding:0.5rem;background:#1f2937;border:1px solid #374151;border-radius:4px;overflow-x:auto;color:#f3f4f6;font-family:monospace;font-size:0.7rem;max-height:160px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;">${log.response_body ? Dashboard.escapeHTML(log.response_body) : '— Sin respuesta —'}</pre>
              </div>
            </div>
          </td>
        `;
        tbody.appendChild(detailsTr);

        // Click handler to toggle details row
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          // Avoid expansion when clicking retry button
          if (e.target.tagName === 'BUTTON') return;

          const isVisible = detailsTr.style.display !== 'none';
          detailsTr.style.display = isVisible ? 'none' : 'table-row';
          const icon = tr.querySelector(`.expand-icon-${log.id}`);
          if (icon) {
            icon.textContent = isVisible ? '▶' : '▼';
            icon.style.color = isVisible ? '#9ca3af' : '#ffffff';
          }
        });
      });

      // Pagination Controls
      if (data.totalPages > 1) {
        pagContainer.innerHTML = `
          <button class="btn btn--ghost btn--sm" id="btn-prev-logs" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span style="font-size:0.8rem;color:#9ca3af;">Página ${page} de ${data.totalPages}</span>
          <button class="btn btn--ghost btn--sm" id="btn-next-logs" ${page >= data.totalPages ? 'disabled' : ''}>Siguiente</button>
        `;

        document.getElementById('btn-prev-logs')?.addEventListener('click', () => loadLogsPage(page - 1));
        document.getElementById('btn-next-logs')?.addEventListener('click', () => loadLogsPage(page + 1));
      } else {
        pagContainer.innerHTML = `<span style="font-size:0.8rem;color:#6b7280;">Mostrando todos los logs (${data.total})</span>`;
      }
    } catch (err) {
      container.innerHTML = '<p class="text-error" style="color:#ef4444;padding:1.5rem 0;">Error al cargar logs de entrega.</p>';
    }
  }

  /**
   * Triggers manual retry for a failed log delivery.
   */
  async function retryLog(logId) {
    Dashboard.showToast('Reintentando envío manualmente...', 'info');
    try {
      const token = Auth.getAccessToken();
      const resp = await fetch(`${API_BASE}/api/webhooks/logs/${logId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await resp.json();
      if (resp.ok && data.success) {
        Dashboard.showToast('Reintento manual exitoso (HTTP 200)', 'success');
        loadLogsPage(currentLogsPage); // Refresh current page of logs
      } else {
        const details = data.error ? `: ${data.error}` : '';
        const code = data.statusCode ? ` (HTTP ${data.statusCode})` : '';
        Dashboard.showToast(`El reintento falló${code}${details}`, 'error');
        loadLogsPage(currentLogsPage); // Refresh page to see new failure logs
      }
    } catch (err) {
      Dashboard.showToast('Error de red al reintentar envío', 'error');
    }
  }

  return { init };
})();
window.WebhooksTab = WebhooksTab;
