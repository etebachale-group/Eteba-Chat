/**
 * Eteba Chat - Embeddable Chat Widget v1.1 (Rotteri Integration)
 * - Multi-tenant: fetches catalog and custom manual using tenant_id
 * - Premium Glassmorphism UI matching Eteba theme
 * - Rich Product Cards: automatically renders product images and prices in the chat feed
 */
(function() {
  // 1. Obtener configuración del script tag actual de forma robusta
  const scripts = document.getElementsByTagName('script');
  let currentScript = null;
  for (let i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.includes('widget.js')) {
      currentScript = scripts[i];
      break;
    }
  }

  if (!currentScript) {
    console.error('[Eteba Chat] Error: No se pudo localizar el script tag de widget.js.');
    return;
  }

  const scriptUrl = new URL(currentScript.src);
  const tenantId = scriptUrl.searchParams.get('tenant_id');

  if (!tenantId) {
    console.error('[Eteba Chat] Error: No se proporcionó un tenant_id en el script tag.');
    return;
  }

  // Detectar entorno: en producción usa la URL de Render, en local usa localhost
  const scriptOrigin = new URL(currentScript.src).origin;
  const API_ENDPOINT = scriptOrigin + '/api/query';
  const ROTTERI_PLATFORM_BASE = 'https://rotteri.com/'; // URL base para cargar imágenes del catálogo de Rotteri
  const widgetBaseUrl = currentScript.src.split('?')[0].replace('widget.js', '');

  // 2. Inyectar CSS
  const cssLink = document.createElement('link');
  cssLink.rel   = 'stylesheet';
  cssLink.href  = widgetBaseUrl + 'widget.css';
  document.head.appendChild(cssLink);

  // 3. Inyectar DOM (UI flotante)
  const uiHTML = `
    <div class="eteba-ai-widget-container" id="eteba-widget-container">
      <!-- Ventana de Chat -->
      <div class="eteba-ai-window" id="eteba-chat-window">
        <div class="eteba-ai-header">
          <div class="eteba-ai-avatar">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
            </svg>
          </div>
          <div class="eteba-ai-title">
            <h3>Asistente Virtual</h3>
            <p>En línea</p>
          </div>
        </div>

        <div class="eteba-ai-body" id="eteba-chat-body">
          <div class="eteba-ai-msg eteba-ai-msg-bot">
            ¡Hola! 👋 ¿En qué puedo ayudarte hoy?
          </div>
        </div>

        <div class="eteba-ai-footer">
          <input type="text" class="eteba-ai-input" id="eteba-chat-input" placeholder="Escribe un mensaje..." autocomplete="off">
          <button class="eteba-ai-send" id="eteba-btn-send">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        <div class="eteba-ai-watermark">
          Powered by <a href="https://eteba.ai" target="_blank">Eteba Chat</a>
        </div>
      </div>

      <!-- Launcher Button -->
      <div class="eteba-ai-launcher" id="eteba-chat-launcher">
        <svg class="eteba-icon-chat" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
        <svg class="eteba-icon-close" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
        <div class="eteba-ai-badge" id="eteba-chat-badge"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', uiHTML);

  // 4. Referencias a DOM
  const launcher  = document.getElementById('eteba-chat-launcher');
  const windowNode = document.getElementById('eteba-chat-window');
  const bodyNode   = document.getElementById('eteba-chat-body');
  const inputNode  = document.getElementById('eteba-chat-input');
  const btnSend    = document.getElementById('eteba-btn-send');
  const badgeNode  = document.getElementById('eteba-chat-badge');

  let isOpen = false;

  const toggleChat = () => {
    isOpen = !isOpen;
    if (isOpen) {
      launcher.classList.add('eteba-open');
      windowNode.classList.add('eteba-open');
      badgeNode.classList.remove('eteba-active');
      setTimeout(() => inputNode.focus(), 300);
      scrollToBottom();
    } else {
      launcher.classList.remove('eteba-open');
      windowNode.classList.remove('eteba-open');
    }
  };

  const scrollToBottom = () => {
    bodyNode.scrollTop = bodyNode.scrollHeight;
  };

  const addMessage = (text, sender) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = `eteba-ai-msg eteba-ai-msg-${sender}`;
    
    // Permitir saltos de línea para respuestas del bot
    if (sender === 'bot') {
      msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    } else {
      msgDiv.innerText = text;
    }
    
    bodyNode.appendChild(msgDiv);
    scrollToBottom();
  };

  /**
   * Renderiza tarjetas interactivas de producto con imagen, precio y CTA.
   */
  const renderProductCards = (products) => {
    products.forEach(product => {
      // Ignorar si no es un producto válido del catálogo
      if (!product.name) return;

      const card = document.createElement('div');
      card.className = 'eteba-ai-product-card';

      // Construir ruta absoluta para la imagen
      let imageUrl = product.image_url;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = ROTTERI_PLATFORM_BASE + imageUrl;
      }
      
      const imgTag = imageUrl 
        ? `<img src="${imageUrl}" class="eteba-ai-product-img" alt="${product.name}" onerror="this.src='${ROTTERI_PLATFORM_BASE}assets/img/logo.png'">`
        : `<div class="eteba-ai-product-img-placeholder">🛍️</div>`;

      // Formatear precio
      const priceFormatted = parseFloat(product.price).toLocaleString('es-ES') + ' CFA';
      const stockText = product.stock > 0 ? `Stock: ${product.stock} disp.` : 'Agotado';

      card.innerHTML = `
        ${imgTag}
        <div class="eteba-ai-product-info">
          <div class="eteba-ai-product-name">${product.name}</div>
          <div class="eteba-ai-product-price">${priceFormatted}</div>
          <div class="eteba-ai-product-stock">${stockText}</div>
          ${product.stock > 0 ? `<button class="eteba-ai-product-action" data-name="${product.name}">Encargar</button>` : ''}
        </div>
      `;

      // Event listener para el botón de encargo rápido (auto-envío)
      const actionBtn = card.querySelector('.eteba-ai-product-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', function() {
          const prodName = this.getAttribute('data-name');
          inputNode.value = `Quiero encargar el producto: ${prodName}`;
          // Auto-enviar sin que el usuario tenga que presionar Enter
          sendMessage();
        });
      }

      bodyNode.appendChild(card);
    });
    scrollToBottom();
  };

  const showTypingIndicator = () => {
    const indicator = document.createElement('div');
    indicator.className = 'eteba-ai-msg eteba-ai-msg-bot typing-indicator';
    indicator.innerHTML = `
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    `;
    bodyNode.appendChild(indicator);
    scrollToBottom();
  };

  const removeTypingIndicator = () => {
    const el = document.querySelector('.typing-indicator');
    if (el) el.remove();
  };

  const sendMessage = async () => {
    const text = inputNode.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    inputNode.value = '';
    btnSend.disabled = true;

    showTypingIndicator();

    try {
      const resp = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tenantId: tenantId, 
          prompt: text 
        })
      });
      
      const data = await resp.json();
      removeTypingIndicator();

      if (resp.ok && data.humanResponse) {
        // 1. Agregar el mensaje de texto de la IA
        addMessage(data.humanResponse, 'bot');

        // 2. Si es una consulta de inventario (SQL) y contiene productos con imagen/detalles, renderizar las tarjetas
        if (data.type === 'SQL' && data.results && data.results.length > 0) {
          renderProductCards(data.results);
        }
      } else {
        const errorMsg = data.error || 'Lo siento, hubo un problema al procesar la respuesta.';
        addMessage(errorMsg, 'bot');
      }

      if (!isOpen) {
        badgeNode.classList.add('eteba-active');
      }
    } catch (err) {
      console.error('[Eteba Chat] Error de conexión', err);
      removeTypingIndicator();
      addMessage('Error de conexión con el asistente virtual.', 'bot');
    } finally {
      btnSend.disabled = false;
    }
  };

  // 5. Event Listeners
  launcher.addEventListener('click', toggleChat);
  btnSend.addEventListener('click', sendMessage);
  inputNode.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

  console.log('[Eteba Chat] Widget de soporte multi-tenant cargado.');
})();
