# ADR-0006: Wrangler v4 и Node.js v22

## Статус
Принято

## Контекст
Проект изначально использовал `wrangler@^3.0.0` и `node-version: "20"` в CI/CD. После добавления Dependency Scan CI начал блокировать деплой из-за уязвимостей в транзитивных зависимостях wrangler v3:
- `undici` — high severity (HTTP smuggling, unbounded memory)
- `esbuild <=0.24.2` — moderate severity (SSRF в dev-сервере)

## Решение
Обновление в два шага:

1. **`wrangler@^3.0.0` → `wrangler@^4.86.0`** в `workers/userchat/package.json`
2. **`node-version: "20"` → `"22"`** в `ci.yml` и `deploy.yml`

Шаг 2 был вынужденным — wrangler v4 требует Node.js >= 22.0.0 и падал с ошибкой:
```
Wrangler requires at least Node.js v22.0.0. You are using v20.20.2.
```

## Обоснование
- `npm audit` после обновления: **0 vulnerabilities**
- Wrangler v4 — текущая мажорная версия с активной поддержкой
- Node.js v22 — LTS (Long Term Support) версия, GitHub Actions поддерживает

## Последствия
- Wrangler v4 изменил синтаксис некоторых CLI-команд (например `kv:namespace` → `kv namespace`) — необходимо учитывать при ручных операциях
- Node.js v22 требуется как локально для разработки, так и в CI — необходимо синхронизировать с `.nvmrc` при необходимости
- GitHub Actions предупреждает об устаревании Node.js 20 в actions runner с июня 2026 — обновление было своевременным
