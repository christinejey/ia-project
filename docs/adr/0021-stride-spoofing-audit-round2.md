# ADR-0021: STRIDE Spoofing Audit Round 2 — новые уязвимости

## Статус
Принято (аудит завершён, исправления требуют приоритизации)

## Контекст

Второй проход аудита по вектору Spoofing (дополнение к ADR-0020).
Дата: 2026-06-04. Найдено 6 новых уязвимостей, не охваченных первым аудитом.

---

## Новые находки

### S-08 🟠 HIGH — Username enumeration через timing attack

**Файл:** `workers/shared/src/kv/users.ts:78`

```typescript
export async function authenticate(kv, login, password): Promise<User | null> {
  const user = await findByLogin(kv, login);
  if (!user) return null;              // выход без PBKDF2 — ~3ms
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;            // с PBKDF2 — ~200ms
}
```

Когда логин не существует — возврат немедленно (~3ms).
Когда логин существует, но пароль неверный — выполняется PBKDF2 (~200ms).
Сообщение об ошибке одинаковое, но время ответа выдаёт существование логина.

**Сценарий:** атакующий перебирает логины по словарю, измеряя время ответа.
Быстрый ответ → логин не существует. Медленный → существует, продолжить
перебор паролей. Усиливает уязвимость S-01 (отсутствие rate limiting).

**Исправление:**
```typescript
export async function authenticate(kv, login, password): Promise<User | null> {
  const user = await findByLogin(kv, login);
  // Всегда запускать PBKDF2 — маскирует timing разницу
  const hashToCheck = user?.passwordHash ?? ('0'.repeat(32) + ':' + '0'.repeat(64));
  const ok = await verifyPassword(password, hashToCheck);
  return (user && ok) ? user : null;
}
```

---

### S-09 🟡 MEDIUM — JWT не инвалидируется на logout и при удалении пользователя

**Файл:** `workers/webchat/src/index.ts:186`, `workers/shared/src/auth/middleware.ts`

```typescript
// Logout только очищает cookie в браузере:
'Set-Cookie': clearSessionCookie()
// JWT остаётся валидным ещё до 24 часов после logout

// requireAuth не проверяет что пользователь существует:
const payload = await verifyJWT(token, secret);
if (!payload) return new Response(null, { status: 401 });
return { user: payload }; // ← удалённый пользователь проходит проверку
```

Последствия:
- Перехваченный JWT работает до 24h после logout жертвы
- Удалённый пользователь сохраняет доступ до истечения токена
- Смена роли (admin → user) не отражается на активных сессиях

Причина: нет `jti` (JWT ID) в токенах, нет серверного списка отозванных токенов.

**Исправление:**
```typescript
// 1. Добавить jti в JWT payload при выпуске
const jti = crypto.randomUUID();
const full: JWTPayload = { ...payload, iat, exp, jti };

// 2. На logout — занести jti в KV blocklist с TTL
await env.KV_USERS.put(`revoked:${jti}`, '1', { expirationTtl: SESSION_TTL });

// 3. В verifyJWT — проверять blocklist
const revoked = await kv.get(`revoked:${payload.jti}`);
if (revoked) return null;
```

---

### S-10 🟢 LOW — Нет политики сложности паролей

**Файлы:** `workers/webchat/src/index.ts:127`, `workers/admin/src/index.ts:104`

```typescript
// handleSetup и handleCreateUser:
if (!login || !password) return json({ error: 'login and password required' }, 400);
// пароль длиной 1 символ — проходит валидацию
```

Пароль `"1"` является валидным. В сочетании с S-01 (нет rate limiting)
позволяет брутфорс даже с PBKDF2: короткие пароли из словаря подбираются быстро.

**Исправление:**
```typescript
if (typeof password !== 'string' || password.length < 12) {
  return json({ error: 'Password must be at least 12 characters' }, 400);
}
```

---

### S-11 🟢 LOW — Данные удалённого пользователя остаются в KV

**Файл:** `workers/shared/src/kv/users.ts:63`

```typescript
export async function deleteUser(kv, login): Promise<boolean> {
  await Promise.all([
    kv.delete(`user:${userId}`),     // удаляется
    kv.delete(`login:${login}`),     // удаляется
    kv.put('users', JSON.stringify(logins.filter(l => l !== login))),
    // chats:{userId}            — НЕ удаляется
    // messages:{userId}:{chatId} — НЕ удаляется
  ]);
}
```

После удаления пользователя его чаты и сообщения остаются в `KV_CHATS`.
Если его JWT ещё не истёк (S-09), он может читать и писать в эти данные.
Также: данные бывшего пользователя занимают место в KV без TTL.

**Исправление:** при удалении пользователя перебирать и удалять его чаты:
```typescript
const chatIds = (await kv.get(`chats:${userId}`)) ...
for (const chat of chats) await kv.delete(`messages:${userId}:${chat.id}`);
await kv.delete(`chats:${userId}`);
```

---

### S-12 🟠 HIGH — Race condition на `/api/setup`: перехват первого admin

**Файл:** `workers/webchat/src/index.ts:124`

```typescript
// Публичный маршрут — без аутентификации:
if (p === '/api/setup' && m === 'POST') return handleSetup(request, env);

async function handleSetup(request, env): Promise<Response> {
  if (await hasUsers(env.KV_USERS)) return json({ error: 'Already configured' }, 409);
  // ↑ единственная защита — проверка что пользователей нет
  const user = await createUser(env.KV_USERS, { login, password, role: 'admin' });
  return json({ ok: true, id: user.id }, 201);
}
```

**Сценарий атаки:**
1. Репозиторий публичный — GitHub Actions видны всем
2. Атакующий следит за запуском `Deploy Cloudflare Workers`
3. Сразу после завершения деплоя отправляет:
   ```bash
   curl -X POST https://webchat-worker.christina-api.workers.dev/api/setup \
     -H 'Content-Type: application/json' \
     -d '{"login":"attacker","password":"controlled"}'
   ```
4. Становится первым admin — получает полный контроль над системой
5. Легитимный admin получает `409 Already configured`

**Результат:** атакующий контролирует webchat и admin-worker, может:
- Читать все чаты пользователей через admin
- Менять AI модель и system prompt
- Создавать/удалять пользователей

**Исправление:** требовать setup token — секрет, известный только оператору:
```typescript
async function handleSetup(request: Request, env: Env): Promise<Response> {
  const setupToken = request.headers.get('X-Setup-Token');
  if (!env.SETUP_TOKEN || setupToken !== env.SETUP_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (await hasUsers(env.KV_USERS)) return json({ error: 'Already configured' }, 409);
  ...
}
```
`SETUP_TOKEN` устанавливается через `wrangler secret put SETUP_TOKEN`
до первого деплоя. После создания первого admin — endpoint удаляется из кода.

---

### S-13 🔴 CRITICAL — `userchat-worker` задеплоен без аутентификации

**Файл:** `workers/userchat/src/index.ts`
**URL:** `https://userchat-worker.christina-api.workers.dev`

Прототип `userchat-worker` помечен как deprecated в `wrangler.toml`
(ADR-0014), но **не удалён из Cloudflare** — продолжает обслуживать запросы.

Worker не содержит ни одной проверки аутентификации:

```typescript
export default {
  async fetch(request, env, ctx) {
    // Нет requireAuth, нет JWT проверки
    if (p === '/api/chats' && m === 'GET')
      return json(await getChats(env.CHAT_KV));       // публично
    if (p === '/api/chats' && m === 'POST')
      return json(await createChat(...));              // публично
    if (withMessages && m === 'GET')
      return json(await getMessages(...));             // публично
    if (withMessages && m === 'POST')
      return json(await saveMessage(...));             // публично
    if (!withMessages && m === 'DELETE')
      return json(await deleteChat(...));              // публично
  }
}
```

Публично доступны без токена:

| Endpoint | Метод | Риск |
|---|---|---|
| `/api/chats` | GET | Список всех чатов |
| `/api/chats` | POST | Создание чата |
| `/api/chats/:id/messages` | GET | Чтение всех сообщений |
| `/api/chats/:id/messages` | POST | Запись сообщений |
| `/api/chats/:id` | DELETE | Удаление чата |
| `/api/chats/:id/stream` | GET | SSE поток сообщений |

KV Namespace `CHAT_KV` (ID: `8367a27cd28c48818886034521c20ca4`) изолирован
от `KV_CHATS` webchat-worker — прямой утечки данных продакшн-пользователей нет.
Но worker активен, принимает запросы и хранит данные в незащищённом KV.

**Немедленное исправление:**
```bash
npx wrangler delete --name userchat-worker --force
```

---

## Обновлённая сводная таблица (все Spoofing находки)

| ID | Уровень | ADR | Описание |
|---|---|---|---|
| **S-13** | 🔴 **CRITICAL** | **0021** | **userchat-worker задеплоен без аутентификации** |
| S-01 | 🟠 HIGH | 0020 | Нет rate limiting на /api/login |
| **S-08** | 🟠 HIGH | **0021** | **Username enumeration via timing в authenticate** |
| **S-12** | 🟠 HIGH | **0021** | **Race condition на /api/setup — перехват первого admin** |
| S-02 | 🟡 MEDIUM | 0020 | JWT alg не валидируется |
| S-03 | 🟡 MEDIUM | 0020 | Bearer token расширяет поверхность атаки |
| **S-09** | 🟡 MEDIUM | **0021** | **JWT не инвалидируется на logout и при удалении** |
| S-04 | 🟢 LOW | 0020 | Нет `__Host-` cookie prefix |
| S-05 | 🟢 LOW | 0020 | Не constant-time сравнение хэшей |
| S-06 | 🟢 LOW | 0020 | iat не валидируется в JWT |
| S-07 | 🟢 LOW | 0020 | Нет runtime-валидации типов в handleLogin |
| **S-10** | 🟢 LOW | **0021** | **Нет политики сложности паролей** |
| **S-11** | 🟢 LOW | **0021** | **Данные удалённого пользователя остаются в KV** |

## Приоритет исправлений

| Приоритет | ID | Действие |
|---|---|---|
| **1 — немедленно** | S-13 | `wrangler delete --name userchat-worker` |
| **2 — срочно** | S-12 | Добавить SETUP_TOKEN в /api/setup |
| 3 | S-08 | Constant-time authenticate (dummy PBKDF2 для несуществующих логинов) |
| 4 | S-01 | Rate limiting через KV-счётчик |
| 5 | S-09 | JWT revocation (jti + KV blocklist) |
| 6 | S-10 | Минимальная длина пароля 12 символов |
| 7 | S-03 | Удалить Bearer token fallback |
| 8 | S-02 | Валидация alg в JWT header |
| 9 | S-11 | Каскадное удаление данных при deleteUser |
