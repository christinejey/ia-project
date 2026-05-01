export interface Env {
  CHAT_KV: KVNamespace;
}

interface Chat {
  id: string;
  name: string;
  createdAt: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

async function getChats(kv: KVNamespace): Promise<Chat[]> {
  const raw = await kv.get('chats');
  return raw ? (JSON.parse(raw) as Chat[]) : [];
}

async function getMessages(kv: KVNamespace, chatId: string): Promise<Message[]> {
  const raw = await kv.get(`messages:${chatId}`);
  return raw ? (JSON.parse(raw) as Message[]) : [];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;

    if (p === '/' && m === 'GET') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    if (p === '/api/chats') {
      if (m === 'GET') {
        return json(await getChats(env.CHAT_KV));
      }
      if (m === 'POST') {
        const { name } = (await request.json()) as { name: string };
        const chat: Chat = { id: crypto.randomUUID(), name: name || 'Chat', createdAt: Date.now() };
        const chats = await getChats(env.CHAT_KV);
        await env.CHAT_KV.put('chats', JSON.stringify([chat, ...chats]));
        return json(chat, 201);
      }
    }

    const chatMatch = p.match(/^\/api\/chats\/([^/]+)(\/messages)?$/);
    if (chatMatch) {
      const [, chatId, withMessages] = chatMatch;

      if (!withMessages && m === 'DELETE') {
        const chats = await getChats(env.CHAT_KV);
        await env.CHAT_KV.put('chats', JSON.stringify(chats.filter(c => c.id !== chatId)));
        await env.CHAT_KV.delete(`messages:${chatId}`);
        return json({ ok: true });
      }

      if (withMessages && m === 'GET') {
        return json(await getMessages(env.CHAT_KV, chatId));
      }

      if (withMessages && m === 'POST') {
        const { content } = (await request.json()) as { content: string };
        const messages = await getMessages(env.CHAT_KV, chatId);
        messages.push(
          { id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() },
          { id: crypto.randomUUID(), role: 'assistant', content, timestamp: Date.now() },
        );
        await env.CHAT_KV.put(`messages:${chatId}`, JSON.stringify(messages));
        return json(messages);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

const HTML = `<!DOCTYPE html>
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
      padding: 20px 16px 14px;
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

    .new-chat-btn {
      margin-top: 12px;
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

    async function init() {
      const r = await fetch('/api/chats');
      chats = await r.json();
      renderSidebar();
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
        body: JSON.stringify({ name })
      });
      const chat = await r.json();
      chats.unshift(chat);
      renderSidebar();
      select(chat.id);
    }

    async function del(e, id) {
      e.stopPropagation();
      await fetch(\`/api/chats/\${id}\`, { method: 'DELETE' });
      chats = chats.filter(c => c.id !== id);
      if (current === id) resetMain();
      renderSidebar();
    }

    async function select(id) {
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
      current = null;
      const av = document.getElementById('mainAvatar');
      av.style.display = 'none';
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

    async function send() {
      const input = document.getElementById('msgInput');
      const content = input.value.trim();
      if (!content || !current) return;
      input.value = '';
      document.getElementById('sendBtn').disabled = true;
      const r = await fetch(\`/api/chats/\${current}/messages\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      renderMsgs(await r.json());
      document.getElementById('sendBtn').disabled = false;
      input.focus();
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
