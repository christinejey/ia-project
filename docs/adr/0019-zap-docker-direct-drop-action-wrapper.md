# ADR-0019: Запуск ZAP напрямую через Docker без action wrapper

## Статус
Принято

## Контекст

После устранения всех WARN alerts (ADR-0018) OWASP ZAP сканирование стало
показывать `WARN-NEW: 0, FAIL-NEW: 0`, однако job продолжал падать из-за
ошибки загрузки артефакта:

```
Error: Create Artifact Container failed:
The artifact name zap_scan is not valid.
Request URL: https://pipelinesghubeus12.actions.githubusercontent.com/
  .../_apis/pipelines/workflows/.../artifacts?api-version=6.0-preview
Status Code: 400 Bad Request
```

### Диагностика

Ошибка воспроизводилась при любом имени артефакта:
- `zap_scan` → 400
- `zap_scan_webchat` → 400
- `zap_scan_admin` → 400

Это означает что проблема не в конфликте имён, а в самом API endpoint.
`zaproxy/action-baseline@v0.12.0` использует устаревший GitHub Actions
Artifact API (`api-version=6.0-preview`), который больше не поддерживается
текущей инфраструктурой GitHub Actions.

### Варианты решения

| Вариант | Описание | Проблема |
|---|---|---|
| Обновить версию action | Перейти на `@v0.13+` | Нет гарантии что новая версия исправила endpoint |
| Добавить `actions: write` | Дать permission на запись артефактов | ACTIONS_RUNTIME_TOKEN не управляется через `permissions` YAML |
| Сделать jobs последовательными | Убрать конфликт параллельных артефактов | 400 возникает даже с одним job |
| Запускать ZAP через Docker напрямую | Убрать action wrapper полностью | Нет минусов для данного use case |

---

## Решение

Заменить `zaproxy/action-baseline@v0.12.0` на прямой вызов Docker образа
`ghcr.io/zaproxy/zaproxy:stable`.

### Было

```yaml
- name: Baseline scan
  uses: zaproxy/action-baseline@v0.12.0
  with:
    target: https://webchat-worker.christina-api.workers.dev
    rules_file_name: .zap/rules.tsv
    artifact_name: zap_scan_webchat
    fail_action: true
    allow_issue_writing: false
```

### Стало

```yaml
- name: Baseline scan
  run: |
    docker run --rm \
      -v "${{ github.workspace }}/.zap:/zap/wrk/:rw" \
      ghcr.io/zaproxy/zaproxy:stable \
      zap-baseline.py \
        -t https://webchat-worker.christina-api.workers.dev \
        -c /zap/wrk/rules.tsv
```

Rules-файл `.zap/rules.tsv` монтируется в контейнер через volume:
`github.workspace/.zap` → `/zap/wrk/` внутри контейнера.

---

## Обоснование

- `ghcr.io/zaproxy/zaproxy:stable` — тот же образ, который использует
  `zaproxy/action-baseline` внутри. Функциональность сканирования идентична.
- Exit code пробрасывается напрямую: `0` → job success, `≠ 0` → job fail.
  Это более прозрачно чем логика action wrapper.
- Нет загрузки артефактов → нет зависимости от GitHub Artifact API.
- `permissions: read-all` достаточно — Docker не требует GitHub token.
- Docker доступен на `ubuntu-latest` runner по умолчанию.

---

## Последствия

- HTML-отчёт ZAP больше не загружается как GitHub artifact.
  Результаты видны только в логах job.
- При необходимости отчёт можно добавить отдельным шагом:
  `actions/upload-artifact@v4` после Docker run.
- Версия ZAP фиксируется тегом `:stable` — при выходе новой версии
  образ обновится автоматически при следующем запуске.
- Если потребуется пиннинг версии ZAP — заменить `:stable` на конкретный тег
  (например `:2.15.0`).
