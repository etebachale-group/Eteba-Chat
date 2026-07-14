/**
 * Eteba Chat — Client-Side Router (SPA Navigation)
 * Maneja la navegación entre páginas sin recargar
 */
const AppRouter = (() => {
  let currentPage = 'landing';

  function navigate(pageName) {
    // Ocultar todas las páginas
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });

    // Mostrar la página solicitada
    const target = document.getElementById(`page-${pageName}`);
    if (target) {
      target.classList.add('active');
      currentPage = pageName;
      window.scrollTo(0, 0);

      // Actualizar links activos en nav
      document.querySelectorAll('.nav__link').forEach(link => {
        link.classList.toggle('active', link.dataset.navigate === pageName);
      });

      // Mostrar/ocultar footer (no en dashboard ni docs)
      const footer = document.querySelector('.footer');
      if (footer) {
        footer.style.display = ['dashboard'].includes(pageName) ? 'none' : 'block';
      }

      // Cargar datos específicos de la página
      if (pageName === 'dashboard' && typeof Dashboard !== 'undefined' && Auth.isLoggedIn()) {
        Dashboard.loadDashboardData();
      }

      // Proteger dashboard — redirigir a landing si no está logueado
      if (pageName === 'dashboard' && !Auth.isLoggedIn()) {
        pageName = 'landing';
        target.classList.remove('active');
        document.getElementById('page-landing').classList.add('active');
      }

      // Update URL hash
      window.location.hash = pageName === 'landing' ? '' : pageName;
    }
  }

  function getCurrentPage() {
    return currentPage;
  }

  function init() {
    // Event delegation para links de navegación
    document.addEventListener('click', (e) => {
      const navTarget = e.target.closest('[data-navigate]');
      if (navTarget) {
        e.preventDefault();
        navigate(navTarget.dataset.navigate);
      }
    });

    // Restaurar página desde hash en la URL
    const hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById(`page-${hash}`)) {
      navigate(hash);
    }

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '') || 'landing';
      if (document.getElementById(`page-${hash}`)) {
        navigate(hash);
      }
    });
  }

  return { navigate, getCurrentPage, init };
})();
