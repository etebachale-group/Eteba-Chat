document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos de la UI ---
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarLeft = document.getElementById('toggle-sidebar-btn-left');
    const menuBtn = document.getElementById('menu-btn');
    
    const textarea = document.getElementById('chat-textarea');
    const sendBtn = document.getElementById('send-btn');
    
    const welcomeScreen = document.getElementById('welcome-screen');
    const messagesWrapper = document.getElementById('messages-wrapper');
    const chatContent = document.getElementById('chat-content');
    
    const suggestionCards = document.querySelectorAll('.suggestion-card');
    const newChatBtn = document.getElementById('new-chat-btn');
    
    const modelSelectorBtn = document.getElementById('model-selector-btn');
    const modelDropdown = document.getElementById('model-dropdown');
    const modelOptions = document.querySelectorAll('.model-option');
    
    const chatHistory = document.getElementById('chat-history');

    // --- Estado de la App ---
    let currentModel = 'gpt-4o';
    let activeChatId = '1';

    // --- 1. Control del Panel Lateral (Sidebar) ---
    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
        // Redimensionar íconos por si cambian de contenedor o estado
        setTimeout(() => lucide.createIcons(), 300);
    }

    if (toggleSidebarLeft) toggleSidebarLeft.addEventListener('click', toggleSidebar);
    if (menuBtn) menuBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        setTimeout(() => lucide.createIcons(), 300);
    });

    // Cerrar sidebar en pantallas pequeñas si se hace clic fuera de él
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !menuBtn.contains(e.target) && !sidebar.classList.contains('collapsed')) {
                sidebar.classList.add('collapsed');
            }
        }
    });

    // --- 2. Textarea Autoajustable ---
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight - 4) + 'px';
        
        // Habilitar / Deshabilitar botón de enviar
        if (textarea.value.trim() !== '') {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    });

    // --- 3. Envío de Mensajes & Simulación de Respuesta ---
    function scrollToBottom() {
        chatContent.scrollTo({
            top: chatContent.scrollHeight,
            behavior: 'smooth'
        });
    }

    function addMessage(sender, text) {
        const messageRow = document.createElement('div');
        messageRow.classList.add('message-row');
        messageRow.classList.add(sender === 'user' ? 'user-message' : 'assistant-message');

        let avatarHTML = '';
        if (sender === 'assistant') {
            avatarHTML = `
                <div class="message-avatar assistant-avatar">
                    <i data-lucide="aperture"></i>
                </div>
            `;
        }

        messageRow.innerHTML = `
            ${avatarHTML}
            <div class="message-bubble">
                <div class="message-text"></div>
            </div>
        `;

        messagesWrapper.appendChild(messageRow);
        lucide.createIcons();
        scrollToBottom();

        const textContainer = messageRow.querySelector('.message-text');

        if (sender === 'user') {
            textContainer.textContent = text;
        } else {
            // Efecto máquina de escribir para la respuesta del asistente
            let i = 0;
            const speed = 25; // milisegundos por carácter
            
            // Simular código markdown formateado si es oportuno
            const isCodeResponse = text.includes('```');
            
            if (isCodeResponse) {
                // Si incluye código, lo insertamos directamente con formato premium
                textContainer.innerHTML = formatMarkdown(text);
                lucide.createIcons();
                scrollToBottom();
            } else {
                // Texto normal con efecto máquina de escribir
                function typeWriter() {
                    if (i < text.length) {
                        textContainer.innerHTML += text.charAt(i);
                        i++;
                        scrollToBottom();
                        setTimeout(typeWriter, speed);
                    }
                }
                typeWriter();
            }
        }
    }

    // Formateador de Markdown ultra-simple para la UI estática
    function formatMarkdown(text) {
        // Formatear bloques de código ```js ... ```
        let formatted = text.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            return `<pre><code class="language-${lang || 'txt'}">${escapeHTML(code)}</code></pre>`;
        });
        // Formatear código en línea `code`
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Formatear párrafos
        formatted = formatted.split('\n\n').map(p => `<p>${p}</p>`).join('');
        return formatted;
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    async function simulateAssistantResponse(userText) {
        // ID de Tenant demo por defecto
        const testTenantId = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b';

        // 1. Mostrar indicador de carga/escribiendo
        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('message-row', 'assistant-message', 'typing-indicator-row');
        typingIndicator.innerHTML = `
            <div class="message-avatar assistant-avatar">
                <i data-lucide="aperture"></i>
            </div>
            <div class="message-bubble" style="background: transparent;">
                <div style="display: flex; gap: 4px; padding: 12px 16px; background: var(--bg-hover); border-radius: 18px; width: fit-content;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); animation: bounce 1.4s infinite both;"></span>
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); animation: bounce 1.4s infinite both 0.2s;"></span>
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); animation: bounce 1.4s infinite both 0.4s;"></span>
                </div>
            </div>
        `;
        
        // Registrar animación de rebote si no existiera
        if (!document.getElementById('typing-bounce-style')) {
            const style = document.createElement('style');
            style.id = 'typing-bounce-style';
            style.textContent = `
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1.0); }
                }
            `;
            document.head.appendChild(style);
        }
        
        messagesWrapper.appendChild(typingIndicator);
        lucide.createIcons();
        scrollToBottom();

        try {
            // 2. Realizar petición real al servidor Express de RAG
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: testTenantId, prompt: userText })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al conectar con el servidor RAG.');
            }

            const data = await response.json();
            
            // Remover indicador de carga
            typingIndicator.remove();

            // 3. Crear e inyectar el mensaje del asistente
            const messageRow = document.createElement('div');
            messageRow.classList.add('message-row', 'assistant-message');
            messageRow.innerHTML = `
                <div class="message-avatar assistant-avatar">
                    <i data-lucide="aperture"></i>
                </div>
                <div class="message-bubble">
                    <div class="message-text"></div>
                    <div class="audit-wrapper"></div>
                </div>
            `;
            messagesWrapper.appendChild(messageRow);
            lucide.createIcons();
            
            const textContainer = messageRow.querySelector('.message-text');
            const auditContainer = messageRow.querySelector('.audit-wrapper');

            // Pintar la respuesta humana y natural
            textContainer.innerHTML = formatMarkdown(data.humanResponse || 'No he podido generar una respuesta para tu consulta.');

            // 4. Formatear y construir el panel de auditoría técnica colapsable
            let auditContent = '';
            let detailData = '';

            if (data.type === 'SQL') {
                detailData += `
                    <div class="rag-badge sql-badge">
                        <i data-lucide="database" class="badge-icon"></i>
                        <span>Text-to-SQL (Datos Estructurados)</span>
                    </div>
                    <div class="sql-code-wrapper" style="margin-bottom: 12px;">
                        <pre><code>${escapeHTML(data.sql)}</code></pre>
                    </div>
                `;

                if (data.results && data.results.length > 0) {
                    let tableRows = '';
                    const headers = Object.keys(data.results[0]).filter(h => h !== 'tenant_id');
                    
                    tableRows += `<thead><tr>${headers.map(h => `<th>${escapeHTML(h.toUpperCase())}</th>`).join('')}</tr></thead>`;
                    tableRows += '<tbody>';
                    data.results.forEach(row => {
                        tableRows += `<tr>${headers.map(h => `<td>${escapeHTML(String(row[h]))}</td>`).join('')}</tr>`;
                    });
                    tableRows += '</tbody>';

                    detailData += `
                        <div class="table-container">
                            <table class="premium-table">${tableRows}</table>
                        </div>
                    `;
                } else {
                    detailData += `<p class="no-results-msg">No se encontraron productos coincidentes en el inventario.</p>`;
                }
            } else if (data.type === 'SEMANTIC') {
                detailData += `
                    <div class="rag-badge semantic-badge">
                        <i data-lucide="search" class="badge-icon"></i>
                        <span>Búsqueda Semántica (Hugging Face Local 384d)</span>
                    </div>
                    <p class="semantic-intro">Coincidencias encontradas en base de conocimiento:</p>
                `;

                if (data.results && data.results.length > 0) {
                    data.results.forEach((row, index) => {
                        const scorePct = Math.round(row.similarity * 100);
                        detailData += `
                            <div class="semantic-card">
                                <div class="card-header">
                                    <span class="card-num">#${index + 1}</span>
                                    <span class="card-score">Similitud: ${scorePct}%</span>
                                </div>
                                <div class="card-body">
                                    <p>${escapeHTML(row.content)}</p>
                                </div>
                            </div>
                        `;
                    });
                } else {
                    detailData += `<p class="no-results-msg">No se encontraron referencias semánticas en la base de datos.</p>`;
                }
            }

            // Construir el acordeón técnico
            auditContent = `
                <div class="technical-audit-accordion">
                    <button class="accordion-trigger">
                        <span>Ver Datos de Respaldo (RAG Audit)</span>
                        <i data-lucide="chevron-down"></i>
                    </button>
                    <div class="accordion-content">
                        ${detailData}
                    </div>
                </div>
            `;

            auditContainer.innerHTML = auditContent;
            lucide.createIcons();

            // Agregar evento de apertura/cierre para el acordeón
            const accordion = auditContainer.querySelector('.technical-audit-accordion');
            const trigger = accordion.querySelector('.accordion-trigger');
            trigger.addEventListener('click', () => {
                accordion.classList.toggle('open');
                scrollToBottom();
            });

            scrollToBottom();

        } catch (err) {
            console.error(err);
            typingIndicator.remove();
            
            // Mostrar error visual
            addMessage('assistant', `❌ Error: ${err.message || 'No se pudo obtener respuesta de la API.'}`);
        }
    }

    function handleSendMessage() {
        const text = textarea.value.trim();
        if (text === '') return;

        // Ocultar pantalla de bienvenida en el primer mensaje
        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            messagesWrapper.style.display = 'flex';
        }

        // Añadir mensaje del usuario
        addMessage('user', text);
        
        // Limpiar entrada
        textarea.value = '';
        textarea.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');

        // Simular respuesta del asistente
        simulateAssistantResponse(text);
    }

    sendBtn.addEventListener('click', handleSendMessage);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // --- 4. Clic en las sugerencias de la pantalla de bienvenida ---
    suggestionCards.forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.getAttribute('data-prompt');
            textarea.value = prompt;
            textarea.dispatchEvent(new Event('input')); // disparar input para ajustar altura y habilitar botón
            handleSendMessage();
        });
    });

    // --- 5. Selector de Modelos (Dropdown) ---
    modelSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdown.classList.toggle('show');
    });

    modelOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            modelOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            currentModel = option.getAttribute('data-model');
            const modelName = option.querySelector('.model-name').textContent;
            
            // Actualizar texto del botón selector
            modelSelectorBtn.querySelector('span').textContent = `Eteba RAG Engine (${modelName})`;
            
            modelDropdown.classList.remove('show');
        });
    });

    document.addEventListener('click', () => {
        modelDropdown.classList.remove('show');
    });

    // --- 6. Historial de Chats & Nuevo Chat ---
    newChatBtn.addEventListener('click', () => {
        // Desmarcar todos del historial
        document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));
        
        // Mostrar pantalla de bienvenida y vaciar mensajes
        welcomeScreen.style.display = 'flex';
        messagesWrapper.style.display = 'none';
        messagesWrapper.innerHTML = '';
        
        // Resetear input
        textarea.value = '';
        textarea.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');
        
        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
        }
    });

    // Manejar clics en ítems del historial
    chatHistory.addEventListener('click', (e) => {
        const historyItem = e.target.closest('.history-item');
        if (!historyItem) return;

        // Si se hace clic en renombrar o borrar, no cambiamos de chat
        if (e.target.classList.contains('rename-btn') || e.target.classList.contains('delete-btn')) {
            e.stopPropagation();
            if (e.target.classList.contains('delete-btn')) {
                if (confirm('¿Estás seguro de que quieres eliminar esta conversación?')) {
                    historyItem.remove();
                    // Si eliminamos el activo, creamos nuevo chat
                    if (historyItem.classList.contains('active')) {
                        newChatBtn.click();
                    }
                }
            } else if (e.target.classList.contains('rename-btn')) {
                const titleSpan = historyItem.querySelector('.item-title');
                const newTitle = prompt('Renombrar conversación:', titleSpan.textContent);
                if (newTitle && newTitle.trim() !== '') {
                    titleSpan.textContent = newTitle.trim();
                }
            }
            return;
        }

        // Marcar activo
        document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));
        historyItem.classList.add('active');
        
        // Cargar conversación simulada
        welcomeScreen.style.display = 'none';
        messagesWrapper.style.display = 'flex';
        messagesWrapper.innerHTML = '';
        
        const chatTitle = historyItem.querySelector('.item-title').textContent;
        
        // Simular algunos mensajes antiguos de este chat
        addMessage('user', `Revisar sesión de: ${chatTitle}`);
        
        setTimeout(() => {
            if (chatTitle.toLowerCase().includes('inventario') || chatTitle.toLowerCase().includes('stock')) {
                addMessage('assistant', "Bienvenido al canal de control de inventario. Aquí puedes consultar el stock, nombres y precios de productos en tiempo real mediante consultas SQL seguras.");
            } else if (chatTitle.toLowerCase().includes('políticas') || chatTitle.toLowerCase().includes('devoluciones')) {
                addMessage('assistant', "Este es el canal de base de conocimiento corporativa. Puedes consultarme sobre políticas de devoluciones, manuales operativos o reglas de negocio.");
            } else {
                addMessage('assistant', `Hola, estás en la sesión activa de "${chatTitle}". ¿En qué automatización de ventas o soporte te gustaría trabajar hoy?`);
            }
        }, 300);

        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
        }
    });
});
