# Architecture Decision Records

Этот раздел содержит записи об архитектурных решениях (ADR) проекта `ia-project`.

Каждый ADR описывает одно техническое решение в формате:
**Контекст → Решение → Обоснование → Последствия**

## Записи

| № | Решение | Статус |
|---|---|---|
| [ADR-0001](0001-cloudflare-workers-as-runtime.md) | Cloudflare Workers как среда выполнения | Принято |
| [ADR-0002](0002-cloudflare-kv-for-chat-storage.md) | Cloudflare KV для хранения истории чатов | Принято |
| [ADR-0003](0003-single-worker-serves-ui-and-api.md) | Один Worker обслуживает и UI, и API | Принято |
| [ADR-0004](0004-split-ci-cd-pipelines.md) | Разделение CI и CD на отдельные pipeline-ы | Принято |
| [ADR-0005](0005-security-checks-in-ci.md) | Четыре уровня безопасности в CI | Принято |
| [ADR-0006](0006-wrangler-v4-node22.md) | Wrangler v4 и Node.js v22 | Принято |
| [ADR-0007](0007-three-worker-architecture.md) | Три специализированных Worker вместо одного | Принято |
| [ADR-0008](0008-pbkdf2-instead-of-bcrypt.md) | PBKDF2 через Web Crypto API вместо bcrypt | Принято |
| [ADR-0009](0009-cloudflare-queue-for-ai-processing.md) | Cloudflare Queue для асинхронной обработки AI | Принято |
| [ADR-0010](0010-sse-via-transformstream-kv-polling.md) | SSE через TransformStream + KV polling без Durable Objects | Принято |
| [ADR-0011](0011-sse-filtering-by-message-id.md) | Фильтрация SSE-ответа по ID сообщения вместо timestamp | Принято |
| [ADR-0012](0012-shared-npm-workspace.md) | Общий модуль @ia/shared через npm workspace | Принято |
| [ADR-0013](0013-cloudflare-workers-ai-as-llm.md) | Cloudflare Workers AI как LLM провайдер | Принято |
| [ADR-0014](0014-terraform-for-infra-wrangler-for-workers.md) | Terraform для инфраструктуры, Wrangler для деплоя Workers | Принято |
| [ADR-0015](0015-kv-dual-index-for-users.md) | Двойной индекс KV_USERS для поиска по логину | Принято |
| [ADR-0016](0016-security-headers-on-html-responses.md) | Security headers на HTML-ответах Workers | Принято |
| [ADR-0017](0017-zap-round2-security-headers-fixes.md) | Исправление второй итерации OWASP ZAP (5 WARN) | Принято |

## Как добавить новый ADR

1. Создать файл `docs/adr/NNNN-короткое-название.md`
2. Использовать шаблон ниже
3. Добавить запись в таблицу выше

### Шаблон

```markdown
# ADR-NNNN: Заголовок

## Статус
Принято | Отклонено | Заменено ADR-XXXX

## Контекст
Что происходит, какие варианты рассматривались.

## Решение
Что именно решили сделать.

## Обоснование
Почему выбрали именно это решение.

## Последствия
Что изменится, какие ограничения появятся.
```
