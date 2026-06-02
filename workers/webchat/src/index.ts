import {
  authenticate,
  createUser,
  hasUsers,
  signJWT,
  requireAuth,
  sessionCookie,
  clearSessionCookie,
} from '@ia/shared';
import { LOGIN_HTML, CHAT_HTML } from './html';

export interface Env {
  KV_USERS: KVNamespace;
  KV_CHATS: KVNamespace;
  JWT_SECRET: string;
  QUEUE: Queue<QueueMsg>;
}

interface QueueMsg {
  userId: string;
  chatId: string;
  content: string;
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

// --- KV helpers ---

async function getChats(kv: KVNamespace, userId: string): Promise<Chat[]> {
  const raw = await kv.get(`chats:${userId}`);
  return raw ? (JSON.parse(raw) as Chat[]) : [];
}

async function putChats(kv: KVNamespace, userId: string, chats: Chat[]): Promise<void> {
  await kv.put(`chats:${userId}`, JSON.stringify(chats));
}

async function getMessages(kv: KVNamespace, userId: string, chatId: string): Promise<Message[]> {
  const raw = await kv.get(`messages:${userId}:${chatId}`);
  return raw ? (JSON.parse(raw) as Message[]) : [];
}

async function putMessages(
  kv: KVNamespace,
  userId: string,
  chatId: string,
  msgs: Message[],
): Promise<void> {
  await kv.put(`messages:${userId}:${chatId}`, JSON.stringify(msgs));
}

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

// Creates the first admin user — only works when no users exist yet.
async function handleSetup(request: Request, env: Env): Promise<Response> {
  if (await hasUsers(env.KV_USERS)) return json({ error: 'Already configured' }, 409);
  const { login, password } = (await request.json()) as { login: string; password: string };
  if (!login || !password) return json({ error: 'login and password required' }, 400);
  const user = await createUser(env.KV_USERS, { login, password, role: 'admin' });
  return json({ ok: true, id: user.id }, 201);
}

function handleStream(chatId: string, userId: string, url: URL, env: Env): Response {
  // afterId: the ID of the user message just sent — we look for any assistant
  // message that appears AFTER it in the array. This avoids all clock-skew issues.
  const afterId = url.searchParams.get('afterId') ?? '';
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    const MAX_POLLS = 60;
    let polls = 0;
    try {
      while (polls < MAX_POLLS) {
        const msgs = await getMessages(env.KV_CHATS, userId, chatId);
        const afterIdx = afterId ? msgs.findIndex(m => m.id === afterId) : msgs.length - 1;
        const fresh =
          afterIdx >= 0 ? msgs.slice(afterIdx + 1).filter(m => m.role === 'assistant') : [];
        if (fresh.length > 0) {
          for (const msg of fresh) {
            await writer.write(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
          }
          break;
        }
        await writer.write(enc.encode(': ping\n\n'));
        await new Promise<void>(r => setTimeout(r, 500));
        polls++;
      }
    } catch {
      // client disconnected
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

// --- Router ---

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
    if (p === '/api/setup' && m === 'POST') return handleSetup(request, env);

    // Auth gate — API returns 401/403, UI redirects to /login
    const auth = await requireAuth(request, env.JWT_SECRET);
    if (auth instanceof Response) {
      return p.startsWith('/api/') ? auth : redirect('/login');
    }
    const userId = auth.user.sub;
    const login = auth.user.login;

    // Protected HTML
    if (p === '/' && m === 'GET') {
      return htmlRes(CHAT_HTML.replace('{{LOGIN}}', escHtml(login)));
    }

    // Chats list
    if (p === '/api/chats') {
      if (m === 'GET') return json(await getChats(env.KV_CHATS, userId));
      if (m === 'POST') {
        const { name } = (await request.json()) as { name: string };
        const chat: Chat = { id: crypto.randomUUID(), name: name || 'Chat', createdAt: Date.now() };
        const chats = await getChats(env.KV_CHATS, userId);
        await putChats(env.KV_CHATS, userId, [chat, ...chats]);
        return json(chat, 201);
      }
    }

    // SSE stream (must be before generic chat match)
    const streamMatch = p.match(/^\/api\/chats\/([^/]+)\/stream$/);
    if (streamMatch && m === 'GET') {
      return handleStream(streamMatch[1], userId, url, env);
    }

    // Individual chat + messages
    const chatMatch = p.match(/^\/api\/chats\/([^/]+)(\/messages)?$/);
    if (chatMatch) {
      const [, chatId, withMessages] = chatMatch;

      if (!withMessages && m === 'DELETE') {
        const chats = await getChats(env.KV_CHATS, userId);
        await putChats(env.KV_CHATS, userId, chats.filter(c => c.id !== chatId));
        await env.KV_CHATS.delete(`messages:${userId}:${chatId}`);
        return json({ ok: true });
      }

      if (withMessages && m === 'GET') {
        return json(await getMessages(env.KV_CHATS, userId, chatId));
      }

      if (withMessages && m === 'POST') {
        const { content } = (await request.json()) as { content: string };
        const messages = await getMessages(env.KV_CHATS, userId, chatId);
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        messages.push(userMsg);
        await putMessages(env.KV_CHATS, userId, chatId, messages);

        await env.QUEUE.send({ userId, chatId, content });

        return json(userMsg, 201);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
