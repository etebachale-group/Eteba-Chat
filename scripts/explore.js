/**
 * Eteba Chat — Explore Module v2
 * Directorio de negocios + Chat Universal integrado
 */
const Explore = (() => {
  const API_BASE = window.location.origin;

  const demoBusinesses = [
    {
      id: 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b',
      name: 'Rotteri',
      category: 'Tiendas',
      description: 'Moda, zapatillas, pelucas y accesorios importados de Ghana y Togo',
      logo: 'R',
      status: 'active'
    },
    {
      id: 'demo-2',
      name: 'MalaboTech',
      category: 'Tecnología',
      description: 'Reparación de teléfonos, accesorios electrónicos y servicios IT',
      logo: 'MT',
      status: 'coming'
    },
    {
      id: 'demo-3',
      name: 'GE Express',
      category: 'Servicios',
      description: 'Envíos y logística nacional e internacional',
      logo: 'GE',
      status: 'coming'
    },
    {
      id: 'demo-4',
      name: 'Sabor GE',
      category: 'Restaurantes',
      description: 'Comida tradicional ecuatoguineana con delivery',
      logo: 'SG',
      status: 'coming'
    },
    {
      id: 'demo-5',
      name: 'BataShop',
      category: 'Tiendas',
      description: 'Ropa y calzado importado, tienda online en Bata',
      logo: 'BS',
      status: 'coming'
    },
    {
      id: 'demo-6',
      name: 'EduGE Academy',
      category: 'Servicios',
      description: 'Cursos online y formación profesional',
      logo: 'EA',
      status: 'coming'
    }
  ];

  let currentFilter = 'Todos';
  let activeChatBusiness = null;

  function init() {
    renderGrid(demoBusinesses);
    initSearch();
    initFilters();
    initChatPanel();
  }

  function renderGrid(businesses) {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;

    if (businesses.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="text-align:center;grid-column:1/-1;">No se encontraron negocios.</p>';
      return;
    }

    grid.innerHTML = businesses.map(function(biz) {
      return `
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
              ? `<button class="btn btn--primary btn--sm" data-chat-business="${biz.id}" data-chat-name="${biz.name}" data-chat-logo="${biz.logo}">Chatear</button>
                 <span class="badge badge--success">Activo</span>`
              : `<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--color-text-muted);">Próximamente</span>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    grid.querySelectorAll('[data-chat-business]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openChat(
          btn.dataset.chatBusiness,
          btn.dataset.chatName,
          btn.dataset.chatLogo
        );
      });
    });
  }

  function initSearch() {
    const searchInput = document.getElementById('explore-search');
    if (!searchInput) return;

    var timeout;
    searchInput.addEventListener('input', function() {
      clearTimeout(timeout);
      timeout = setTimeout(function() {
        var query = searchInput.value.toLowerCase().trim();
        var filtered = demoBusinesses.filter(function(biz) {
          var matchesQuery = !query ||
            biz.name.toLowerCase().includes(query) ||
            biz.description.toLowerCase().includes(query) ||
            biz.category.toLowerCase().includes(query);
          var matchesFilter = currentFilter === 'Todos' || biz.category === currentFilter;
          return matchesQuery && matchesFilter;
        });
        renderGrid(filtered);
      }, 300);
    });
  }

  function initFilters() {
    document.querySelectorAll('.explore__filters .chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        document.querySelectorAll('.explore__filters .chip').forEach(function(c) { c.classList.remove('chip--active'); });
        chip.classList.add('chip--active');
        currentFilter = chip.textContent.trim();

        var query = (document.getElementById('explore-search') || {}).value || '';
        query = query.toLowerCase().trim();
        var filtered = demoBusinesses.filter(function(biz) {
          var matchesQuery = !query ||
            biz.name.toLowerCase().includes(query) ||
            biz.description.toLowerCase().includes(query);
          var matchesFilter = currentFilter === 'Todos' || biz.category === currentFilter;
          return matchesQuery && matchesFilter;
        });
        renderGrid(filtered);
      });
    });
  }

  // ─── Chat Universal ─────────────────────────────────────────────────────
  function initChatPanel() {
    var backBtn = document.getElementById('explore-chat-back');
    var sendBtn = document.getElementById('explore-chat-send');
    var input = document.getElementById('explore-chat-input');

    if (backBtn) backBtn.addEventListener('click', closeChat);
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
    if (input) input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendChatMessage();
    });
  }

  function openChat(businessId, businessName, businessLogo) {
    activeChatBusiness = { id: businessId, name: businessName, logo: businessLogo };

    // Update header
    document.getElementById('chat-biz-name').textContent = businessName;
    document.getElementById('chat-biz-logo').textContent = businessLogo;

    // Clear messages
    var body = document.getElementById('explore-chat-body');
    body.innerHTML = `<div class="eteba-ai-msg eteba-ai-msg-bot">¡Hola! Soy el asistente de <strong>${businessName}</strong>. ¿En qué puedo ayudarte? Puedes preguntarme por productos, precios, envíos o hacer un pedido.</div>`;

    // Show chat, hide grid
    document.getElementById('explore-grid').style.display = 'none';
    document.querySelector('.explore__search').style.display = 'none';
    document.querySelector('.explore__filters').style.display = 'none';
    document.getElementById('explore-chat-panel').style.display = 'block';

    setTimeout(function() {
      document.getElementById('explore-chat-input').focus();
    }, 200);
  }

  function closeChat() {
    activeChatBusiness = null;
    document.getElementById('explore-chat-panel').style.display = 'none';
    document.getElementById('explore-grid').style.display = 'grid';
    document.querySelector('.explore__search').style.display = 'block';
    document.querySelector('.explore__filters').style.display = 'flex';
  }

  function addChatMessage(text, sender) {
    var body = document.getElementById('explore-chat-body');
    var msg = document.createElement('div');
    msg.className = 'eteba-ai-msg eteba-ai-msg-' + sender;
    if (sender === 'bot') {
      msg.innerHTML = text.replace(/\n/g, '<br>');
    } else {
      msg.textContent = text;
    }
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function renderChatProducts(products) {
    var body = document.getElementById('explore-chat-body');
    products.forEach(function(product) {
      if (!product.name) return;
      var card = document.createElement('div');
      card.className = 'eteba-ai-product-card';

      var imageUrl = product.image_url;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = 'https://rotteri.com/' + imageUrl;
      }

      var price = parseFloat(product.price || 0);
      var priceFormatted = price.toLocaleString('es-ES') + ' CFA';

      card.innerHTML =
        (imageUrl ? '<img src="' + imageUrl + '" class="eteba-ai-product-img" onerror="this.style.display=\'none\'">' : '<div class="eteba-ai-product-img-placeholder">&#128722;</div>') +
        '<div class="eteba-ai-product-info">' +
          '<div class="eteba-ai-product-name">' + product.name + '</div>' +
          '<div class="eteba-ai-product-price">' + priceFormatted + '</div>' +
          '<div class="eteba-ai-product-stock">' + (product.stock > 0 ? 'Disponible' : 'Agotado') + (product.origin ? ' · ' + product.origin : '') + '</div>' +
          (product.stock > 0 ? '<button class="eteba-ai-product-action" data-name="' + product.name + '">Encargar</button>' : '') +
        '</div>';

      var actionBtn = card.querySelector('.eteba-ai-product-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', function() {
          var name = this.getAttribute('data-name');
          if (!Auth.isLoggedIn()) {
            addChatMessage('Para hacer pedidos necesitas iniciar sesión.', 'bot');
            return;
          }
          document.getElementById('explore-chat-input').value = 'Quiero encargar el producto: ' + name;
          sendChatMessage();
        });
      }

      body.appendChild(card);
    });
    body.scrollTop = body.scrollHeight;
  }

  async function sendChatMessage() {
    var input = document.getElementById('explore-chat-input');
    var text = input.value.trim();
    if (!text || !activeChatBusiness) return;

    addChatMessage(text, 'user');
    input.value = '';

    // Typing indicator
    var body = document.getElementById('explore-chat-body');
    var typing = document.createElement('div');
    typing.className = 'eteba-ai-msg eteba-ai-msg-bot typing-indicator';
    typing.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    try {
      var payload = {
        tenantId: activeChatBusiness.id,
        prompt: text
      };

      // Enviar datos del usuario si logueado
      if (Auth.isLoggedIn()) {
        var user = Auth.getUser();
        payload.user = { id: user.id, name: user.name, email: user.email };
      }

      var resp = await fetch(API_BASE + '/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      var data = await resp.json();
      typing.remove();

      if (resp.ok && data.humanResponse) {
        addChatMessage(data.humanResponse, 'bot');
        if (data.results && data.results.length > 0 && data.type === 'SQL') {
          renderChatProducts(data.results);
        }
      } else {
        addChatMessage(data.error || 'Lo siento, hubo un problema.', 'bot');
      }
    } catch (err) {
      typing.remove();
      addChatMessage('Error de conexión. Intenta de nuevo.', 'bot');
    }
  }

  return { init };
})();
