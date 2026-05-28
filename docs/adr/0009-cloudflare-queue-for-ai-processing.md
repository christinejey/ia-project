# ADR-0009: Cloudflare Queue для асинхронной обработки AI

## Статус
Принято

## Контекст

Workers AI (LLM-инференс) может занимать от 3 до 30 секунд в зависимости от модели и длины ответа.
Cloudflare Workers имеют таймаут CPU time 30 сек для платных планов.

Если вызывать AI синхронно в HTTP-обработчике `webchat-worker`:
- Пользователь ждёт ответа до 30 сек на одном HTTP-запросе
- При таймауте ответ теряется
- Невозможно реализовать retry без повторного запроса от клиента

Варианты:
1. Синхронный вызов AI в webchat-worker — просто, но ненадёжно
2. Cloudflare Queue + отдельный consumer worker — асинхронно, с retry
3. WebSocket — требует Durable Objects для состояния

## Решение

Использовать **Cloudflare Queue** (`ia-messages-queue`) как транспорт между webchat и agent:
- `webchat-worker` немедленно пишет в Queue и возвращает `201` с ID сообщения
- `agent-worker` consume-ит Queue, вызывает AI, записывает ответ в `KV_CHATS`
- Клиент получает ответ через SSE polling (см. ADR-0010)

Параметры: `max_batch_size=5`, `max_batch_timeout=10s`, `max_retries=3`.

## Обоснование

- HTTP-ответ пользователю возвращается мгновенно (<100ms), UX не деградирует
- Queue гарантирует доставку: при сбое agent-worker сообщение повторяется до 3 раз
- agent-worker изолирован — падение AI не влияет на доступность чат-интерфейса
- Cloudflare Queue нативен — нет внешних брокеров (Redis, RabbitMQ)

## Последствия

- Ответ AI доставляется асинхронно — клиент должен опрашивать KV или слушать SSE
- Latency увеличивается на время Queue-доставки (~1–5 сек)
- Queue message format зафиксирован: `{ userId, chatId, content }` — изменение требует координации двух Workers
