# Implementation Plan — ia-project

> Документ описывает пошаговый план реализации целевой архитектуры.
> Базируется на `ARCHITECTURE.md` с учётом найденных ошибок и текущего состояния репозитория.
> Текущая точка: прототип `workers/userchat` задеплоен, нет аутентификации, нет AI-интеграции.

---

## Содержание

1. [Фазы и приоритеты](#1-фазы-и-приоритеты)
2. [Фаза 0 — Исправление документации](#2-фаза-0--исправление-документации)
3. [Фаза 1 — Инфраструктура (Terraform + KV + Queue)](#3-фаза-1--инфраструктура-terraform--kv--queue)
4. [Фаза 2 — Аутентификация (общий модуль)](#4-фаза-2--аутентификация-общий-модуль)
5. [Фаза 3 — Web Chat Worker](#5-фаза-3--web-chat-worker)
6. [Фаза 4 — Agent Core Worker](#6-фаза-4--agent-core-worker)
7. [Фаза 5 — Admin Console Worker](#7-фаза-5--admin-console-worker)
8. [Фаза 6 — CI/CD Финализация](#8-фаза-6--cicd-финализация)
9. [Критические исправления архитектуры](#9-критические-исправления-архитектуры)
10. [Зависимости между фазами](#10-зависимости-между-фазами)

---

## 1. Фазы и приоритеты

| Фаза | Название | Зависит от | Оценка |
|---|---|---|---|
| 0 | Исправление документации | — | 1 день |
| 1 | Инфраструктура | 0 | 2–3 дня |
| 2 | Аутентификация (общий модуль) | 1 | 2–3 дня |
| 3 | Web Chat Worker | 1, 2 | 3–4 дня |
| 4 | Agent Core Worker | 1, 2, 3 | 3–4 дня |
| 5 | Admin Console Worker | 1, 2, 4 | 3–4 дня |
| 6 | CI/CD Финализация | 3, 4, 5 | 1–2 дня |

---

## 2. Фаза 0 — Исправление документации

Устранить расхождения в `ARCHITECTURE.md` до начала реализации, чтобы документ служил точным ориентиром.

### Задачи

- [x] **0.1** Удалить `docs/c4.md` из раздела 12 (файл уже удалён в git)
- [x] **0.2** Обновить таблицу KV Namespaces: добавить `KV_CHATS` как binding для `agent`
- [x] **0.3** Исправить схему аутентификации: заменить `KV_USERS.get("user:{login}")` на корректную двойную схему ключей
- [x] **0.4** Добавить примечание о Web Crypto API вместо bcrypt
- [x] **0.5** Добавить примечание о Durable Objects для SSE
- [x] **0.6** Добавить `versions.tf` в структуру репозитория (раздел 12)
- [x] **0.7** Исправить команду деплоя в разделе 10 (`npx wrangler deploy` из `working-directory`)

---

## 3. Фаза 1 — Инфраструктура (Terraform + KV + Queue)

Создать все Cloudflare-ресурсы и IaC до начала разработки Workers.

### Задачи

- [x] **1.1** Создать директорию `terraform/` со структурой:
  ```
  terraform/
  ├── main.tf        ← KV Namespaces, Queue
  ├── variables.tf   ← cloudflare_account_id
  ├── outputs.tf     ← namespace IDs для wrangler.toml
  └── versions.tf    ← cloudflare/cloudflare провайдер ~> 4.x
  ```

- [x] **1.2** Определить ресурсы в `main.tf`:
  - 4 KV Namespaces: `ia-users-kv`, `ia-chats-kv`, `ia-context-kv`, `ia-config-kv`
  - 1 Queue: `ia-messages-queue`
  - Worker Scripts намеренно не в Terraform — деплоятся через Wrangler

- [x] **1.3** Создать GitHub Actions workflows:
  - `.github/workflows/tf-validate.yml` — `workflow_dispatch`: fmt check + validate (без backend)
  - `.github/workflows/tf-plan.yml` — `workflow_dispatch`: plan → artifact (5 дней)
  - `.github/workflows/tf-apply.yml` — `workflow_dispatch`: plan → approval gate → apply

- [ ] **1.4** Добавить GitHub Secrets (вручную в настройках репозитория):
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `TF_BACKEND_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`

- [ ] **1.5** Создать R2 bucket `ia-project-tfstate` в Cloudflare dashboard (вручную, один раз)

- [ ] **1.6** Настроить GitHub Environment `production` с required reviewers (Settings → Environments)

- [ ] **1.7** Прогнать `tf-validate` → `tf-plan` → `tf-apply` в production

### Результат фазы 1
Все KV Namespaces и Queue созданы в Cloudflare. ID вынесены в `outputs.tf`.

---

## 4. Фаза 2 — Аутентификация (общий модуль)

Реализовать shared-модуль аутентификации, используемый и в webchat, и в admin.

### Критическое исправление: bcrypt → Web Crypto API

Cloudflare Workers не поддерживают bcrypt (требует Node.js / нативных аддонов).
Использовать **PBKDF2 через `crypto.subtle`**:

```typescript
// workers/shared/auth/password.ts

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256
  );
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256
  );
  return toHex(new Uint8Array(bits)) === hashHex;
}
```

### Критическое исправление: схема ключей KV_USERS

Добавить индекс по логину для быстрого поиска при аутентификации:

```
KV_USERS
├── "users"                    → string[]         (список всех login-ов)
├── "user:{id}"                → User             (данные пользователя по ID)
└── "login:{login}"            → string           (user ID по логину — индекс)
```

При создании пользователя писать оба ключа атомарно.
При аутентификации: `KV_USERS.get("login:{login}") → id → KV_USERS.get("user:{id}")`.

### Задачи

- [ ] **2.1** Создать `workers/shared/` — общий код для всех Workers:
  ```
  workers/shared/
  ├── auth/
  │   ├── password.ts    ← PBKDF2 hash/verify
  │   ├── jwt.ts         ← sign/verify через crypto.subtle (HS256)
  │   └── middleware.ts  ← проверка JWT на каждый запрос
  └── kv/
      └── users.ts       ← CRUD для KV_USERS с двойным индексом
  ```

- [ ] **2.2** Реализовать JWT через Web Crypto API (алгоритм HS256):
  - `sign(payload, secret)` → JWT string
  - `verify(token, secret)` → payload | null
  - Хранить JWT в `httpOnly; Secure; SameSite=Strict` cookie

- [ ] **2.3** Реализовать KV_USERS CRUD:
  - `createUser(kv, { login, password, role })` — пишет `user:{id}` + `login:{login}` + обновляет `users`
  - `findByLogin(kv, login)` — через двойной индекс
  - `deleteUser(kv, login)` — удаляет оба ключа

- [ ] **2.4** Написать middleware `requireAuth(role?)`:
  - Читает cookie `session`
  - Верифицирует JWT
  - Если `role === "admin"` — проверяет роль
  - Иначе → 401

- [ ] **2.5** Логика первого запуска:
  - Если `KV_USERS.get("users") === null` → показать форму создания первого admin
  - После создания — автоматический login

### Результат фазы 2
Shared-модуль аутентификации, готовый к подключению в webchat и admin.

---

## 5. Фаза 3 — Web Chat Worker

Полная реализация `workers/webchat` на базе прототипа `workers/userchat`.

### Задачи

- [ ] **3.1** Создать `workers/webchat/` (новый worker, не переименование прототипа):
  ```
  workers/webchat/
  ├── src/
  │   ├── index.ts        ← router + handlers
  │   ├── handlers/
  │   │   ├── auth.ts     ← POST /login, GET /logout
  │   │   ├── chats.ts    ← GET/POST /api/chats, DELETE /api/chats/:id
  │   │   └── messages.ts ← GET /api/chats/:id/messages, POST /api/send, GET /api/poll
  │   └── ui/
  │       └── html.ts     ← HTML-шаблон (Instagram-стиль)
  ├── wrangler.toml
  ├── package.json
  └── tsconfig.json
  ```

- [ ] **3.2** Настроить `wrangler.toml`:
  ```toml
  name = "webchat-worker"
  [[kv_namespaces]]
  binding = "KV_USERS"  id = "<из terraform outputs>"
  binding = "KV_CHATS"  id = "<из terraform outputs>"
  [[queues.producers]]
  binding = "QUEUE"     queue = "ia-messages-queue"
  ```

- [ ] **3.3** Реализовать `POST /api/send`:
  - Валидировать `chatId`, `content`
  - `QUEUE.send({ chatId, userId, content, timestamp })`
  - Вернуть `{ messageId, status: "queued" }`

- [ ] **3.4** Реализовать `GET /api/poll?chatId={id}&after={timestamp}`:
  - Читать `KV_CHATS.get("messages:{userId}:{chatId}")`
  - Возвращать только сообщения с `timestamp > after`
  - Интервал polling на клиенте: 1.5 сек

- [ ] **3.5** Перенести UI из прототипа:
  - Адаптировать под новую схему ключей (`chats:{userId}`)
  - Добавить экран login
  - Добавить индикатор "ожидание ответа" во время polling

- [ ] **3.6** Обновить `ci.yml` и `deploy.yml` — добавить шаги для `workers/webchat`

### Результат фазы 3
Полноценный чат с аутентификацией, отправкой через Queue и polling ответов из KV.

---

## 6. Фаза 4 — Agent Core Worker

Реализовать AI-агента, консьюмирующего Queue и записывающего ответы в KV.

### Критическое исправление: SSE через Durable Objects

Cloudflare Workers stateless — они не могут держать SSE-соединение надёжно.
Использовать **Durable Object** как SSE-брокер:

```typescript
// workers/agent/src/sse-broker.ts (Durable Object)
export class SSEBroker implements DurableObject {
  private connections = new Set<WritableStreamDefaultWriter>();

  async fetch(request: Request) {
    const { readable, writable } = new TransformStream();
    this.connections.add(writable.getWriter());
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }

  async broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const writer of this.connections) {
      await writer.write(new TextEncoder().encode(payload)).catch(() => {
        this.connections.delete(writer);
      });
    }
  }
}
```

### Задачи

- [ ] **4.1** Создать `workers/agent/`:
  ```
  workers/agent/
  ├── src/
  │   ├── index.ts         ← queue consumer + fetch handler (SSE endpoint)
  │   ├── ai.ts            ← AI model abstraction (Cloudflare AI / OpenAI)
  │   ├── context.ts       ← чтение/запись KV_CONTEXT
  │   └── sse-broker.ts    ← Durable Object для SSE
  ├── wrangler.toml
  ├── package.json
  └── tsconfig.json
  ```

- [ ] **4.2** Настроить `wrangler.toml`:
  ```toml
  name = "agent-worker"
  [[kv_namespaces]]
  binding = "KV_CHATS"    id = "<...>"   # запись ответов
  binding = "KV_CONTEXT"  id = "<...>"
  binding = "KV_CONFIG"   id = "<...>"
  [[queues.consumers]]
  queue = "ia-messages-queue"
  [[durable_objects.bindings]]
  name = "SSE_BROKER"  class_name = "SSEBroker"
  [ai]
  binding = "AI"
  ```

- [ ] **4.3** Реализовать Queue consumer:
  ```typescript
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      const { chatId, userId, content } = msg.body;
      const context = await getContext(env.KV_CONTEXT, chatId);
      const config = await env.KV_CONFIG.get('config:model') ?? '@cf/meta/llama-3.1-8b-instruct';
      const response = await runAI(env.AI, config, [...context, { role: 'user', content }]);
      await saveMessage(env.KV_CHATS, userId, chatId, 'assistant', response);
      await updateContext(env.KV_CONTEXT, chatId, context, content, response);
      await broadcastToSSE(env.SSE_BROKER, chatId, response);
      msg.ack();
    }
  }
  ```

- [ ] **4.4** Реализовать AI-абстракцию (`ai.ts`):
  - Primary: Cloudflare AI (`env.AI.run(model, { messages })`)
  - Fallback-конфиг для OpenAI (через `fetch` к `api.openai.com`)
  - Читать выбор из `KV_CONFIG → config:model`

- [ ] **4.5** Управление контекстом (`context.ts`):
  - Читать `KV_CONTEXT.get("context:{chatId}")` → `ContextEntry[]`
  - Обрезать до `config:context_window` последних записей
  - Писать обновлённый контекст после каждого ответа

- [ ] **4.6** SSE endpoint `GET /sse?chatId={id}`:
  - Проверить auth (только admin)
  - Подключить к Durable Object `SSEBroker`
  - Возвращать стрим `text/event-stream`

- [ ] **4.7** Обновить CI/CD — добавить шаги для `workers/agent`

### Результат фазы 4
Agent Core получает сообщения из Queue, вызывает AI, записывает ответы в KV_CHATS, пушит события в SSE.

---

## 7. Фаза 5 — Admin Console Worker

Интерфейс администрирования с настройками, тестовым чатом и командами.

### Задачи

- [ ] **5.1** Создать `workers/admin/`:
  ```
  workers/admin/
  ├── src/
  │   ├── index.ts           ← router
  │   ├── handlers/
  │   │   ├── auth.ts        ← POST /login
  │   │   ├── settings.ts    ← GET/POST /config
  │   │   ├── chat.ts        ← GET /chat/sse
  │   │   └── commands.ts    ← POST /cmd
  │   └── ui/
  │       └── html.ts        ← HTML (Telegram-стиль)
  ├── wrangler.toml
  ├── package.json
  └── tsconfig.json
  ```

- [ ] **5.2** Настроить `wrangler.toml`:
  ```toml
  name = "admin-worker"
  [[kv_namespaces]]
  binding = "KV_USERS"   id = "<...>"
  binding = "KV_CONFIG"  id = "<...>"
  binding = "KV_CHATS"   id = "<...>"   # для show chats
  binding = "KV_CONTEXT" id = "<...>"   # для show/clear context
  ```

- [ ] **5.3** Реализовать `GET /settings` и `POST /config`:
  - Читать/писать `KV_CONFIG`: `config:model`, `config:context_window`, `config:debug_chats`
  - Форма с выбором модели (dropdown) и числовым полем context window

- [ ] **5.4** Реализовать `GET /chat/sse`:
  - Прокси к SSE endpoint Agent Core Worker
  - Использовать Service Binding `env.AGENT` для worker-to-worker вызова (без публичного URL)

- [ ] **5.5** Реализовать `POST /cmd` — парсинг и выполнение команд:

  | Команда | Реализация |
  |---|---|
  | `show chats` | Итерация `KV_CHATS` по префиксу `chats:` |
  | `show context {chatId}` | `KV_CONTEXT.get("context:{chatId}")` |
  | `debug on/off {chatId}` | `KV_CONFIG` → `config:debug_chats` array |
  | `clear context {chatId}` | `KV_CONTEXT.delete("context:{chatId}")` |
  | `show users` | `KV_USERS.get("users")` |
  | `create user {login} {pass} {role}` | `createUser()` из shared/auth |
  | `delete user {login}` | `deleteUser()` из shared/auth |

- [ ] **5.6** Защита: все маршруты проверяют `role === "admin"` через shared middleware

- [ ] **5.7** Обновить CI/CD — добавить шаги для `workers/admin`

### Результат фазы 5
Полный admin интерфейс: настройки модели, live SSE чат, управляющие команды.

---

## 8. Фаза 6 — CI/CD Финализация

Привести CI/CD в соответствие с архитектурой трёх Workers.

### Задачи

- [ ] **6.1** Обновить `ci.yml` — запускать lint, typecheck, audit для всех трёх Workers:
  ```yaml
  strategy:
    matrix:
      worker: [webchat, agent, admin]
  working-directory: workers/${{ matrix.worker }}
  ```

- [ ] **6.2** Обновить `deploy.yml` — деплоить все три Workers последовательно (agent после webchat, admin последним):
  ```yaml
  jobs:
    deploy-webchat: ...
    deploy-agent:
      needs: deploy-webchat
    deploy-admin:
      needs: deploy-agent
  ```

- [ ] **6.3** Добавить `workers/userchat` в статус "deprecated" — не деплоить после запуска `workers/webchat`

- [ ] **6.4** Проверить что все Secrets добавлены в GitHub:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

### Результат фазы 6
Полный CI/CD: автоматический деплой трёх Workers после прохождения CI.

---

## 9. Критические исправления архитектуры

Сводная таблица проблем из ревью и их решений:

| Проблема | Где в ARCHITECTURE.md | Решение | Фаза |
|---|---|---|---|
| bcrypt несовместим с Workers | §9 строка 358 | PBKDF2 через `crypto.subtle` | 2 |
| KV_CHATS не привязан к Agent Core | §3 таблица | Добавить binding в `wrangler.toml` агента | 4 |
| Конфликт ключей KV_USERS (`{id}` vs `{login}`) | §3 и §9 | Двойной индекс: `user:{id}` + `login:{login}` | 2 |
| SSE без Durable Objects ненадёжен | §2.2, §5 | Durable Object `SSEBroker` | 4 |
| `docs/c4.md` удалён, но в документе есть | §12 | Убрать из структуры репозитория | 0 |
| Terraform pipelines не существуют | §10, §11 | Создать terraform/ + tf-*.yml | 1 |
| `versions.tf` пропущен в структуре §12 | §11 vs §12 | Добавить в раздел 12 | 0 |
| Команда деплоя отличается от реального CI | §10 | Обновить пример в документе | 0 |

---

## 10. Зависимости между фазами

```
Фаза 0 (документация)
    │
    ▼
Фаза 1 (инфраструктура: KV + Queue + Terraform)
    │
    ▼
Фаза 2 (shared аутентификация)
    │
    ├──────────────────┐
    ▼                  ▼
Фаза 3 (webchat)   Фаза 4 (agent)
    │                  │
    └──────┬───────────┘
           ▼
       Фаза 5 (admin)
           │
           ▼
       Фаза 6 (CI/CD финализация)
```

Фазы 3 и 4 можно вести параллельно после завершения фазы 2.
Фаза 5 требует работающего Agent Core (SSE endpoint).

---

## Статус

| Фаза | Статус |
|---|---|
| Фаза 0 — Документация | ✅ Выполнено |
| Фаза 1 — Инфраструктура | 🔄 Частично (файлы созданы, ручные шаги 1.4–1.7 остались) |
| Фаза 2 — Аутентификация | 🔲 Не начато |
| Фаза 3 — Web Chat Worker | 🔲 Не начато |
| Фаза 4 — Agent Core Worker | 🔲 Не начато |
| Фаза 5 — Admin Console Worker | 🔲 Не начато |
| Фаза 6 — CI/CD Финализация | 🔲 Не начато |
