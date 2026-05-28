# ADR-0013: Cloudflare Workers AI как LLM провайдер

## Статус
Принято

## Контекст

`agent-worker` должен вызывать языковую модель для генерации ответов.

Варианты:
1. OpenAI API (`api.openai.com`) — через `fetch`, требует внешний API ключ, биллинг OpenAI
2. Anthropic / другие внешние API — аналогично
3. Cloudflare Workers AI (`env.AI.run(model, input)`) — нативный binding, без внешних запросов
4. Self-hosted модель (Ollama и др.) — не применимо на Cloudflare

## Решение

Использовать **Cloudflare Workers AI** через binding `[ai]` в `wrangler.toml`:

```typescript
const run = env.AI.run.bind(env.AI) as (model: string, input: ChatInput) => Promise<ChatOutput>;
const out = await run(model, { messages });
```

Модель по умолчанию: `@cf/meta/llama-3.1-8b-instruct`.
Модель настраивается через `KV_CONFIG → config:model` без редеплоя.

Примечание: `.bind(env.AI)` обязателен — type-cast `ai.run as (...)` теряет `this`-контекст класса AI binding, что приводит к runtime ошибке `Cannot set properties of undefined`.

## Обоснование

- Нет внешних API-ключей — биллинг через Cloudflare аккаунт
- Latency ниже: AI выполняется в той же Cloudflare-сети без публичного интернета
- Binding типизирован через `@cloudflare/workers-types`
- Модель меняется через Admin Console без редеплоя (хранится в KV_CONFIG)

## Последствия

- Доступные модели ограничены каталогом Cloudflare AI — нет доступа к GPT-4 / Claude напрямую через этот binding
- `@cf/meta/llama-3.1-8b-instruct` значительно уступает GPT-4 по качеству — для production может потребоваться переключение на OpenAI через `fetch`
- При переходе на внешний API потребуется добавить `OPENAI_API_KEY` как Wrangler secret и изменить логику в `processMessage`
