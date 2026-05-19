import { hashPassword, verifyPassword } from '../auth/password';

export interface User {
  id: string;
  login: string;
  passwordHash: string;    // PBKDF2 via Web Crypto API
  role: 'admin' | 'user';
  createdAt: number;
}

// KV_USERS key schema:
//   "users"          → string[]   list of all logins
//   "user:{id}"      → User       user data (primary key)
//   "login:{login}"  → string     userId  (index for auth lookup)

export async function getLogins(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get('users');
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function hasUsers(kv: KVNamespace): Promise<boolean> {
  const logins = await getLogins(kv);
  return logins.length > 0;
}

export async function findByLogin(kv: KVNamespace, login: string): Promise<User | null> {
  const userId = await kv.get(`login:${login}`);
  if (!userId) return null;
  const raw = await kv.get(`user:${userId}`);
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function findById(kv: KVNamespace, id: string): Promise<User | null> {
  const raw = await kv.get(`user:${id}`);
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function createUser(
  kv: KVNamespace,
  opts: { login: string; password: string; role: 'admin' | 'user' },
): Promise<User> {
  const exists = await kv.get(`login:${opts.login}`);
  if (exists) throw new Error(`User "${opts.login}" already exists`);

  const user: User = {
    id: crypto.randomUUID(),
    login: opts.login,
    passwordHash: await hashPassword(opts.password),
    role: opts.role,
    createdAt: Date.now(),
  };

  const logins = await getLogins(kv);
  await Promise.all([
    kv.put(`user:${user.id}`, JSON.stringify(user)),
    kv.put(`login:${user.login}`, user.id),
    kv.put('users', JSON.stringify([...logins, user.login])),
  ]);

  return user;
}

export async function deleteUser(kv: KVNamespace, login: string): Promise<boolean> {
  const userId = await kv.get(`login:${login}`);
  if (!userId) return false;

  const logins = await getLogins(kv);
  await Promise.all([
    kv.delete(`user:${userId}`),
    kv.delete(`login:${login}`),
    kv.put('users', JSON.stringify(logins.filter(l => l !== login))),
  ]);

  return true;
}

// Authenticate login/password, returns User or null
export async function authenticate(
  kv: KVNamespace,
  login: string,
  password: string,
): Promise<User | null> {
  const user = await findByLogin(kv, login);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}
