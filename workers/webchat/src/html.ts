export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login · Messages</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      color: #262626;
    }
    .card {
      background: white;
      border: 1px solid #dbdbdb;
      border-radius: 12px;
      padding: 40px 32px;
      width: 100%;
      max-width: 360px;
    }
    .logo {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #833ab4, #c13584, #e1306c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 28px;
    }
    .field { margin-bottom: 12px; }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #dbdbdb;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
      background: #fafafa;
    }
    input:focus { border-color: #a8a8a8; background: white; }
    .btn {
      width: 100%;
      padding: 10px;
      margin-top: 8px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(90deg, #833ab4, #c13584, #e1306c);
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .error {
      color: #ed4956;
      font-size: 13px;
      text-align: center;
      margin-top: 12px;
      min-height: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Messages</div>
    <div class="field"><input id="login" type="text" placeholder="Username" autocomplete="username"></div>
    <div class="field"><input id="password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="onKey(event)"></div>
    <button class="btn" id="btn" onclick="submit()">Sign in</button>
    <div class="error" id="err"></div>
  </div>
  <script>
    async function submit() {
      const login = document.getElementById('login').value.trim();
      const password = document.getElementById('password').value;
      if (!login || !password) return;
      const btn = document.getElementById('btn');
      btn.disabled = true;
      document.getElementById('err').textContent = '';
      try {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password }),
        });
        if (r.ok) { window.location.href = '/'; return; }
        const data = await r.json().catch(() => ({}));
        document.getElementById('err').textContent = data.error || 'Login failed';
      } catch {
        document.getElementById('err').textContent = 'Network error';
      }
      btn.disabled = false;
    }
    function onKey(e) { if (e.key === 'Enter') submit(); }
    document.getElementById('login').focus();
  </script>
</body>
</html>`;

// {{LOGIN}} is replaced server-side with the authenticated user's login (HTML-escaped)
export const CHAT_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Messages</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      background: #fff;
      color: #262626;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: 350px;
      min-width: 350px;
      border-right: 1px solid #dbdbdb;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .sidebar-header {
      padding: 16px 16px 14px;
      border-bottom: 1px solid #dbdbdb;
    }

    .sidebar-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.3px;
      background: linear-gradient(90deg, #833ab4, #c13584, #e1306c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .user-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      margin-bottom: 2px;
    }

    .user-name {
      font-size: 12px;
      color: #8e8e8e;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .logout-btn {
      background: none;
      border: none;
      color: #8e8e8e;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }
    .logout-btn:hover { color: #262626; background: #f0f0f0; }

    .new-chat-btn {
      margin-top: 10px;
      width: 100%;
      padding: 9px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(90deg, #833ab4, #c13584, #e1306c);
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .new-chat-btn:hover { opacity: 0.85; }

    .chat-list { flex: 1; overflow-y: auto; }

    .chat-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f5f5f5;
      transition: background 0.1s;
    }
    .chat-item:hover { background: #fafafa; }
    .chat-item.active { background: #f0f0f0; }

    .avatar {
      width: 44px;
      height: 44px;
      min-width: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #833ab4, #e1306c, #fcb045);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 16px;
    }
    .avatar.sm {
      width: 36px;
      height: 36px;
      min-width: 36px;
      font-size: 13px;
    }

    .chat-info { flex: 1; min-width: 0; }
    .chat-name {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .delete-btn {
      background: none;
      border: none;
      color: #c7c7c7;
      font-size: 20px;
      cursor: pointer;
      padding: 4px 6px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
      border-radius: 50%;
    }
    .chat-item:hover .delete-btn { opacity: 1; }
    .delete-btn:hover { color: #ed4956; background: #ffeef0; }

    .empty-sidebar {
      padding: 24px 16px;
      text-align: center;
      color: #8e8e8e;
      font-size: 13px;
    }

    /* ── Main ── */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100vh;
    }

    .main-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid #dbdbdb;
      min-height: 62px;
    }

    .main-title {
      font-size: 15px;
      font-weight: 600;
      color: #8e8e8e;
    }
    .main-title.active { color: #262626; }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #8e8e8e;
      gap: 10px;
      height: 100%;
    }
    .empty-state .icon { font-size: 52px; opacity: 0.25; }
    .empty-state p { font-size: 14px; }

    .msg-wrap { display: flex; flex-direction: column; }
    .msg-wrap.user { align-items: flex-end; }
    .msg-wrap.assistant { align-items: flex-start; }

    .msg-wrap + .msg-wrap { margin-top: 2px; }
    .msg-wrap.user + .msg-wrap.assistant,
    .msg-wrap.assistant + .msg-wrap.user { margin-top: 10px; }

    .bubble {
      max-width: 65%;
      padding: 10px 16px;
      border-radius: 22px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
    }
    .bubble.user {
      background: linear-gradient(135deg, #833ab4, #c13584, #e1306c);
      color: white;
      border-bottom-right-radius: 5px;
    }
    .bubble.assistant {
      background: #efefef;
      color: #262626;
      border-bottom-left-radius: 5px;
    }

    /* ── Typing indicator ── */
    .bubble.typing {
      padding: 12px 18px;
      display: flex;
      gap: 5px;
      align-items: center;
    }
    .bubble.typing span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #aaa;
      animation: bounce 1.1s infinite;
    }
    .bubble.typing span:nth-child(2) { animation-delay: 0.18s; }
    .bubble.typing span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
      30% { transform: translateY(-5px); opacity: 1; }
    }

    /* ── Input ── */
    .input-area {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-top: 1px solid #dbdbdb;
    }

    .msg-input {
      flex: 1;
      padding: 10px 18px;
      border: 1px solid #dbdbdb;
      border-radius: 22px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
      background: transparent;
    }
    .msg-input:focus { border-color: #a8a8a8; }
    .msg-input:disabled { background: #fafafa; cursor: not-allowed; }

    .send-btn {
      background: none;
      border: none;
      color: #0095f6;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      padding: 6px 4px;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .send-btn:disabled { opacity: 0.35; cursor: default; }
    .send-btn:not(:disabled):hover { opacity: 0.7; }
  </style>
</head>
<body>

  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">Messages</div>
      <div class="user-bar">
        <span class="user-name">{{LOGIN}}</span>
        <button class="logout-btn" onclick="logout()">Sign out</button>
      </div>
      <button class="new-chat-btn" onclick="newChat()">+ New Chat</button>
    </div>
    <div class="chat-list" id="chatList"></div>
  </div>

  <div class="main">
    <div class="main-header">
      <div class="avatar sm" id="mainAvatar" style="display:none"></div>
      <div class="main-title" id="mainTitle">Select a chat</div>
    </div>
    <div class="messages" id="messages">
      <div class="empty-state">
        <div class="icon">💬</div>
        <p>Select a chat or create a new one</p>
      </div>
    </div>
    <div class="input-area">
      <input class="msg-input" id="msgInput" type="text" placeholder="Message..." disabled onkeydown="onKey(event)">
      <button class="send-btn" id="sendBtn" onclick="send()" disabled>Send</button>
    </div>
  </div>

  <script>
    let current = null;
    let chats = [];
    let activeStream = null;

    async function init() {
      const r = await fetch('/api/chats');
      if (r.status === 401) { window.location.href = '/login'; return; }
      chats = await r.json();
      renderSidebar();
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    function renderSidebar() {
      const el = document.getElementById('chatList');
      if (!chats.length) {
        el.innerHTML = '<div class="empty-sidebar">No chats yet</div>';
        return;
      }
      el.innerHTML = chats.map(c => \`
        <div class="chat-item \${c.id === current ? 'active' : ''}" onclick="select('\${c.id}')">
          <div class="avatar">\${esc(c.name[0]).toUpperCase()}</div>
          <div class="chat-info"><div class="chat-name">\${esc(c.name)}</div></div>
          <button class="delete-btn" onclick="del(event,'\${c.id}')">×</button>
        </div>
      \`).join('');
    }

    async function newChat() {
      const name = 'Chat ' + new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
      const r = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const chat = await r.json();
      chats.unshift(chat);
      renderSidebar();
      select(chat.id);
    }

    async function del(e, id) {
      e.stopPropagation();
      if (activeStream) { activeStream.close(); activeStream = null; }
      await fetch(\`/api/chats/\${id}\`, { method: 'DELETE' });
      chats = chats.filter(c => c.id !== id);
      if (current === id) resetMain();
      renderSidebar();
    }

    async function select(id) {
      if (activeStream) { activeStream.close(); activeStream = null; }
      current = id;
      const chat = chats.find(c => c.id === id);
      const av = document.getElementById('mainAvatar');
      av.textContent = chat.name[0].toUpperCase();
      av.style.display = 'flex';
      const title = document.getElementById('mainTitle');
      title.textContent = chat.name;
      title.classList.add('active');
      document.getElementById('msgInput').disabled = false;
      document.getElementById('sendBtn').disabled = false;
      document.getElementById('msgInput').focus();
      renderSidebar();
      const r = await fetch(\`/api/chats/\${id}/messages\`);
      renderMsgs(await r.json());
    }

    function resetMain() {
      if (activeStream) { activeStream.close(); activeStream = null; }
      current = null;
      document.getElementById('mainAvatar').style.display = 'none';
      const title = document.getElementById('mainTitle');
      title.textContent = 'Select a chat';
      title.classList.remove('active');
      document.getElementById('msgInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
      document.getElementById('messages').innerHTML =
        '<div class="empty-state"><div class="icon">💬</div><p>Select a chat or create a new one</p></div>';
    }

    function renderMsgs(msgs) {
      const el = document.getElementById('messages');
      if (!msgs.length) {
        el.innerHTML = '<div class="empty-state"><p>Send a message to start chatting</p></div>';
        return;
      }
      el.innerHTML = msgs.map(m => \`
        <div class="msg-wrap \${m.role}">
          <div class="bubble \${m.role}">\${esc(m.content)}</div>
        </div>
      \`).join('');
      el.scrollTop = el.scrollHeight;
    }

    function appendMsg(msg) {
      const el = document.getElementById('messages');
      const empty = el.querySelector('.empty-state');
      if (empty) empty.remove();
      const wrap = document.createElement('div');
      wrap.className = \`msg-wrap \${msg.role}\`;
      wrap.innerHTML = \`<div class="bubble \${msg.role}">\${esc(msg.content)}</div>\`;
      el.appendChild(wrap);
      el.scrollTop = el.scrollHeight;
    }

    function showTyping() {
      const el = document.getElementById('messages');
      const empty = el.querySelector('.empty-state');
      if (empty) empty.remove();
      const wrap = document.createElement('div');
      wrap.className = 'msg-wrap assistant';
      wrap.id = 'typing-indicator';
      wrap.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span></div>';
      el.appendChild(wrap);
      el.scrollTop = el.scrollHeight;
    }

    function hideTyping() {
      const t = document.getElementById('typing-indicator');
      if (t) t.remove();
    }

    function setInputBusy(busy) {
      document.getElementById('msgInput').disabled = busy;
      document.getElementById('sendBtn').disabled = busy;
    }

    async function send() {
      const input = document.getElementById('msgInput');
      const content = input.value.trim();
      if (!content || !current) return;

      if (activeStream) { activeStream.close(); activeStream = null; }

      input.value = '';
      setInputBusy(true);
      appendMsg({ role: 'user', content });
      showTyping();

      // Use the server-returned timestamp as the SSE 'after' boundary.
      // Client Date.now() can differ from server time, causing the filter
      // m.timestamp > after to silently miss the agent's reply.
      const res = await fetch(\`/api/chats/\${current}/messages\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const userMsg = await res.json();
      const afterTs = userMsg.timestamp;

      const chatId = current;
      const es = new EventSource(\`/api/chats/\${chatId}/stream?after=\${afterTs}\`);
      activeStream = es;

      es.onmessage = (e) => {
        if (current !== chatId) { es.close(); return; }
        hideTyping();
        appendMsg(JSON.parse(e.data));
        es.close();
        activeStream = null;
        setInputBusy(false);
        input.focus();
      };

      es.onerror = () => {
        es.close();
        activeStream = null;
        // SSE timed out — agent may still be working. Keep typing indicator
        // visible and poll until the reply arrives (up to ~90 seconds total).
        if (current === chatId) {
          pollForReply(chatId, afterTs, 0, input);
        } else {
          hideTyping();
          setInputBusy(false);
        }
      };
    }

    async function pollForReply(chatId, after, attempt, input) {
      if (current !== chatId || attempt >= 18) {
        hideTyping();
        setInputBusy(false);
        return;
      }
      try {
        const r = await fetch(\`/api/chats/\${chatId}/messages\`);
        if (!r.ok) { hideTyping(); setInputBusy(false); return; }
        const msgs = await r.json();
        const fresh = msgs.filter(m => m.role === 'assistant' && m.timestamp > after);
        if (fresh.length > 0) {
          hideTyping();
          fresh.forEach(m => appendMsg(m));
          setInputBusy(false);
          input.focus();
          return;
        }
      } catch {}
      // Not found yet — retry with linear backoff (3s → 5s → 5s → …)
      const delay = attempt < 2 ? 3000 : 5000;
      setTimeout(() => pollForReply(chatId, after, attempt + 1, input), delay);
    }

    function onKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
