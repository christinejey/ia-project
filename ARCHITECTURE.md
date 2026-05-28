# Architecture — ia-project

> Документ описывает реализованную архитектуру системы (все фазы 0–6 завершены, все Workers задеплоены).

---

## Содержание

1. [Обзор системы](#1-обзор-системы)
2. [Компоненты](#2-компоненты)
3. [Хранилища данных (KV Namespaces)](#3-хранилища-данных-kv-namespaces)
4. [Очередь сообщений (Cloudflare Queue)](#4-очередь-сообщений-cloudflare-queue)
5. [Схема взаимодействия](#5-схема-взаимодействия)
6. [Web Chat — спецификация](#6-web-chat--спецификация)
7. [Admin Console — спецификация](#7-admin-console--спецификация)
8. [Agent Core — спецификация](#8-agent-core--спецификация)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Shared Module (@ia/shared)](#10-shared-module-iashared)
11. [CI/CD Pipelines](#11-cicd-pipelines)
12. [Infrastructure as Code (Terraform)](#12-infrastructure-as-code-terraform)
13. [Структура репозитория](#13-структура-репозитория)
14. [Статус реализации](#14-статус-реализации)

---

## 1. Обзор системы

Система состоит из трёх независимых Cloudflare Workers и общего модуля `@ia/shared`.

```
Пользователь
    │ HTTPS
    ▼
┌─────────────────┐   Queue.send()   ┌─────────────────┐
│   webchat       │ ───────────────► │   agent         │
│   Worker        │                  │   Worker        │
│                 │   KV_CHATS.get() │                 │
│  SSE polling ◄──┼──────────────────┤ KV_CHATS.put()  │
└─────────────────┘                  └─────────────────┘

Администратор
    │ HTTPS
    ▼
┌─────────────────┐
│   admin         │   KV_USERS + KV_CONFIG
│   Worker        │
└─────────────────┘
```

Admin Console не имеет прямой связи с agent-worker — взаимодействие идёт через общие KV Namespaces.

---

## 2. Компоненты

### 2.1 Web Chat (`workers/webchat`)

Пользовательский интерфейс чата. Обслуживает end-users.

- Аутентификация по login/password (JWT в `session` cookie)
- Bootstrap первого администратора через `POST /api/setup`
- Список диалогов пользователя, создание и удаление чатов
- Отправка сообщений → Cloudflare Queue → Agent Core
- Получение ответа: SSE (`GET /api/chats/:id/stream?afterId=`) с fallback-polling
- Визуальный стиль: Instagram, бело-розовая палитра

### 2.2 Agent Core (`workers/agent`)

Ядро AI-агента. Нет HTTP-endpoint, только Queue consumer.

- Consume сообщений из `ia-messages-queue`
- Чтение конфига (модель, system prompt) из KV_CONFIG
- Вызов Workers AI через `env.AI.run` (с `.bind(ai)` для сохранения контекста)
- Сохранение ответа в KV_CHATS
- Обновление контекста диалога в KV_CONTEXT (скользящее окно 20 записей)

### 2.3 Admin Console (`workers/admin`)

Интерфейс администрирования. Доступен только пользователям с ролью `admin`.

- Управление пользователями (создание, удаление, список)
- Настройка AI: выбор модели и system prompt
- Все маршруты защищены: `requireAuth(request, secret, 'admin')`
- Визуальный стиль: Telegram, бело-голубая палитра

---

## 3. Хранилища данных (KV Namespaces)

| KV Namespace | Binding | Worker-ы | Содержимое |
|---|---|---|---|
| `ia-users-kv` | `KV_USERS` | webchat, admin | Пользователи, роли, хэши паролей |
| `ia-chats-kv` | `KV_CHATS` | webchat, agent | Список чатов и история сообщений |
| `ia-context-kv` | `KV_CONTEXT` | agent | Скользящий контекст диалога |
| `ia-config-kv` | `KV_CONFIG` | admin, agent | Конфигурация AI (модель, system prompt) |

### Terraform ID (production)

| Binding | KV Namespace ID |
|---|---|
| `KV_USERS` | `f7936ef6353948b798f1ddfe82e0528c` |
| `KV_CHATS` | `94b4a2b684154083a371573c6d99c737` |
| `KV_CONTEXT` | `ed4363ad4d3b451a822d37a16176b4ab` |
| `KV_CONFIG` | `b73b90edb8314ef9aa9801b1d0be4f1b` |

### Схема данных

```
KV_USERS
├── "users"                        → string[]     (список login-ов всех пользователей)
├── "user:{id}"                    → User         (данные пользователя)
└── "login:{login}"                → string       (userId — индекс для аутентификации)

User {
  id: string          (UUID)
  login: string
  passwordHash: string  // формат: "saltHex:hashHex" (PBKDF2, 100 000 итераций, SHA-256)
  role: "admin" | "user"
  createdAt: number
}

---

KV_CHATS
├── "chats:{userId}"               → Chat[]
└── "messages:{userId}:{chatId}"   → Message[]

Chat    { id: string, name: string, createdAt: number }
Message { id: string, role: "user"|"assistant", content: string, timestamp: number }

---

KV_CONTEXT
└── "context:{chatId}"             → ContextEntry[]   (последние 20 записей)

ContextEntry { role: "user"|"assistant", content: string }

---

KV_CONFIG
├── "config:model"                 → string   (ID модели, default: "@cf/meta/llama-3.1-8b-instruct")
└── "config:system"                → string   (system prompt, default: "You are a helpful AI assistant.")
```

---

## 4. Очередь сообщений (Cloudflare Queue)

### `ia-messages-queue`

Queue ID: `9286acf4419248e1b83ca227e3c3b567`

Асинхронная доставка сообщений от Web Chat к Agent Core.

```
webchat: POST /api/chats/:id/messages
  └─► Queue.send({ userId, chatId, content })
                     │
               [ia-messages-queue]
                     │
              agent (consumer)
                ├─ читает config из KV_CONFIG
                ├─ читает контекст из KV_CONTEXT
                ├─ вызывает AI модель
                ├─ записывает ответ в KV_CHATS
                └─ обновляет KV_CONTEXT
```

Параметры consumer (wrangler.toml):
- `max_batch_size = 5`
- `max_batch_timeout = 10`
- `max_retries = 3`

Ответ агента webchat получает через **SSE с KV-polling** (см. §6).

---

## 5. Схема взаимодействия

```
Пользователь
    │ HTTPS
    ▼
┌──────────────────────────────────────────────────┐
│  webchat-worker                                  │
│                                                  │
│  GET  /login                → HTML форма входа  │
│  POST /api/setup            → bootstrap admin    │
│  POST /api/login            → JWT cookie         │
│  POST /api/logout           → clear cookie       │
│                                                  │
│  GET  /                     → HTML чата          │
│  GET  /api/chats            → список чатов       │
│  POST /api/chats            → создать чат        │
│  DELETE /api/chats/:id      → удалить чат        │
│  GET  /api/chats/:id/messages → история          │
│  POST /api/chats/:id/messages → отправить        │──► Queue
│  GET  /api/chats/:id/stream   → SSE ответ        │◄── KV poll
└──────────────────────────────────────────────────┘
                   │ Queue.send()
                   ▼
          [ia-messages-queue]
                   │ queue consumer
                   ▼
┌──────────────────────────────────────────────────┐
│  agent-worker (нет HTTP endpoint)                │
│                                                  │
│  queue(batch)                                    │
│    ├─ KV_CONFIG → модель, system prompt          │
│    ├─ KV_CONTEXT → контекст чата                 │
│    ├─ env.AI.run(model, messages)                │
│    ├─ KV_CHATS ← ответ агента                    │
│    └─ KV_CONTEXT ← обновлённый контекст          │
└──────────────────────────────────────────────────┘

Администратор
    │ HTTPS
    ▼
┌──────────────────────────────────────────────────┐
│  admin-worker                                    │
│                                                  │
│  GET  /login                → HTML форма входа  │
│  POST /api/login            → JWT cookie (admin) │
│  POST /api/logout           → clear cookie       │
│                                                  │
│  GET  /                     → HTML консоли       │
│  GET  /api/users            → список юзеров      │
│  POST /api/users            → создать юзера      │
│  DELETE /api/users/:login   → удалить юзера      │
│  GET  /api/config           → текущий конфиг AI  │
│  PUT  /api/config           → обновить конфиг AI │
└──────────────────────────────────────────────────┘
```

---

## 6. Web Chat — спецификация

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  🌸 ia-chat                                    [выход]  │
├──────────────────┬──────────────────────────────────────┤
│                  │                                       │
│  Диалоги         │  История чата                        │
│  ─────────       │  ─────────────────────────────────   │
│  > Chat 1        │                                       │
│    Chat 2        │    Привет!              [пользователь]│
│    Chat 3        │    [агент] Привет! Чем помочь?        │
│                  │                                       │
│  [+ Новый чат]   │    Расскажи о себе   [пользователь]  │
│                  │    [агент] ⏳ (typing indicator)       │
│                  │                                       │
│                  ├──────────────────────────────────────┤
│                  │  ┌────────────────────────────┐ [→]  │
│                  │  └────────────────────────────┘      │
└──────────────────┴──────────────────────────────────────┘
```

### SSE-механизм получения ответов

Cloudflare Workers stateless; Durable Objects не используются.
Реализация: `TransformStream` + KV-polling внутри Worker.

```
1. POST /api/chats/:id/messages
      → сохранить user-сообщение в KV (получаем userMsg.id)
      → Queue.send(...)
      ← вернуть { id, role, content, timestamp }

2. GET /api/chats/:id/stream?afterId={userMsg.id}
      Worker открывает TransformStream и запускает IIFE:
        loop (max 60 итераций, ~30 сек):
          msgs = KV_CHATS.get(...)
          afterIdx = msgs.findIndex(m => m.id === afterId)
          fresh = msgs после afterIdx с role === "assistant"
          если fresh.length > 0 → отправить SSE event, закрыть
          иначе → отправить ": ping\n\n", sleep 500ms
      Возвращает ReadableStream с Content-Type: text/event-stream

3. Клиентский fallback (если SSE обрывается):
      pollForReply(chatId, afterId, attempt)
        GET /api/chats/:id/messages
        ищет ответ по afterId (тот же алгоритм)
        повторяет до 18 раз (интервал 3–5 сек)
```

Почему фильтрация по ID, а не по timestamp: `Date.now()` в Workers заморожен на момент начала инвокации. Временна́я метка user-сообщения (webchat-worker) и метка ответа (agent-worker) приходят из разных инвокаций, поэтому сравнение по времени ненадёжно.

### Маршруты

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/login` | HTML форма входа |
| `POST` | `/api/setup` | Bootstrap первого admin (только если нет пользователей) |
| `POST` | `/api/login` | Аутентификация → JWT cookie |
| `POST` | `/api/logout` | Очистить cookie |
| `GET` | `/` | HTML чата (auth required) |
| `GET` | `/api/chats` | Список чатов пользователя |
| `POST` | `/api/chats` | Создать чат |
| `DELETE` | `/api/chats/:id` | Удалить чат и его сообщения |
| `GET` | `/api/chats/:id/messages` | История сообщений |
| `POST` | `/api/chats/:id/messages` | Отправить сообщение → Queue |
| `GET` | `/api/chats/:id/stream` | SSE-поток ответа агента |

### Визуальный стиль

- Палитра: белый `#FFFFFF`, розовый `#E1306C`, светло-розовый `#FDF0F5`
- Шрифт: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`
- Сообщения пользователя: градиент `#833ab4 → #c13584 → #e1306c`
- Сообщения агента: светло-серый `#F0F0F0`

---

## 7. Admin Console — спецификация

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  ⚙ ia-admin                           [@admin]  [выход] │
├──────────────────────────────────────────────────────────┤
│  [Настройки]  [Пользователи]                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Вкладка: Настройки AI                                   │
│  ─────────────────────────────────                       │
│  AI Model:      [ @cf/meta/llama-3.1-8b-instruct      ]  │
│  System Prompt: [ You are a helpful AI assistant.     ]  │
│                                          [Сохранить]     │
│                                                          │
│  Вкладка: Пользователи                                   │
│  ──────────────────────                                  │
│  login      role   [удалить]                             │
│  admin      admin                                        │
│  user1      user   [удалить]                             │
│                                                          │
│  Создать пользователя:                                   │
│  Login: [      ]  Password: [      ]  Role: [user ▼]     │
│                                              [Создать]   │
└──────────────────────────────────────────────────────────┘
```

### Маршруты

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/login` | HTML форма входа |
| `POST` | `/api/login` | Аутентификация (только role=admin) |
| `POST` | `/api/logout` | Очистить cookie |
| `GET` | `/` | HTML консоли (auth required, admin only) |
| `GET` | `/api/users` | Список всех пользователей |
| `POST` | `/api/users` | Создать пользователя |
| `DELETE` | `/api/users/:login` | Удалить пользователя (self-delete → 409) |
| `GET` | `/api/config` | Текущий конфиг AI (`model`, `system`) |
| `PUT` | `/api/config` | Обновить конфиг AI |

### Визуальный стиль

- Палитра: белый `#FFFFFF`, синий `#0088CC`, светло-голубой `#EBF5FB`
- Стиль: Telegram Desktop
- Шрифт: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`

---

## 8. Agent Core — спецификация

### Queue Consumer

```typescript
export default {
  async queue(batch: MessageBatch<QueueMsg>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processMessage(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error('agent: failed to process message', err);
        msg.retry();
      }
    }
  }
};
```

### Логика processMessage

```
1. Параллельно читаем:
   - KV_CONFIG → config:model       (default: "@cf/meta/llama-3.1-8b-instruct")
   - KV_CONFIG → config:system      (default: "You are a helpful AI assistant.")
   - KV_CONTEXT → context:{chatId}  (история до 20 записей)

2. Формируем messages для AI:
   updatedCtx = [...context, { role: "user", content }].slice(-MAX_CONTEXT)
   messages   = [{ role: "system", content: systemPrompt }, ...updatedCtx]
   // slice применяется к объединённому массиву (context + user), а не только к context

3. Вызываем Workers AI:
   // .bind(ai) обязателен — casting ai.run теряет this-контекст класса
   const run = ai.run.bind(ai) as (model, input) => Promise<output>;
   const reply = await run(model, { messages });

4. Записываем ответ:
   KV_CHATS ← append { id: UUID, role: "assistant", content: reply, timestamp: Date.now() }

5. Обновляем контекст (скользящее окно):
   KV_CONTEXT ← [...context, { role: "user", content }, { role: "assistant", content: reply }]
                .slice(-MAX_CONTEXT)   // MAX_CONTEXT = 20
```

### Поддерживаемые модели

- `@cf/meta/llama-3.1-8b-instruct` (default)
- Любая модель Cloudflare AI — меняется через Admin Console без редеплоя

### Env bindings (wrangler.toml)

```toml
[ai]
binding = "AI"

[[kv_namespaces]]
binding = "KV_CHATS"      # чтение истории + запись ответа
id = "94b4a2b684154083a371573c6d99c737"

[[kv_namespaces]]
binding = "KV_CONTEXT"    # скользящий контекст
id = "ed4363ad4d3b451a822d37a16176b4ab"

[[kv_namespaces]]
binding = "KV_CONFIG"     # модель + system prompt
id = "b73b90edb8314ef9aa9801b1d0be4f1b"

[[queues.consumers]]
queue = "ia-messages-queue"
max_batch_size = 5
max_batch_timeout = 10
max_retries = 3
```

---

## 9. Authentication & Authorization

### Единое хранилище пользователей

`KV_USERS` используется совместно webchat и admin.

### Схема аутентификации

```
POST /api/login { login, password }
       │
       ├─ KV_USERS.get("login:{login}")  → userId
       ├─ KV_USERS.get("user:{userId}")  → User
       ├─ PBKDF2 verify(password, user.passwordHash)
       └─ signJWT({ sub, login, role }, JWT_SECRET)
          → Set-Cookie: session={jwt}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400
```

### Первый запуск (bootstrap)

```
POST /api/setup { login, password }
       │
       ├─ hasUsers(KV_USERS) → false (иначе → 409)
       └─ createUser(KV_USERS, { login, password, role: "admin" }) → 201
```

### Middleware

```typescript
const auth = await requireAuth(request, env.JWT_SECRET);
if (auth instanceof Response) {
  return p.startsWith('/api/') ? auth : redirect('/login');
}
// auth.user: { sub, login, role, iat, exp }
```

Admin-только маршруты используют `requireAuth(request, secret, 'admin')` — возвращает 403 при `role !== 'admin'`.

### Session

- Cookie: `session={jwt}`
- JWT payload: `{ sub: userId, login, role, iat, exp }`
- TTL: 86 400 сек (24 часа)
- Алгоритм: HS256 через `crypto.subtle` (Web Crypto API)

---

## 10. Shared Module (@ia/shared)

Общий код для всех Workers. Публикуется как npm workspace-пакет.

```
workers/shared/
├── src/
│   ├── index.ts          ← barrel export
│   ├── auth/
│   │   ├── password.ts   ← PBKDF2 hashPassword / verifyPassword
│   │   ├── jwt.ts        ← signJWT / verifyJWT (HS256, Web Crypto)
│   │   └── middleware.ts ← requireAuth, sessionCookie, clearSessionCookie
│   └── kv/
│       └── users.ts      ← createUser, findByLogin, deleteUser, hasUsers, listUsers
├── package.json          ← name: "@ia/shared"
└── tsconfig.json
```

Экспортируемые символы:

| Модуль | Символы |
|---|---|
| `auth/password.ts` | `hashPassword`, `verifyPassword` |
| `auth/jwt.ts` | `signJWT`, `verifyJWT`, `JWTPayload`, `SESSION_TTL` |
| `auth/middleware.ts` | `requireAuth`, `sessionCookie`, `clearSessionCookie`, `AuthContext` |
| `kv/users.ts` | `authenticate`, `createUser`, `deleteUser`, `hasUsers`, `getLogins`, `findByLogin`, `findById`, `User` |

---

## 11. CI/CD Pipelines

### Структура GitHub Actions

```
.github/workflows/
├── ci.yml            ← typecheck + audit + secret scan
├── deploy.yml        ← деплой всех трёх Workers
├── tf-validate.yml   ← terraform validate (ручной запуск)
├── tf-plan.yml       ← terraform plan → артефакт
└── tf-apply.yml      ← terraform apply (после approval)
```

### `ci.yml`

| Job | Инструмент | Область |
|---|---|---|
| `typecheck` | `tsc --noEmit` | shared, webchat, agent, admin |
| `dependency-scan` | `npm audit --audit-level=high` | root workspace |
| `secret-scan` | Gitleaks | весь репозиторий |

Триггер: `push` + `pull_request` → `main`. Кэш: root `package-lock.json`.

### `deploy.yml`

Запускается через `workflow_run` только после `CI → success`.

Три параллельных job-а (каждый независим):

```
deploy-webchat:
  working-directory: workers/webchat
  run: npx wrangler deploy

deploy-agent:
  working-directory: workers/agent
  run: npx wrangler deploy

deploy-admin:
  working-directory: workers/admin
  run: npx wrangler deploy
```

Требуемые GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.  
Worker-секреты (`JWT_SECRET`) устанавливаются через `wrangler secret put` отдельно.

### Terraform Pipelines (ручной запуск)

| Pipeline | Триггер | Действие |
|---|---|---|
| `tf-validate.yml` | `workflow_dispatch` | `terraform fmt --check` + `terraform validate` |
| `tf-plan.yml` | `workflow_dispatch` | `terraform plan` → артефакт (5 дней) |
| `tf-apply.yml` | `workflow_dispatch` | `terraform apply` по сохранённому плану |

---

## 12. Infrastructure as Code (Terraform)

### Управляемые ресурсы

```hcl
# terraform/main.tf

resource "cloudflare_workers_kv_namespace" "users"   { title = "ia-users-kv" }
resource "cloudflare_workers_kv_namespace" "chats"   { title = "ia-chats-kv" }
resource "cloudflare_workers_kv_namespace" "context" { title = "ia-context-kv" }
resource "cloudflare_workers_kv_namespace" "config"  { title = "ia-config-kv" }

resource "cloudflare_queue" "messages" { name = "ia-messages-queue" }
```

Worker Scripts намеренно **не** в Terraform — деплоятся через Wrangler (CI/CD).

### Структура terraform/

```
terraform/
├── main.tf           ← KV Namespaces, Queue
├── variables.tf      ← cloudflare_account_id
├── outputs.tf        ← ID ресурсов (используются в wrangler.toml)
├── versions.tf       ← провайдер cloudflare/cloudflare ~> 4.x
└── backend.hcl       ← Cloudflare R2 backend (не в git)
```

---

## 13. Структура репозитория

```
ia-project/
├── workers/
│   ├── shared/              ← @ia/shared (общий модуль аутентификации)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── auth/
│   │   │   └── kv/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── webchat/             ← Web Chat Worker
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── html.ts
│   │   ├── wrangler.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agent/               ← Agent Core Worker (Queue consumer)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── wrangler.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── admin/               ← Admin Console Worker
│       ├── src/
│       │   ├── index.ts
│       │   └── html.ts
│       ├── wrangler.toml
│       ├── package.json
│       └── tsconfig.json
├── terraform/               ← IaC (KV Namespaces, Queue)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── versions.tf
├── .github/workflows/
│   ├── ci.yml
│   ├── deploy.yml
│   ├── tf-validate.yml
│   ├── tf-plan.yml
│   └── tf-apply.yml
├── docs/
│   └── adr/
├── ARCHITECTURE.md
├── IMPLEMENTATION_PLAN.md
└── package.json             ← npm workspaces root
```

---

## 14. Статус реализации

| Компонент | URL | Статус |
|---|---|---|
| `workers/webchat` | https://webchat-worker.christina-api.workers.dev | ✅ Задеплоен |
| `workers/agent` | (Queue consumer, нет публичного URL) | ✅ Задеплоен |
| `workers/admin` | https://admin-worker.christina-api.workers.dev | ✅ Задеплоен |
| `workers/shared` | npm workspace `@ia/shared` | ✅ Реализован |
| Cloudflare Queue `ia-messages-queue` | — | ✅ Создан |
| KV Namespaces (4 шт.) | — | ✅ Созданы |
| Authentication (JWT + PBKDF2) | — | ✅ Реализована |
| SSE (TransformStream + KV polling) | — | ✅ Реализована |
| Terraform IaC | — | ✅ Применён |
| CI/CD (ci.yml + deploy.yml) | — | ✅ Настроен |
