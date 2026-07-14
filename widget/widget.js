/**
 * Eteba Chat — Widget Embebido v2.0
 * Diseño profesional con paleta de marca purple/blue/cyan
 * Multi-tenant | Product Cards | Auto-detect env
 */
(function() {
  'use strict';

  // 1. Localizar script tag y extraer config
  const scripts = document.getElementsByTagName('script');
  let currentScript = null;
  for (let i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.includes('widget.js')) {
      currentScript = scripts[i];
      break;
    }
  }

  if (!currentScript) {
    console.error('[Eteba Chat] No se pudo localizar el script tag.');
    return;
  }

  const scriptUrl = new URL(currentScript.src);
  const tenantId = scriptUrl.searchParams.get('tenant_id');

  if (!tenantId) {
    console.error('[Eteba Chat] Falta tenant_id en el script tag.');
    return;
  }

  // Auto-detect environment
  const scriptOrigin = new URL(currentScript.src).origin;
  const API_ENDPOINT = scriptOrigin + '/api/query';
  const PLATFORM_BASE = 'https://rotteri.com/';
  const widgetBaseUrl = currentScript.src.split('?')[0].replace('widget.js', '');

  // 2. Inyectar CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = widgetBaseUrl + 'widget.css';
  document.head.appendChild(cssLink);

  // 3. Inyectar DOM
  const uiHTML = `
    <div class="eteba-ai-widget-container" id="eteba-widget-container">
      <div class="eteba-ai-window" id="eteba-chat-window">
        <div class="eteba-ai-header">
          <div class="eteba-ai-avatar">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
          </div>
          <div class="eteba-ai-title">
            <h3>Asistente Virtual</h3>
            <p>En línea</p>
          </div>
        </div>

        <div class="eteba-ai-body" id="eteba-chat-body">
          <div class="eteba-ai-msg eteba-ai-msg-bot">
            ¡Hola! ¿En qué puedo ayudarte hoy?
          </div>
        </div>

        <div class="eteba-ai-footer">
          <input type="text" class="eteba-ai-input" id="eteba-chat-input" placeholder="Escribe un mensaje..." autocomplete="off">
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

  // 4. Referencias DOM
  const launcher = document.getElementById('eteba-chat-launcher');
  const windowNode = document.getElementById('eteba-chat-window');
  const bodyNode = document.getElementById('eteba-chat-body');
  const inputNode = document.getElementById('eteba-chat-input');
  const btnSend = document.getElementById('eteba-btn-send');
  const badgeNode = document.getElementById('eteba-chat-badge');

  let isOpen = false;

  // 5. Funciones
  function toggleChat() {
    isOpen = !isOpen;
    launcher.classList.toggle('eteba-open', isOpen);
    windowNode.classList.toggle('eteba-open', isOpen);
    if (isOpen) {
      badgeNode.classList.remove('eteba-active');
      setTimeout(function() { inputNode.focus(); }, 300);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    bodyNode.scrollTop = bodyNode.scrollHeight;
  }

  function addMessage(text, sender) {
    const msgDiv = document.createElement('div');
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
        ? '<img src="' + imageUrl + '" class="eteba-ai-product-img" alt="' + product.name + '" onerror="this.parentElement.innerHTML=\'<div class=eteba-ai-product-img-placeholder>&#128722;</div>\'">'
        : '<div class="eteba-ai-product-img-placeholder">&#128722;</div>';

      var priceFormatted = parseFloat(product.price).toLocaleString('es-ES') + ' CFA';
      var stockText = product.stock > 0 ? 'Disponible: ' + product.stock : 'Agotado';

      card.innerHTML =
        imgTag +
        '<div class="eteba-ai-product-info">' +
          '<div class="eteba-ai-product-name">' + product.name + '</div>' +
          '<div class="eteba-ai-product-price">' + priceFormatted + '</div>' +
          '<div class="eteba-ai-product-stock">' + stockText + '</div>' +
          (product.stock > 0 ? '<button class="eteba-ai-product-action" data-name="' + product.name + '">Encargar</button>' : '') +
        '</div>';

      var actionBtn = card.querySelector('.eteba-ai-product-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', function() {
          inputNode.value = 'Quiero encargar el producto: ' + this.getAttribute('data-name');
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
      var resp = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenantId, prompt: text })
      });

      var data = await resp.json();
      removeTyping();

      if (resp.ok && data.humanResponse) {
        addMessage(data.humanResponse, 'bot');

        if (data.type === 'SQL' && data.results && data.results.length > 0) {
          renderProductCards(data.results);
        }
      } else {
        addMessage(data.error || 'Lo siento, hubo un problema procesando tu consulta.', 'bot');
      }

      if (!isOpen) {
        badgeNode.classList.add('eteba-active');
      }
    } catch (err) {
      console.error('[Eteba Chat] Error:', err);
      removeTyping();
      addMessage('Error de conexión. Intenta de nuevo.', 'bot');
    } finally {
      btnSend.disabled = false;
    }
  }

  // 6. Event Listeners
  launcher.addEventListener('click', toggleChat);
  btnSend.addEventListener('click', sendMessage);
  inputNode.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  console.log('[Eteba Chat] Widget v2.0 cargado.');
})();
