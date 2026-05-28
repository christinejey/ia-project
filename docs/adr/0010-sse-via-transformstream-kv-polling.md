# ADR-0010: SSE через TransformStream + KV polling без Durable Objects

## Статус
Принято (заменяет изначально запланированный SSEBroker Durable Object)

## Контекст

После отправки сообщения в Queue (см. ADR-0009) клиент должен получить ответ агента в реальном времени.
Server-Sent Events (SSE) — стандартный способ push-уведомлений без WebSocket.

Стандартный подход SSE в stateful-серверах: держать TCP-соединение открытым, пушить данные по готовности.

Проблема: Cloudflare Workers stateless — каждый запрос выполняется в отдельном isolate.
Изначально в плане был `SSEBroker` Durable Object (DO) как долгоживущий брокер соединений.

Варианты:
1. Durable Object SSEBroker — надёжно, но требует отдельного класса DO, доп. биллинг, сложность деплоя
2. WebSocket — аналогичная сложность, требует DO для состояния
3. Клиентский polling (`setInterval`) — просто, высокая нагрузка на KV
4. TransformStream + KV polling внутри Worker — Worker остаётся живым пока открыт ReadableStream

## Решение

**TransformStream + KV polling** в `webchat-worker`:

```
GET /api/chats/:id/stream?afterId={uuid}
  → Worker создаёт TransformStream
  → запускает IIFE (floating async function)
  → каждые 500ms читает KV_CHATS, ищет ответ агента после afterId
  → при нахождении — пишет SSE event в WritableStream и закрывает
  → возвращает ReadableStream как тело Response (text/event-stream)
```

Worker остаётся живым пока ReadableStream не закрыт (Cloudflare поддерживает это поведение).
Максимум 60 итераций (~30 сек), после чего stream закрывается.
Клиентский fallback: если SSE обрывается — polling через `GET /api/chats/:id/messages`.

## Обоснование

- Durable Objects не потребовались — решение работает в рамках обычного Worker
- Нет дополнительного биллинга за DO
- Архитектура проще: один `wrangler.toml`, нет экспорта класса DO
- KV reads дёшевы (~$0.50/млн) — 60 reads на сообщение приемлемо

## Последствия

- При одновременной отправке двух сообщений до закрытия первого SSE-стрима возможна путаница (решено через `afterId`)
- Максимальное время ожидания ответа — 30 сек; при медленном AI fallback-polling продолжает работу
- Если Cloudflare изменит поведение keepalive для streaming Response — решение потребует ревизии
