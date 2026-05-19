import { verifyJWT, type JWTPayload, SESSION_TTL } from './jwt';

export interface AuthContext {
  user: JWTPayload;
}

function extractToken(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (cookie) {
    const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    if (m) return m[1];
  }
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Returns AuthContext on success, or a ready-to-send error Response.
export async function requireAuth(
  request: Request,
  secret: string,
  role?: 'admin' | 'user',
): Promise<AuthContext | Response> {
  const token = extractToken(request);
  if (!token) return new Response(null, { status: 401 });

  const payload = await verifyJWT(token, secret);
  if (!payload) return new Response(null, { status: 401 });

  if (role === 'admin' && payload.role !== 'admin') {
    return new Response(null, { status: 403 });
  }

  return { user: payload };
}

export function sessionCookie(token: string): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}
