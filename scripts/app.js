/**
 * Eteba Chat — Main App Entry Point
 * Inicializa todos los módulos
 */
(function() {
  'use strict';

  // Inicializar módulos cuando el DOM esté listo
  document.addEventListener('DOMContentLoaded', () => {
    AppRouter.init();
    Auth.init();
    Dashboard.init();
    initMobileNav();
    initDocsNav();
  });

  /** Mobile navigation toggle */
  function initMobileNav() {
    const toggle = document.getElementById('nav-toggle');
    const links = document.getElementById('nav-links');
    
    if (toggle && links) {
      toggle.addEventListener('click', () => {
        links.classList.toggle('nav__links--open');
        toggle.classList.toggle('nav__mobile-toggle--active');
      });
    }
  }

  /** Docs sidebar navigation */
  function initDocsNav() {
    document.querySelectorAll('.docs__nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.docs__nav-item').forEach(i => i.classList.remove('docs__nav-item--active'));
        item.classList.add('docs__nav-item--active');
        // TODO: Cargar contenido de documentación dinámicamente
      });
    });
  }

  /** Utility: Copy to clipboard */
  window.copyToClipboard = function(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    const text = el.textContent || el.innerText;
    navigator.clipboard.writeText(text).then(() => {
      // Feedback visual temporal
      const originalText = el.textContent;
      el.style.opacity = '0.5';
      setTimeout(() => { el.style.opacity = '1'; }, 300);
    }).catch(err => {
      console.error('Error al copiar:', err);
    });
  };

})();
