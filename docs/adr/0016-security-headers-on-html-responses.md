# ADR-0016: Security headers на HTML-ответах Workers

## Статус
Принято

## Контекст

OWASP ZAP baseline scan выявил 9 предупреждений на live Workers (admin и webchat).
Все предупреждения — отсутствующие HTTP security headers на HTML-страницах (`/` и `/login`).

Обнаруженные alerts:

| Alert ID | Название |
|---|---|
| 10015 | Re-examine Cache-control Directives |
| 10020 | Missing Anti-clickjacking Header |
| 10021 | X-Content-Type-Options Header Missing |
| 10035 | Strict-Transport-Security Header Not Set |
| 10038 | Content Security Policy Header Not Set |
| 10049 | Non-Storable Content (302 редиректы — ожидаемо) |
| 10063 | Permissions Policy Header Not Set |
| 10109 | Modern Web Application (информационное) |
| 90004 | Cross-Origin-Embedder-Policy Header Missing |

Оба Worker (`admin-worker`, `webchat-worker`) имели одинаковую проблему:
функция `htmlRes()` возвращала только `Content-Type: text/html`.

## Решение

Добавить константу `SEC_HEADERS` в оба Worker и применять её ко всем HTML-ответам через `htmlRes()`.

```typescript
const SEC_HEADERS: HeadersInit = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
```

Security headers применяются **только к HTML-ответам**, не к JSON API (`/api/*`).
302 редиректы не изменяются — нестораблность редиректов является корректным поведением.

## Обоснование

| Заголовок | Защищает от |
|---|---|
| `X-Frame-Options: DENY` | Clickjacking — встраивание в `<iframe>` |
| `X-Content-Type-Options: nosniff` | MIME-sniffing атак |
| `Strict-Transport-Security` | Downgrade атак HTTP→HTTPS |
| `Content-Security-Policy` | XSS через внешние скрипты |
| `Permissions-Policy` | Несанкционированного доступа к камере, микрофону, геолокации |
| `Cross-Origin-Opener-Policy` | Cross-origin атак через window.opener |
| `Cross-Origin-Embedder-Policy` | Spectre-подобных атак через cross-origin ресурсы |
| `Cache-Control: no-store` | Кэширования аутентифицированных страниц браузером |
| `Referrer-Policy` | Утечки URL в Referer заголовке |

CSP использует `'unsafe-inline'` для script-src и style-src — вынужденная мера,
так как HTML шаблоны Workers содержат встроенные скрипты и стили.
`frame-ancestors 'none'` в CSP дублирует `X-Frame-Options` для поддержки современных браузеров.

## Последствия

- Все HTML-страницы Workers получают security headers автоматически через единую константу
- Изменение политики безопасности требует обновления `SEC_HEADERS` в двух файлах (webchat и admin)
- `Cross-Origin-Embedder-Policy: require-corp` требует что все ресурсы на странице либо same-origin, либо имеют заголовок `Cross-Origin-Resource-Policy` — Workers удовлетворяют это условие, так как HTML полностью self-contained
- OWASP ZAP baseline scan: было 9 WARN → стало 0 WARN
