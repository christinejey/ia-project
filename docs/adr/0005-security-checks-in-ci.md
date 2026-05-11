# ADR-0005: Четыре уровня безопасности в CI

## Статус
Принято

## Контекст
Код уходит в продакшн автоматически при каждом push. Без проверок любая ошибка или уязвимость попадает на боевой сервер. Нужны автоматические барьеры.

## Решение
В `ci.yml` добавлены 4 независимых job-а:

| Job | Инструмент | Что блокирует |
|---|---|---|
| **Lint** | ESLint + @typescript-eslint | Плохой стиль, очевидные баги, deprecated API |
| **Dependency Scan** | `npm audit --audit-level=high` | Уязвимости `high` и `critical` в зависимостях |
| **Secret Scan** | Gitleaks Action v2 | Токены, пароли, ключи случайно попавшие в код |
| **Static Analysis** | `tsc --noEmit` | Ошибки типов TypeScript |

Если хотя бы один job падает — деплой не запускается (см. ADR-0004).

## Обоснование
- **Lint** — ловит проблемы на уровне кода до ревью
- **Dependency Scan** — зависимости обновляются независимо от нас; `npm audit` проверяет Advisory Database
- **Secret Scan** — человек может случайно закоммитить токен; Gitleaks сканирует всю git-историю (`fetch-depth: 0`)
- **Static Analysis** — TypeScript в `strict` режиме с `noUnusedLocals` и `noUnusedParameters`

## Инцидент в процессе
При переходе с `wrangler@3` на `wrangler@4.86.0` Dependency Scan заблокировал деплой, обнаружив уязвимость `undici` (high severity, CVE связан с HTTP smuggling и unbounded memory). Это подтвердило работоспособность проверки.

## Последствия
- `npm audit` проверяет только `devDependencies` — в `workers` нет `dependencies` для production-бандла
- Gitleaks может давать ложные срабатывания на случайные строки, похожие на токены
- `--audit-level=high` пропускает `moderate` уязвимости — осознанный выбор, чтобы не блокировать деплой из-за некритичных проблем в инструментах разработки
