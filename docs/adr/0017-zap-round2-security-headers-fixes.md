# ADR-0017: Исправление второй итерации OWASP ZAP (5 WARN)

## Статус
Принято

## Контекст

После внедрения `SEC_HEADERS` (ADR-0016) OWASP ZAP baseline scan webchat-worker
показал улучшение: было 9 WARN → стало 5 WARN. Все оставшиеся предупреждения
требуют дополнительных корректировок.

### Оставшиеся alerts

| ID | Alert | URL | Причина |
|---|---|---|---|
| 10015 | Re-examine Cache-control Directives | `/login` | `Cache-Control: no-store` есть, но ZAP ожидает также `no-cache` и `Pragma: no-cache` для полной совместимости |
| 10049 | Non-Storable Content | `/`, `/login`, 302 редиректы | ZAP сам видит `no-store` и предупреждает — контент намеренно не кэшируется, это ожидаемо |
| 10055 | CSP: Failure to Define Directive with No Fallback | `/`, `/login` | CSP не содержит `base-uri` и `form-action` — эти директивы не наследуют `default-src` |
| 10109 | Modern Web Application | `/`, `/login` | Информационное — ZAP определил современное SPA. Не уязвимость |
| 90004 | Cross-Origin-Resource-Policy Header Missing | `/`, `/login` | При `COEP: require-corp` ресурсы должны иметь `Cross-Origin-Resource-Policy` |

---

## Решение

### Часть 1 — Исправления в коде (SEC_HEADERS)

Применяется к `workers/webchat/src/index.ts` и `workers/admin/src/index.ts`.

| Изменение | Было | Станет | Закрывает |
|---|---|---|---|
| Cache-Control | `no-store` | `no-store, no-cache` | 10015 |
| Pragma | отсутствует | `no-cache` | 10015 |
| Cross-Origin-Resource-Policy | отсутствует | `same-origin` | 90004 |
| CSP — base-uri | отсутствует | `base-uri 'self'` | 10055 |
| CSP — form-action | отсутствует | `form-action 'self'` | 10055 |

Итоговый `SEC_HEADERS`:
```typescript
const SEC_HEADERS: HeadersInit = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store, no-cache',
  'Pragma': 'no-cache',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
```

### Часть 2 — ZAP rules-файл (подавление ожидаемых alerts)

Создать `.zap/rules.tsv` — конфигурация исключений для ZAP baseline scan.

| ID | Действие | Обоснование |
|---|---|---|
| 10049 | IGNORE | Non-Storable Content — прямое следствие `Cache-Control: no-store`. Контент намеренно не кэшируется (auth-страницы) |
| 10109 | IGNORE | Modern Web Application — информационный alert, не уязвимость |

Обновить `zap-scan.yml` — добавить параметр `rules_file_name: .zap/rules.tsv`.

---

## Обоснование

**`base-uri 'self'`** — без этой директивы злоумышленник может изменить `<base href>` через XSS и перенаправить все относительные URL на внешний сервер.

**`form-action 'self'`** — без этой директивы браузер разрешает отправку форм на любой домен. `default-src` не распространяется на `form-action`.

**`Cross-Origin-Resource-Policy: same-origin`** — при `COEP: require-corp` браузер требует что каждый ресурс явно объявляет свою политику. Без `CORP` заголовка на самих HTML-ответах они не могут быть встроены в cross-origin контекст.

**`no-cache` + `Pragma: no-cache`** — `no-store` запрещает хранение, `no-cache` дополнительно требует валидации у сервера перед использованием. `Pragma: no-cache` — для HTTP/1.0 клиентов.

**Подавление 10049 и 10109** — оба alert являются прямым следствием корректных решений. Их наличие является "proof of work" что security headers применены правильно.

## Последствия

- После исправлений: ожидается WARN-NEW: 0, FAIL-NEW: 0
- `.zap/rules.tsv` документирует причины подавления и подлежит ревью при изменениях
- `base-uri 'self'` и `form-action 'self'` — более строгий CSP без нарушения функциональности Workers
