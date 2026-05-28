# ADR-0012: Общий модуль @ia/shared через npm workspace

## Статус
Принято

## Контекст

`webchat-worker` и `admin-worker` оба реализуют аутентификацию:
- Хэширование паролей (PBKDF2)
- JWT sign/verify (HS256)
- Middleware `requireAuth`
- CRUD пользователей в KV_USERS

Варианты переиспользования кода:
1. Копировать код в каждый Worker — дублирование, рассинхронизация при изменениях
2. Отдельный npm-пакет, опубликованный в registry — overhead на публикацию, версионирование
3. npm workspace (`"workspaces": ["workers/*"]`) с локальным пакетом `@ia/shared`

## Решение

Использовать **npm workspaces** на уровне корневого `package.json`:
```json
{ "workspaces": ["workers/*"] }
```

Пакет `workers/shared/package.json` с `"name": "@ia/shared"` симлинкуется в `node_modules/@ia/shared`.
Workers импортируют: `import { requireAuth } from '@ia/shared'`.

Wrangler при сборке разворачивает импорт через esbuild — shared-код включается в бандл каждого Worker.

## Обоснование

- Единственный источник правды для auth-логики — изменение в одном месте применяется везде
- Нет внешней registry — нет overhead на публикацию и версионирование
- npm workspaces — стандартный механизм, поддерживается `npm ci` в CI
- Workers бандлируются статически — `@ia/shared` не является runtime-зависимостью, не влияет на cold start

## Последствия

- `npm ci` нужно запускать из корня репозитория (не из директории Worker)
- Typecheck shared требует отдельного шага в CI (`workers/shared: npm run typecheck`)
- Если в будущем появится третий Worker с auth — он автоматически получает доступ к `@ia/shared`
- Circular dependency невозможен: shared не импортирует ничего из Workers
