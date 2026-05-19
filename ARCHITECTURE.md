# Architecture Plan — ia-project

> Документ описывает целевую архитектуру системы.
> Текущее состояние: прототип `userchat-worker` с echo-ответами.
> Целевое состояние: полноценная AI-powered chat платформа на Cloudflare.

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
10. [CI/CD Pipelines](#10-cicd-pipelines)
11. [Infrastructure as Code (Terraform)](#11-infrastructure-as-code-terraform)
12. [Структура репозитория](#12-структура-репозитория)

---

## 1. Обзор системы

Система состоит из трёх независимых Cloudflare Workers, взаимодействующих через Cloudflare-native механизмы (Queue, SSE, KV).

```
┌─────────────────┐     Queue      ┌─────────────────┐
│   Web Chat      │ ─────────────► │   Agent Core    │
│   Worker        │ ◄───────────── │   Worker        │
└─────────────────┘                └────────┬────────┘
                                            │ SSE
                                   ┌────────▼────────┐
                                   │  Admin Console  │
                                   │  Worker         │
                                   └─────────────────┘
```

---

## 2. Компоненты

### 2.1 Web Chat (`workers/webchat`)

Пользовательский интерфейс чата. Обслуживает end-users.

- Аутентификация по login/password
- Список диалогов пользователя
- История сообщений с навигацией по стрелкам
- Отправка сообщений → Cloudflare Queue → Agent Core
- Визуальный стиль: **Instagram**, бело-розовая палитра

### 2.2 Agent Core (`workers/agent`)

Ядро AI-агента. Не имеет пользовательского интерфейса.

- Consume из Cloudflare Queue (входящие сообщения)
- Вызов AI-модели (Cloudflare AI / OpenAI API)
- Управление контекстом диалога (чтение/запись KV)
- Возврат ответа в KV Chat History
- SSE-стриминг для Admin Console (server-side KV polling внутри Worker; Durable Object требуется для надёжных долгоживущих соединений)

### 2.3 Admin Console (`workers/admin`)

Интерфейс администрирования системы. Доступен только пользователям с ролью `admin`.

- Настройка AI-модели и параметров
- Тестовый чат с агентом через SSE
- Управляющие команды (users, chats, context, debug)
- Визуальный стиль: **Telegram**, бело-голубая палитра

---

## 3. Хранилища данных (KV Namespaces)

Каждый логический домен данных изолирован в отдельном KV namespace.

| KV Namespace | Binding | Владелец | Содержимое |
|---|---|---|---|
| `ia-users-kv` | `KV_USERS` | webchat + admin | Пользователи, роли, хэши паролей |
| `ia-chats-kv` | `KV_CHATS` | webchat + agent | История чатов `messages:{userId}:{chatId}` |
| `ia-context-kv` | `KV_CONTEXT` | agent | Контекст диалога `context:{chatId}` |
| `ia-config-kv` | `KV_CONFIG` | admin + agent | Конфигурация системы (модель, параметры) |

### Схема данных

```
KV_USERS
├── "users"                        → string[]  (список login-ов)
├── "user:{id}"                    → User
└── "login:{login}"                → string    (userId — индекс для поиска при аутентификации)

User {
  id: string
  login: string
  passwordHash: string             -- PBKDF2 via crypto.subtle (Web Crypto API, не bcrypt)
  role: "admin" | "user"
  createdAt: number
}

---

KV_CHATS
├── "chats:{userId}"               → Chat[]
└── "messages:{userId}:{chatId}"   → Message[]

Chat  { id, name, createdAt }
Message { id, role, content, timestamp }

---

KV_CONTEXT
└── "context:{chatId}"             → ContextEntry[]

ContextEntry { role: "user"|"assistant", content: string }

---

KV_CONFIG
├── "config:model"                 → string   ("@cf/meta/llama-3...")
├── "config:context_window"        → number   (32)
└── "config:debug_chats"           → string[] (chatId[])
```

---

## 4. Очередь сообщений (Cloudflare Queue)

### `ia-messages-queue`

Асинхронная доставка сообщений от Web Chat к Agent Core.

```
Web Chat
  └─► Queue.send({ chatId, userId, content, timestamp })
                          │
                    [ia-messages-queue]
                          │
                    Agent Core (consumer)
                      ├─ читает контекст из KV_CONTEXT
                      ├─ вызывает AI модель
                      ├─ записывает ответ в KV_CHATS
                      └─ обновляет контекст в KV_CONTEXT
```

Web Chat получает ответ агента путём **polling KV_CHATS** или через **WebSocket** (будущее расширение).

---

## 5. Схема взаимодействия

```
Пользователь
    │
    │ HTTPS
    ▼
┌──────────────────────────────────────────────────┐
│  Web Chat Worker (workers/webchat)               │
│                                                  │
│  GET  /          → HTML интерфейс                │
│  POST /login     → аутентификация (KV_USERS)     │
│  GET  /api/chats → список чатов (KV_CHATS)       │
│  POST /api/send  → отправить сообщение в Queue   │
│  GET  /api/poll  → получить ответ из KV_CHATS    │
└──────────────────┬───────────────────────────────┘
                   │ Queue.send()
                   ▼
          [ia-messages-queue]
                   │ Queue consumer
                   ▼
┌──────────────────────────────────────────────────┐
│  Agent Core Worker (workers/agent)               │
│                                                  │
│  consume(message)                                │
│    ├─ KV_CONTEXT.get(context:{chatId})           │
│    ├─ AI Model API call                          │
│    ├─ KV_CHATS.put(messages:{userId}:{chatId})   │
│    └─ KV_CONTEXT.put(context:{chatId})           │
│                                                  │
│  GET /sse        → SSE stream для Admin Console  │
└──────────────────┬───────────────────────────────┘
                   │ SSE (text/event-stream)
                   ▼
┌──────────────────────────────────────────────────┐
│  Admin Console Worker (workers/admin)            │
│                                                  │
│  GET  /          → HTML интерфейс                │
│  POST /login     → аутентификация (KV_USERS)     │
│  GET  /settings  → страница настроек             │
│  POST /config    → сохранить конфиг (KV_CONFIG)  │
│  GET  /chat/sse  → тестовый чат через SSE        │
│  POST /cmd       → управляющие команды           │
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
│  > Chat 1  ●     │                                       │
│    Chat 2        │    Привет!              [пользователь]│
│    Chat 3        │    [агент] Привет! Чем помочь?        │
│                  │                                       │
│  [+ Новый чат]   │    Расскажи о себе   [пользователь]  │
│                  │    [агент] Я AI-ассистент...          │
│                  │                                       │
│                  ├──────────────────────────────────────┤
│                  │  Сообщение...                   [▲▼] │
│                  │  ┌────────────────────────────┐ [→]  │
│                  │  └────────────────────────────┘      │
└──────────────────┴──────────────────────────────────────┘
```

### Функции

- **Список чатов** (левая колонка): название, индикатор непрочитанных, кнопка удалить
- **История чата** (правое поле): сообщения пользователя справа, агента слева
- **Навигация стрелками** `▲` `▼`: перемещение между предыдущими отправленными сообщениями в поле ввода
- **Поле ввода** (снизу): Enter — отправить, Shift+Enter — перенос строки
- **Аутентификация**: форма login/password при первом открытии. Если пользователей нет — форма регистрации первого admin

### Визуальный стиль

- Палитра: белый `#FFFFFF`, розовый `#E1306C`, светло-розовый `#FDF0F5`
- Шрифт: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`
- Аватары: градиентные круги (Instagram-стиль)
- Сообщения пользователя: градиент `#833ab4 → #c13584 → #e1306c`
- Сообщения агента: светло-серый `#F0F0F0`

---

## 7. Admin Console — спецификация

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  ⚙ ia-admin                           [@admin]  [выход] │
├──────────────────────────────────────────────────────────┤
│  [Настройки]  [Тестовый чат]  [Управление]              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Вкладка 1: Настройки параметров                        │
│  ──────────────────────────────                          │
│  AI Model:        [ @cf/meta/llama-3.1-8b-instruct ▼ ]  │
│  Context Window:  [ 32 сообщения                      ]  │
│                                          [Сохранить]     │
│                                                          │
│  Вкладка 2: Тестовый чат (SSE)                          │
│  ─────────────────────────────                           │
│  [История тестового диалога с агентом]                   │
│  ┌──────────────────────────────────┐                    │
│  │ Введите сообщение...        [→]  │                    │
│  └──────────────────────────────────┘                    │
│                                                          │
│  Вкладка 3: Управление                                   │
│  ─────────────────────                                   │
│  > show chats                                            │
│  > show context {chatId}                                 │
│  > debug on {chatId}                                     │
│  > clear context {chatId}                                │
│  > show users                                            │
│  > create user {login} {password} {role}                 │
│  > delete user {login}                                   │
│  ┌──────────────────────────────────┐                    │
│  │ $ _                         [↵]  │                    │
│  └──────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────┘
```

### Управляющие команды

| Команда | Описание |
|---|---|
| `show chats` | Список всех активных чатов |
| `show context {chatId}` | Текущий контекст диалога из KV_CONTEXT |
| `debug on {chatId}` | Включить debug-режим для чата |
| `debug off {chatId}` | Выключить debug-режим |
| `clear context {chatId}` | Очистить контекст диалога |
| `show users` | Список пользователей из KV_USERS |
| `create user {login} {pass} {role}` | Создать пользователя |
| `delete user {login}` | Удалить пользователя |

### Визуальный стиль

- Палитра: белый `#FFFFFF`, синий `#0088CC`, светло-голубой `#EBF5FB`
- Стиль: Telegram Desktop
- Шрифт: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`

---

## 8. Agent Core — спецификация

### Queue Consumer

```typescript
// workers/agent/src/index.ts
export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { chatId, userId, content } = msg.body;
      const context = await env.KV_CONTEXT.get(`context:${chatId}`);
      const config   = await env.KV_CONFIG.get('config:model');
      // AI model call → ответ → запись в KV_CHATS + KV_CONTEXT
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    // SSE endpoint для Admin Console
    // GET /sse → text/event-stream
  }
}
```

### AI Integration (первая итерация)

```
User message
    └─► context = KV_CONTEXT.get(chatId)    // история диалога
    └─► response = AI.run(model, {
              messages: [...context, { role: "user", content }]
          })
    └─► KV_CHATS.put(message + response)    // сохранить в историю
    └─► KV_CONTEXT.put(updated context)     // обновить контекст
```

Поддерживаемые модели (через `KV_CONFIG → config:model`):
- `@cf/meta/llama-3.1-8b-instruct` (Cloudflare AI, default)
- `@cf/mistral/mistral-7b-instruct-v0.1`
- Расширяется через настройки Admin Console

---

## 9. Authentication & Authorization

### Единое хранилище пользователей

`KV_USERS` используется совместно Web Chat и Admin Console. Доступ к Admin Console требует роли `admin`.

### Схема аутентификации

```
1. POST /login { login, password }
       │
       ├─ KV_USERS.get("login:{login}")  → userId
       ├─ KV_USERS.get("user:{userId}")  → User
       ├─ crypto.subtle PBKDF2 verify(password, user.passwordHash)
       └─ выдать JWT / session cookie (httpOnly, Secure)

2. Первый запуск (users = [])
       └─ показать форму "Создать первого администратора"
       └─ role = "admin" принудительно

3. Middleware на каждый запрос
       ├─ проверить JWT
       ├─ для Admin Console — проверить role === "admin"
       └─ иначе → 401 / redirect /login
```

---

## 10. CI/CD Pipelines

### Структура GitHub Actions

```
.github/workflows/
├── ci.yml            ← проверки (lint, audit, secrets, typecheck)
├── deploy.yml        ← деплой всех Workers после CI
├── tf-validate.yml   ← terraform validate (ручной запуск)
├── tf-plan.yml       ← terraform plan (ручной запуск)
└── tf-apply.yml      ← terraform apply (ручной запуск)
```

### `ci.yml` — 4 параллельных job-а

| Job | Инструмент | Область |
|---|---|---|
| Lint | ESLint + @typescript-eslint | все Workers |
| Dependency Scan | `npm audit --audit-level=high` | все Workers |
| Secret Scan | Gitleaks | весь репозиторий |
| Static Analysis | `tsc --noEmit` | все Workers |

Триггер: `push` + `pull_request` → `main`

### `deploy.yml` — деплой всех Workers

Запускается через `workflow_run` только после `CI → success`.

```yaml
steps:
  # каждый шаг запускается из своей working-directory
  - working-directory: workers/webchat
    run: npx wrangler deploy
  - working-directory: workers/agent
    run: npx wrangler deploy
  - working-directory: workers/admin
    run: npx wrangler deploy
```

### Terraform Pipelines (ручной запуск)

Управляют Cloudflare-ресурсами: KV Namespaces, Queue, Workers Routes, Secrets.

| Pipeline | Триггер | Действие |
|---|---|---|
| `tf-validate.yml` | `workflow_dispatch` | `terraform init` + `terraform validate` |
| `tf-plan.yml` | `workflow_dispatch` | `terraform plan` → артефакт с планом |
| `tf-apply.yml` | `workflow_dispatch` | `terraform apply` по сохранённому плану |

```yaml
# tf-apply.yml (пример)
on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
        default: "production"
```

---

## 11. Infrastructure as Code (Terraform)

### Управляемые ресурсы

```hcl
# terraform/main.tf

resource "cloudflare_workers_kv_namespace" "users"   { title = "ia-users-kv" }
resource "cloudflare_workers_kv_namespace" "chats"   { title = "ia-chats-kv" }
resource "cloudflare_workers_kv_namespace" "context" { title = "ia-context-kv" }
resource "cloudflare_workers_kv_namespace" "config"  { title = "ia-config-kv" }

resource "cloudflare_queue" "messages" { name = "ia-messages-queue" }

resource "cloudflare_worker_script" "webchat" { name = "webchat-worker" ... }
resource "cloudflare_worker_script" "agent"   { name = "agent-worker" ... }
resource "cloudflare_worker_script" "admin"   { name = "admin-worker" ... }
```

### Структура terraform/

```
terraform/
├── main.tf           ← основные ресурсы
├── variables.tf      ← входные переменные
├── outputs.tf        ← ID ресурсов
└── versions.tf       ← провайдер cloudflare/cloudflare
```

---

## 12. Структура репозитория

```
ia-project/
├── workers/
│   ├── webchat/             ← Web Chat Worker
│   │   ├── src/index.ts
│   │   ├── wrangler.toml
│   │   └── package.json
│   ├── agent/               ← Agent Core Worker
│   │   ├── src/index.ts
│   │   ├── wrangler.toml
│   │   └── package.json
│   └── admin/               ← Admin Console Worker
│       ├── src/index.ts
│       ├── wrangler.toml
│       └── package.json
├── terraform/               ← IaC для Cloudflare-ресурсов
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
├── ARCHITECTURE.md          ← этот файл
└── package.json
```

---

## Статус реализации

| Компонент | Статус |
|---|---|
| `workers/userchat` (прототип) | ✅ Задеплоен |
| `workers/webchat` (полная версия) | 🔲 Запланировано |
| `workers/agent` | 🔲 Запланировано |
| `workers/admin` | 🔲 Запланировано |
| Cloudflare Queue | 🔲 Запланировано |
| KV Namespaces (ia-users, ia-context, ia-config) | 🔲 Запланировано |
| Authentication (JWT) | 🔲 Запланировано |
| Terraform pipelines | 🔲 Запланировано |
