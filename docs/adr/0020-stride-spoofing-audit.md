# ADR-0020: STRIDE Spoofing Audit — результаты и план исправлений

## Статус
Принято (аудит завершён, исправления запланированы)

## Контекст

Проведён аудит системы аутентификации по вектору **Spoofing** из методологии STRIDE.
Spoofing — подделка личности: злоумышленник выдаёт себя за другого пользователя
или за систему.

Дата аудита: 2026-06-04.
Область: `workers/shared/src/auth/`, `workers/webchat/src/index.ts`,
`workers/admin/src/index.ts`.

---

## Результаты аудита

### Сводная таблица

| ID | Уровень | Компонент | Угроза |
|---|---|---|---|
| S-01 | 🟠 HIGH | `/api/login` | Нет rate limiting — возможен brute force |
| S-02 | 🟡 MEDIUM | `jwt.ts:verifyJWT` | JWT header (`alg`) не валидируется |
| S-03 | 🟡 MEDIUM | `middleware.ts:extractToken` | Bearer token расширяет поверхность атаки |
| S-04 | 🟢 LOW | `middleware.ts:sessionCookie` | Нет `__Host-` префикса на cookie |
| S-05 | 🟢 LOW | `password.ts:verifyPassword` | Не constant-time сравнение хэшей |
| S-06 | 🟢 LOW | `jwt.ts:verifyJWT` | `iat` не валидируется |
| S-07 | 🟢 LOW | `handleLogin` | Нет runtime-валидации типов входных данных |

---

### S-01 🟠 HIGH — Нет защиты от brute force на `/api/login`

**Файлы:** `workers/webchat/src/index.ts:107`, `workers/admin/src/index.ts:72`

```typescript
async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { login, password } = (await request.json()) as { login: string; password: string };
  const user = await authenticate(env.KV_USERS, login, password);
  if (!user) return json({ error: 'Invalid credentials' }, 401);
  // ← нет счётчика попыток, нет задержки, нет блокировки
```

Атакующий может отправлять запросы к `/api/login` без ограничений.
PBKDF2 с 100 000 итераций добавляет ~200ms серверной задержки на попытку,
но не ограничивает количество параллельных или последовательных запросов.

**Сценарий атаки:**
1. Атакующий знает логин пользователя (или перебирает по словарю)
2. Отправляет параллельные запросы с разными паролями
3. При достаточном количестве запросов — угадывает пароль

**Планируемое исправление:** Rate limiting через KV-счётчик:
```typescript
// Ключ: "ratelimit:login:{login}" → счётчик попыток
// TTL: 15 минут
// Порог: 10 попыток → 429 Too Many Requests
const key = `ratelimit:login:${login}`;
const attempts = parseInt(await env.KV_USERS.get(key) ?? '0');
if (attempts >= 10) return json({ error: 'Too many attempts' }, 429);
await env.KV_USERS.put(key, String(attempts + 1), { expirationTtl: 900 });
```

---

### S-02 🟡 MEDIUM — JWT `alg` не валидируется

**Файл:** `workers/shared/src/auth/jwt.ts:44`

```typescript
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split('.');
  const [header, body, sig] = parts;
  // header читается, но alg не проверяется
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), ...);
```

Алгоритм верификации захардкодён как HMAC-SHA256 независимо от значения `alg`
в заголовке токена. Это защищает от классической атаки `alg:none` — токен
с `"alg":"none"` не пройдёт верификацию, так как HMAC проверяется всегда.

**Текущий риск:** низкий. **Риск при рефакторинге:** высокий — при добавлении
поддержки нескольких алгоритмов (например RS256) разработчик может не добавить
валидацию `alg`, что откроет алгоритм-подмену.

**Планируемое исправление:**
```typescript
const headerObj = JSON.parse(fromb64url(header));
if (headerObj.alg !== 'HS256' || headerObj.typ !== 'JWT') return null;
```

---

### S-03 🟡 MEDIUM — Bearer token принимается наравне с Cookie

**Файл:** `workers/shared/src/auth/middleware.ts:13`

```typescript
const auth = request.headers.get('Authorization');
if (auth?.startsWith('Bearer ')) return auth.slice(7);
```

Middleware принимает JWT из двух источников: cookie и `Authorization: Bearer`.
Session cookie защищена от CSRF через `SameSite=Strict`. Bearer-запросы этой
защиты лишены — если токен утечёт из кода или логов, его можно использовать
через Bearer без cookie.

Клиентский JS использует только cookie. Bearer не задействован ни одним
компонентом системы — это мёртвый код, расширяющий поверхность атаки.

**Планируемое исправление:** удалить Bearer fallback из `extractToken()`.

---

### S-04 🟢 LOW — Отсутствует `__Host-` префикс на session cookie

**Файл:** `workers/shared/src/auth/middleware.ts:37`

```typescript
return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
// рекомендуется: __Host-session=...
```

`__Host-` префикс дополнительно гарантирует:
- Только HTTPS
- Только Path=/
- Только точный хост, без субдоменов

Без префикса скомпрометированный субдомен теоретически может перезаписать
cookie `session`. На `*.workers.dev` субдомены изолированы по аккаунтам —
риск минимален. На кастомном домене риск выше.

**Планируемое исправление:** переименовать `session` → `__Host-session`
в `sessionCookie()` и `clearSessionCookie()` и `extractToken()`.

---

### S-05 🟢 LOW — Не constant-time сравнение хэшей в `verifyPassword`

**Файл:** `workers/shared/src/auth/password.ts:41`

```typescript
return toHex(bits) === hashHex;  // string === не гарантирует constant time
```

JavaScript не гарантирует constant-time выполнение `===` для строк.
Теоретически позволяет timing-атаку: сравнивать время ответа для разных
паролей и по разнице вычислить хэш.

На практике атака нереализуема: PBKDF2 занимает ~200ms, что на 2–3 порядка
больше любой разницы в сравнении строк. Сетевой jitter (~5–50ms) дополнительно
маскирует разницу. Тем не менее — не соответствует best practice.

Web Crypto API не предоставляет `timingSafeEqual`. Возможный подход:
использовать `crypto.subtle.verify` с HMAC для сравнения.

---

### S-06 🟢 LOW — `iat` не проверяется при верификации JWT

**Файл:** `workers/shared/src/auth/jwt.ts:56`

```typescript
const payload = JSON.parse(fromb64url(body)) as JWTPayload;
if (payload.exp < Math.floor(Date.now() / 1000)) return null;
// iat не проверяется — токен с iat в будущем будет принят
```

RFC 7519 не требует проверки `iat`, но без неё токен, подписанный с будущей
датой выдачи (`iat > now`), будет принят. Практический риск: нулевой, так как
мы сами подписываем все токены с реальным `Date.now()`.

**Планируемое исправление (опционально):**
```typescript
if (payload.iat > Math.floor(Date.now() / 1000)) return null;
```

---

### S-07 🟢 LOW — Нет runtime-валидации типов в `handleLogin`

**Файлы:** `workers/webchat/src/index.ts:108`, `workers/admin/src/index.ts:73`

```typescript
const { login, password } = (await request.json()) as { login: string; password: string };
```

`as` — TypeScript assertion, не runtime-проверка. При `{ "login": null }` код
обратится в KV с ключом `login:null`. Не приводит к spoofing (auth вернёт null),
но создаёт непредсказуемое поведение на границе API.

**Планируемое исправление:**
```typescript
if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) {
  return json({ error: 'login and password required' }, 400);
}
```

---

## Что реализовано корректно

| Механизм | Оценка |
|---|---|
| HS256 через `crypto.subtle` (не самописный crypto) | ✅ |
| `HttpOnly; Secure; SameSite=Strict` на session cookie | ✅ |
| Одинаковое сообщение об ошибке для неверного логина и пароля | ✅ |
| `sub` в JWT = UUID, не login (нет утечки логина) | ✅ |
| `exp` проверяется при каждой верификации | ✅ |
| `/api/setup` блокируется после первого создания admin | ✅ |
| PBKDF2 100 000 итераций, случайная 16-байтная соль per-user | ✅ |
| `requireAuth(request, secret, 'admin')` проверяет роль явно | ✅ |
| Пароль не логируется, `passwordHash` не возвращается в API | ✅ |

---

## Приоритет исправлений

| Приоритет | ID | Действие |
|---|---|---|
| 1 | S-01 | Rate limiting на `/api/login` — реализовать через KV |
| 2 | S-03 | Удалить Bearer token fallback из `extractToken()` |
| 3 | S-02 | Добавить валидацию `alg === 'HS256'` в `verifyJWT` |
| 4 | S-07 | Добавить runtime-валидацию типов в `handleLogin` |
| 5 | S-04 | Переименовать cookie в `__Host-session` |
| 6 | S-06 | Добавить проверку `iat` (опционально) |
| 7 | S-05 | Исследовать constant-time сравнение (низкий приоритет) |
