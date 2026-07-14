/**
 * Eteba Chat — Dashboard Module
 * Maneja la lógica del panel de administración
 */
const Dashboard = (() => {

  function init() {
    initSidebarTabs();
    initConfigForm();
  }

  /** Navegación entre tabs del dashboard */
  function initSidebarTabs() {
    document.querySelectorAll('.sidebar__item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = item.dataset.tab;
        if (!tabName) return;

        // Actualizar items activos
        document.querySelectorAll('.sidebar__item').forEach(i => i.classList.remove('sidebar__item--active'));
        item.classList.add('sidebar__item--active');

        // Mostrar tab correspondiente
        document.querySelectorAll('.dash-tab').forEach(tab => tab.classList.remove('active'));
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) targetTab.classList.add('active');
      });
    });
  }

  /** Guardar configuración del asistente */
  function initConfigForm() {
    document.getElementById('btn-save-config')?.addEventListener('click', async () => {
      const name = document.getElementById('config-name')?.value;
      const manual = document.getElementById('config-manual')?.value;
      const type = document.getElementById('config-type')?.value;

      if (!Auth.isLoggedIn()) {
        alert('Debes iniciar sesión para guardar la configuración.');
        return;
      }

      // TODO: Guardar en InsForge
      console.log('[Dashboard] Guardando config:', { name, manual, type });
      alert('Configuración guardada correctamente.');
    });
  }

  /** Mostrar el tenant ID del usuario en la sección API Keys */
  function displayTenantInfo() {
    const user = Auth.getUser();
    if (!user) return;

    const tenantDisplay = document.getElementById('display-tenant-id');
    if (tenantDisplay) {
      tenantDisplay.textContent = user.id || '—';
    }

    const widgetCode = document.getElementById('widget-code');
    if (widgetCode && user.id) {
      widgetCode.textContent = `<script src="https://eteba-chat.onrender.com/widget/widget.js?tenant_id=${user.id}"><\/script>`;
    }
  }

  return { init, displayTenantInfo };
})();
