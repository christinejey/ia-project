export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin · Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f5f5f5;
      color: #1a1a1a;
    }
    .card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 40px 32px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .logo {
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #1a1a1a;
      margin-bottom: 6px;
    }
    .sub { text-align: center; font-size: 13px; color: #888; margin-bottom: 28px; }
    .field { margin-bottom: 12px; }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #ddd;
      border-radius: 7px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
      background: #fafafa;
    }
    input:focus { border-color: #666; background: white; }
    .btn {
      width: 100%;
      padding: 10px;
      margin-top: 8px;
      border: none;
      border-radius: 7px;
      background: #1a1a1a;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: default; }
    .error { color: #c0392b; font-size: 13px; text-align: center; margin-top: 12px; min-height: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ia-project</div>
    <div class="sub">Admin Console</div>
    <div class="field"><input id="login" type="text" placeholder="Username" autocomplete="username"></div>
    <div class="field"><input id="password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')submit()"></div>
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
        const d = await r.json().catch(() => ({}));
        document.getElementById('err').textContent = d.error || 'Login failed';
      } catch { document.getElementById('err').textContent = 'Network error'; }
      btn.disabled = false;
    }
    document.getElementById('login').focus();
  </script>
</body>
</html>`;

// {{LOGIN}} is replaced server-side with the authenticated admin's login (HTML-escaped)
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin Console</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      background: #f5f5f5;
      color: #1a1a1a;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: 220px;
      min-width: 220px;
      background: #1a1a1a;
      color: #fff;
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 24px 0 16px;
    }
    .sidebar-logo {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.3px;
      padding: 0 20px 4px;
    }
    .sidebar-sub {
      font-size: 11px;
      color: #888;
      padding: 0 20px 24px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .nav-btn {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      color: #aaa;
      font-size: 14px;
      padding: 10px 20px;
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
      border-radius: 0;
    }
    .nav-btn:hover { background: #2a2a2a; color: #fff; }
    .nav-btn.active { background: #2a2a2a; color: #fff; font-weight: 600; }
    .sidebar-spacer { flex: 1; }
    .sidebar-user {
      padding: 12px 20px 0;
      font-size: 12px;
      color: #666;
      border-top: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .sidebar-login { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #bbb; }
    .logout-btn {
      background: none;
      border: none;
      color: #666;
      font-size: 12px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }
    .logout-btn:hover { color: #fff; background: #333; }

    /* ── Main content ── */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100vh;
      overflow: hidden;
    }
    .view {
      display: none;
      flex: 1;
      overflow-y: auto;
      padding: 32px 36px;
    }
    .view.active { display: block; }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }

    /* ── Buttons ── */
    .btn-primary {
      padding: 8px 16px;
      background: #1a1a1a;
      color: white;
      border: none;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .btn-primary:hover { opacity: 0.75; }
    .btn-primary:disabled { opacity: 0.35; cursor: default; }
    .btn-danger {
      padding: 5px 12px;
      background: none;
      color: #c0392b;
      border: 1px solid #e8c4c2;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
      white-space: nowrap;
    }
    .btn-danger:hover { background: #fdf0ef; }
    .btn-danger:disabled { opacity: 0.35; cursor: default; }
    .btn-ghost {
      padding: 8px 14px;
      background: none;
      color: #555;
      border: 1px solid #ddd;
      border-radius: 7px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .btn-ghost:hover { background: #f0f0f0; }

    /* ── Create form ── */
    .create-form {
      display: none;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
      gap: 12px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .create-form.open { display: flex; }
    .form-group { display: flex; flex-direction: column; gap: 5px; min-width: 140px; }
    .form-group label { font-size: 12px; font-weight: 500; color: #555; }
    input, select, textarea {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 7px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      background: #fafafa;
    }
    input:focus, select:focus, textarea:focus { border-color: #888; background: white; }
    textarea { resize: vertical; min-height: 100px; }

    /* ── Users table ── */
    .table-wrap {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
      background: #fafafa;
    }
    td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f8f8f8; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .badge.admin { background: #1a1a1a; color: white; }
    .badge.user { background: #ebebeb; color: #555; }

    .empty-table {
      padding: 40px;
      text-align: center;
      color: #aaa;
      font-size: 14px;
    }

    /* ── Config form ── */
    .config-card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 24px;
      max-width: 640px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .field-group { display: flex; flex-direction: column; gap: 6px; }
    .field-group label { font-size: 13px; font-weight: 600; color: #444; }
    .field-group .hint { font-size: 12px; color: #999; margin-top: 2px; }
    .config-actions { display: flex; gap: 10px; align-items: center; }
    .saved-msg { font-size: 13px; color: #27ae60; opacity: 0; transition: opacity 0.3s; }
    .saved-msg.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-logo">ia-project</div>
    <div class="sidebar-sub">Admin Console</div>
    <button class="nav-btn active" id="nav-users" onclick="showView('users')">Users</button>
    <button class="nav-btn" id="nav-config" onclick="showView('config')">AI Config</button>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-user">
      <span class="sidebar-login">{{LOGIN}}</span>
      <button class="logout-btn" onclick="logout()">Sign out</button>
    </div>
  </div>

  <div class="main">

    <!-- ── Users view ── -->
    <div class="view active" id="view-users">
      <div class="page-header">
        <h1>Users</h1>
        <button class="btn-primary" onclick="toggleCreateForm()">+ New User</button>
      </div>

      <div class="create-form" id="create-form">
        <div class="form-group">
          <label>Username</label>
          <input id="new-login" type="text" placeholder="alice" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input id="new-password" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="new-role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button class="btn-primary" onclick="createUser()">Create</button>
        <button class="btn-ghost" onclick="toggleCreateForm()">Cancel</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="users-body">
            <tr><td colspan="4" class="empty-table">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Config view ── -->
    <div class="view" id="view-config">
      <div class="page-header"><h1>AI Configuration</h1></div>
      <div class="config-card">
        <div class="field-group">
          <label>Model</label>
          <select id="model-select">
            <option value="@cf/meta/llama-3.1-8b-instruct">@cf/meta/llama-3.1-8b-instruct (default)</option>
            <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">@cf/meta/llama-3.3-70b-instruct-fp8-fast</option>
            <option value="@cf/mistral/mistral-7b-instruct-v0.2">@cf/mistral/mistral-7b-instruct-v0.2</option>
            <option value="@cf/google/gemma-7b-it">@cf/google/gemma-7b-it</option>
          </select>
          <span class="hint">Model used by the agent worker for all chats.</span>
        </div>
        <div class="field-group">
          <label>System Prompt</label>
          <textarea id="system-prompt" rows="6" placeholder="You are a helpful AI assistant."></textarea>
          <span class="hint">Prepended to every conversation as the system role.</span>
        </div>
        <div class="config-actions">
          <button class="btn-primary" onclick="saveConfig()">Save</button>
          <span class="saved-msg" id="saved-msg">Saved</span>
        </div>
      </div>
    </div>

  </div>

  <script>
    let currentLogin = '{{LOGIN}}';

    // ── Navigation ──
    function showView(name) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('view-' + name).classList.add('active');
      document.getElementById('nav-' + name).classList.add('active');
      if (name === 'users') loadUsers();
      if (name === 'config') loadConfig();
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    }

    // ── Users ──
    async function loadUsers() {
      const r = await fetch('/api/users');
      if (r.status === 401) { window.location.href = '/login'; return; }
      const users = await r.json();
      renderUsers(users);
    }

    function renderUsers(users) {
      const tbody = document.getElementById('users-body');
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-table">No users found</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => \`
        <tr>
          <td><strong>\${esc(u.login)}</strong></td>
          <td><span class="badge \${u.role}">\${esc(u.role)}</span></td>
          <td>\${new Date(u.createdAt).toLocaleDateString('en', { year:'numeric', month:'short', day:'numeric' })}</td>
          <td style="text-align:right">
            <button class="btn-danger" onclick="deleteUser('\${esc(u.login)}')"
              \${u.login === currentLogin ? 'disabled title="Cannot delete yourself"' : ''}>
              Delete
            </button>
          </td>
        </tr>
      \`).join('');
    }

    function toggleCreateForm() {
      const f = document.getElementById('create-form');
      const open = f.classList.toggle('open');
      if (open) document.getElementById('new-login').focus();
      else {
        document.getElementById('new-login').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-role').value = 'user';
      }
    }

    async function createUser() {
      const login = document.getElementById('new-login').value.trim();
      const password = document.getElementById('new-password').value;
      const role = document.getElementById('new-role').value;
      if (!login || !password) return;
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, role }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Failed to create user'); return; }
      toggleCreateForm();
      loadUsers();
    }

    async function deleteUser(login) {
      if (!confirm(\`Delete user "\${login}"? This cannot be undone.\`)) return;
      const r = await fetch(\`/api/users/\${encodeURIComponent(login)}\`, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Failed to delete'); return; }
      loadUsers();
    }

    // ── Config ──
    async function loadConfig() {
      const r = await fetch('/api/config');
      if (r.status === 401) { window.location.href = '/login'; return; }
      const cfg = await r.json();
      const sel = document.getElementById('model-select');
      // Add custom option if model not in list
      if (![...sel.options].some(o => o.value === cfg.model)) {
        const opt = document.createElement('option');
        opt.value = cfg.model;
        opt.textContent = cfg.model;
        sel.insertBefore(opt, sel.firstChild);
      }
      sel.value = cfg.model;
      document.getElementById('system-prompt').value = cfg.system;
    }

    async function saveConfig() {
      const model = document.getElementById('model-select').value;
      const system = document.getElementById('system-prompt').value.trim();
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, system }),
      });
      if (!r.ok) { alert('Failed to save config'); return; }
      const msg = document.getElementById('saved-msg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2000);
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Init
    loadUsers();
  </script>
</body>
</html>`;
