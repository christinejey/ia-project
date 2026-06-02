import {
  authenticate,
  signJWT,
  requireAuth,
  sessionCookie,
  clearSessionCookie,
  getLogins,
  findByLogin,
  createUser,
  deleteUser,
} from '@ia/shared';
import { LOGIN_HTML, ADMIN_HTML } from './html';

export interface Env {
  KV_USERS: KVNamespace;
  KV_CONFIG: KVNamespace;
  JWT_SECRET: string;
}

interface ConfigPayload {
  model: string;
  system: string;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_SYSTEM = 'You are a helpful AI assistant.';

// --- Response helpers ---

const SEC_HEADERS: HeadersInit = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlRes(body: string): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html;charset=utf-8', ...SEC_HEADERS },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Handlers ---

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { login, password } = (await request.json()) as { login: string; password: string };
  const user = await authenticate(env.KV_USERS, login, password);
  if (!user) return json({ error: 'Invalid credentials' }, 401);
  if (user.role !== 'admin') return json({ error: 'Admin access required' }, 403);
  const token = await signJWT(
    { sub: user.id, login: user.login, role: user.role },
    env.JWT_SECRET,
  );
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token),
    },
  });
}

async function handleGetUsers(env: Env): Promise<Response> {
  const logins = await getLogins(env.KV_USERS);
  const users = await Promise.all(logins.map(login => findByLogin(env.KV_USERS, login)));
  const safe = users
    .filter(Boolean)
    .map(u => ({ login: u!.login, role: u!.role, createdAt: u!.createdAt }));
  return json(safe);
}

async function handleCreateUser(request: Request, env: Env): Promise<Response> {
  const { login, password, role } = (await request.json()) as {
    login: string;
    password: string;
    role: 'admin' | 'user';
  };
  if (!login || !password) return json({ error: 'login and password required' }, 400);
  if (role !== 'admin' && role !== 'user') return json({ error: 'invalid role' }, 400);
  try {
    const user = await createUser(env.KV_USERS, { login, password, role });
    return json({ login: user.login, role: user.role, createdAt: user.createdAt }, 201);
  } catch (err) {
    return json({ error: (err as Error).message }, 409);
  }
}

async function handleDeleteUser(
  login: string,
  currentLogin: string,
  env: Env,
): Promise<Response> {
  if (login === currentLogin) return json({ error: 'Cannot delete your own account' }, 409);
  const deleted = await deleteUser(env.KV_USERS, login);
  if (!deleted) return json({ error: 'User not found' }, 404);
  return json({ ok: true });
}

async function handleGetConfig(env: Env): Promise<Response> {
  const [model, system] = await Promise.all([
    env.KV_CONFIG.get('config:model').then(v => v ?? DEFAULT_MODEL),
    env.KV_CONFIG.get('config:system').then(v => v ?? DEFAULT_SYSTEM),
  ]);
  return json({ model, system });
}

async function handlePutConfig(request: Request, env: Env): Promise<Response> {
  const { model, system } = (await request.json()) as ConfigPayload;
  if (!model) return json({ error: 'model required' }, 400);
  await Promise.all([
    env.KV_CONFIG.put('config:model', model),
    env.KV_CONFIG.put('config:system', system ?? DEFAULT_SYSTEM),
  ]);
  return json({ ok: true });
}

// --- Router ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;

    // Public routes
    if (p === '/login' && m === 'GET') return htmlRes(LOGIN_HTML);
    if (p === '/api/login' && m === 'POST') return handleLogin(request, env);
    if (p === '/api/logout' && m === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearSessionCookie(),
        },
      });
    }

    // Admin auth gate
    const auth = await requireAuth(request, env.JWT_SECRET, 'admin');
    if (auth instanceof Response) {
      if (p.startsWith('/api/')) return auth;
      return auth.status === 403
        ? new Response('Forbidden: admin access required', { status: 403 })
        : redirect('/login');
    }
    const currentLogin = auth.user.login;

    // Protected HTML
    if (p === '/' && m === 'GET') {
      return htmlRes(ADMIN_HTML.replace(/\{\{LOGIN\}\}/g, escHtml(currentLogin)));
    }

    // Users API
    if (p === '/api/users') {
      if (m === 'GET') return handleGetUsers(env);
      if (m === 'POST') return handleCreateUser(request, env);
    }

    const userMatch = p.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && m === 'DELETE') {
      return handleDeleteUser(decodeURIComponent(userMatch[1]), currentLogin, env);
    }

    // Config API
    if (p === '/api/config') {
      if (m === 'GET') return handleGetConfig(env);
      if (m === 'PUT') return handlePutConfig(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};
