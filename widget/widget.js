/**
 * Eteba Chat — Widget Embebido v3.0
 * Autenticación vía Rotteri | Smart Search | Checkout Flow
 */
(function() {
  'use strict';

  // 1. Localizar script y config
  var scripts = document.getElementsByTagName('script');
  var currentScript = null;
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.includes('widget.js')) {
      currentScript = scripts[i];
      break;
    }
  }
  if (!currentScript) return;

  var scriptUrl = new URL(currentScript.src);
  var tenantId = scriptUrl.searchParams.get('tenant_id');
  if (!tenantId) return;

  var scriptOrigin = scriptUrl.origin;
  var API_ENDPOINT = scriptOrigin + '/api/query';
  var PLATFORM_BASE = 'https://rotteri.com/';
  var widgetBaseUrl = currentScript.src.split('?')[0].replace('widget.js', '');

  // 2. Leer datos de usuario inyectados por Rotteri
  var etebaUser = window.__ETEBA_CHAT_USER__ || { logged: false };

  // 3. Inyectar CSS
  var cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = widgetBaseUrl + 'widget.css';
  document.head.appendChild(cssLink);

  // 4. Inyectar DOM
  var uiHTML = `
    <div class="eteba-ai-widget-container" id="eteba-widget-container">
      <div class="eteba-ai-window" id="eteba-chat-window">
        <div class="eteba-ai-header">
          <div class="eteba-ai-avatar">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
          </div>
          <div class="eteba-ai-title">
            <h3>Asistente de Compras</h3>
            <p>En línea</p>
          </div>
        </div>

        <!-- Login Panel (shown when not authenticated) -->
        <div class="eteba-ai-login-panel" id="eteba-login-panel" style="display:none;">
          <div class="eteba-login-content">
            <div class="eteba-login-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            </div>
            <h4>Inicia Sesión</h4>
            <p>Para usar el asistente de compras necesitas una cuenta en Rotteri</p>
            <button class="eteba-login-btn" id="eteba-google-login">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continuar con Google
            </button>
            <button class="eteba-login-explore" id="eteba-explore-btn">Explorar sin cuenta</button>
          </div>
        </div>

        <!-- Chat Body (shown when authenticated or exploring) -->
        <div class="eteba-ai-body" id="eteba-chat-body" style="display:none;">
          <div class="eteba-ai-msg eteba-ai-msg-bot">
            ¡Hola${etebaUser.logged ? ' ' + (etebaUser.name || '').split(' ')[0] : ''}! ¿En qué puedo ayudarte hoy?
          </div>
        </div>

        <div class="eteba-ai-footer" id="eteba-chat-footer" style="display:none;">
          <input type="text" class="eteba-ai-input" id="eteba-chat-input" placeholder="Buscar productos, preguntar precios..." autocomplete="off">
          <button class="eteba-ai-send" id="eteba-btn-send">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div class="eteba-ai-watermark">
          Powered by <a href="https://eteba-chat.onrender.com" target="_blank">Eteba Chat</a>
        </div>
      </div>

      <div class="eteba-ai-launcher" id="eteba-chat-launcher">
        <svg class="eteba-icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
        <svg class="eteba-icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        <div class="eteba-ai-badge" id="eteba-chat-badge"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', uiHTML);

  // 5. Referencias DOM
  var launcher = document.getElementById('eteba-chat-launcher');
  var windowNode = document.getElementById('eteba-chat-window');
  var bodyNode = document.getElementById('eteba-chat-body');
  var footerNode = document.getElementById('eteba-chat-footer');
  var loginPanel = document.getElementById('eteba-login-panel');
  var inputNode = document.getElementById('eteba-chat-input');
  var btnSend = document.getElementById('eteba-btn-send');
  var badgeNode = document.getElementById('eteba-chat-badge');
  var googleLoginBtn = document.getElementById('eteba-google-login');
  var exploreBtn = document.getElementById('eteba-explore-btn');

  var isOpen = false;
  var isExploreMode = false;

  // 6. Inicializar vista según auth
  function initView() {
    if (etebaUser.logged) {
      loginPanel.style.display = 'none';
      bodyNode.style.display = 'flex';
      footerNode.style.display = 'flex';
    } else {
      loginPanel.style.display = 'flex';
      bodyNode.style.display = 'none';
      footerNode.style.display = 'none';
    }
  }
  initView();

  // 7. Funciones
  function toggleChat() {
    isOpen = !isOpen;
    launcher.classList.toggle('eteba-open', isOpen);
    windowNode.classList.toggle('eteba-open', isOpen);
    if (isOpen) {
      badgeNode.classList.remove('eteba-active');
      if (etebaUser.logged || isExploreMode) {
        setTimeout(function() { inputNode.focus(); }, 300);
      }
      scrollToBottom();
    }
  }

  function enableChat() {
    isExploreMode = true;
    loginPanel.style.display = 'none';
    bodyNode.style.display = 'flex';
    footerNode.style.display = 'flex';
    setTimeout(function() { inputNode.focus(); }, 100);
  }

  function scrollToBottom() {
    bodyNode.scrollTop = bodyNode.scrollHeight;
  }

  function addMessage(text, sender) {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'eteba-ai-msg eteba-ai-msg-' + sender;
    if (sender === 'bot') {
      msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    } else {
      msgDiv.textContent = text;
    }
    bodyNode.appendChild(msgDiv);
    scrollToBottom();
  }

  function renderProductCards(products) {
    products.forEach(function(product) {
      if (!product.name) return;
      var card = document.createElement('div');
      card.className = 'eteba-ai-product-card';

      var imageUrl = product.image_url;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = PLATFORM_BASE + imageUrl;
      }

      var imgTag = imageUrl
        ? '<img src="' + imageUrl + '" class="eteba-ai-product-img" alt="' + product.name + '" onerror="this.style.display=\'none\'">'
        : '<div class="eteba-ai-product-img-placeholder">&#128722;</div>';

      var price = parseFloat(product.price || 0);
      var priceFormatted = price.toLocaleString('es-ES') + ' CFA';
      var stockText = product.stock > 0 ? 'Disponible' : 'Agotado';
      var origin = product.origin ? '<span class="eteba-ai-product-origin">' + product.origin + '</span>' : '';

      card.innerHTML =
        imgTag +
        '<div class="eteba-ai-product-info">' +
          '<div class="eteba-ai-product-name">' + product.name + '</div>' +
          '<div class="eteba-ai-product-price">' + priceFormatted + '</div>' +
          '<div class="eteba-ai-product-stock">' + stockText + origin + '</div>' +
          (product.stock > 0 ? '<button class="eteba-ai-product-action" data-name="' + product.name + '">Encargar</button>' : '') +
        '</div>';

      var actionBtn = card.querySelector('.eteba-ai-product-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', function() {
          var name = this.getAttribute('data-name');
          if (!etebaUser.logged) {
            addMessage('Para hacer pedidos necesitas iniciar sesión.', 'bot');
            return;
          }
          inputNode.value = 'Quiero encargar el producto: ' + name;
          sendMessage();
        });
      }

      bodyNode.appendChild(card);
    });
    scrollToBottom();
  }

  function showTyping() {
    var indicator = document.createElement('div');
    indicator.className = 'eteba-ai-msg eteba-ai-msg-bot typing-indicator';
    indicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    bodyNode.appendChild(indicator);
    scrollToBottom();
  }

  function removeTyping() {
    var el = document.querySelector('.typing-indicator');
    if (el) el.remove();
  }

  async function sendMessage() {
    var text = inputNode.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    inputNode.value = '';
    btnSend.disabled = true;
    showTyping();

    try {
      var payload = {
        tenantId: tenantId,
        prompt: text
      };

      // Enviar datos del usuario si está logueado
      if (etebaUser.logged) {
        payload.user = {
          id: etebaUser.id,
          name: etebaUser.name,
          phone: etebaUser.phone
        };
      }

      var resp = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      var data = await resp.json();
      removeTyping();

      if (resp.ok && data.humanResponse) {
        addMessage(data.humanResponse, 'bot');
        if (data.results && data.results.length > 0 && data.type === 'SQL') {
          renderProductCards(data.results);
        }
      } else {
        addMessage(data.error || 'Lo siento, hubo un problema. Intenta de nuevo.', 'bot');
      }

      if (!isOpen) {
        badgeNode.classList.add('eteba-active');
      }
    } catch (err) {
      removeTyping();
      addMessage('Error de conexión. Intenta de nuevo.', 'bot');
    } finally {
      btnSend.disabled = false;
    }
  }

  // 8. Event Listeners
  launcher.addEventListener('click', toggleChat);
  btnSend.addEventListener('click', sendMessage);
  inputNode.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  // Login button
  googleLoginBtn.addEventListener('click', function() {
    var loginUrl = etebaUser.loginUrl || 'https://rotteri.com/login';
    window.location.href = loginUrl;
  });

  // Explore without account
  exploreBtn.addEventListener('click', function() {
    enableChat();
    addMessage('Estás explorando sin cuenta. Puedes buscar productos y consultar precios, pero para hacer pedidos necesitarás iniciar sesión.', 'bot');
  });

  console.log('[Eteba Chat] Widget v3.0 | User:', etebaUser.logged ? etebaUser.name : 'Guest');
})();
