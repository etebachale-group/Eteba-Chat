/**
 * Eteba Chat — Explore Module
 * Directorio público de negocios conectados
 */
const Explore = (() => {
  const API_BASE = window.location.origin;

  // Negocios de demostración (se reemplazará con datos de InsForge)
  const demoBusinesses = [
    {
      id: 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b',
      name: 'Rotteri',
      category: 'Tiendas',
      description: 'Tienda de moda, zapatillas, pelucas y accesorios',
      logo: '🛍️',
      status: 'active'
    },
    {
      id: 'demo-2',
      name: 'MalaboTech',
      category: 'Tecnología',
      description: 'Reparación de teléfonos, accesorios electrónicos y servicios IT',
      logo: '📱',
      status: 'coming'
    },
    {
      id: 'demo-3',
      name: 'GE Express',
      category: 'Servicios',
      description: 'Envíos y logística nacional e internacional',
      logo: '📦',
      status: 'coming'
    },
    {
      id: 'demo-4',
      name: 'Sabor GE',
      category: 'Restaurantes',
      description: 'Comida tradicional ecuatoguineana con delivery',
      logo: '🍽️',
      status: 'coming'
    },
    {
      id: 'demo-5',
      name: 'BataShop',
      category: 'Tiendas',
      description: 'Ropa y calzado importado, tienda online en Bata',
      logo: '👟',
      status: 'coming'
    },
    {
      id: 'demo-6',
      name: 'EduGE Academy',
      category: 'Servicios',
      description: 'Cursos online y formación profesional',
      logo: '🎓',
      status: 'coming'
    }
  ];

  let currentFilter = 'Todos';

  function init() {
    renderGrid(demoBusinesses);
    initSearch();
    initFilters();
  }

  function renderGrid(businesses) {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;

    if (businesses.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="text-align:center;grid-column:1/-1;">No se encontraron negocios con ese criterio.</p>';
      return;
    }

    grid.innerHTML = businesses.map(biz => `
      <div class="explore-card ${biz.status === 'active' ? 'explore-card--active' : ''}">
        <div class="explore-card__header">
          <span class="explore-card__logo">${biz.logo}</span>
          <div>
            <h4 class="explore-card__name">${biz.name}</h4>
            <span class="explore-card__category">${biz.category}</span>
          </div>
        </div>
        <p class="explore-card__desc">${biz.description}</p>
        <div class="explore-card__footer">
          ${biz.status === 'active' 
            ? `<button class="btn btn--primary btn--sm" data-chat-business="${biz.id}">Chatear</button>
               <span class="badge badge--success">Activo</span>`
            : `<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--color-text-muted);">Próximamente</span>`
          }
        </div>
      </div>
    `).join('');

    // Event listeners para botones de chat
    grid.querySelectorAll('[data-chat-business]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bizId = btn.dataset.chatBusiness;
        openBusinessChat(bizId);
      });
    });
  }

  function initSearch() {
    const searchInput = document.getElementById('explore-search');
    if (!searchInput) return;

    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const query = searchInput.value.toLowerCase().trim();
        const filtered = demoBusinesses.filter(biz => {
          const matchesQuery = !query || 
            biz.name.toLowerCase().includes(query) || 
            biz.description.toLowerCase().includes(query) ||
            biz.category.toLowerCase().includes(query);
          const matchesFilter = currentFilter === 'Todos' || biz.category === currentFilter;
          return matchesQuery && matchesFilter;
        });
        renderGrid(filtered);
      }, 300);
    });
  }

  function initFilters() {
    document.querySelectorAll('.explore__filters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.explore__filters .chip').forEach(c => c.classList.remove('chip--active'));
        chip.classList.add('chip--active');
        currentFilter = chip.textContent.trim();

        const query = document.getElementById('explore-search')?.value.toLowerCase().trim() || '';
        const filtered = demoBusinesses.filter(biz => {
          const matchesQuery = !query || 
            biz.name.toLowerCase().includes(query) || 
            biz.description.toLowerCase().includes(query);
          const matchesFilter = currentFilter === 'Todos' || biz.category === currentFilter;
          return matchesQuery && matchesFilter;
        });
        renderGrid(filtered);
      });
    });
  }

  /** Abrir chat directo con un negocio */
  function openBusinessChat(businessId) {
    // TODO: Abrir mini-chat o redirigir al widget
    const chatUrl = `${API_BASE}/widget/widget.js?tenant_id=${businessId}`;
    alert(`Para chatear con este negocio, visita su sitio web donde tienen el widget instalado.\n\nTenant ID: ${businessId}`);
  }

  return { init };
})();
