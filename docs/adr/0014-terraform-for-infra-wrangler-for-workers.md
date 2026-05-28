# ADR-0014: Terraform для инфраструктуры, Wrangler для деплоя Workers

## Статус
Принято

## Контекст

Нужно управлять двумя категориями ресурсов Cloudflare:
1. **Инфраструктура**: KV Namespaces, Queue — создаются один раз, изменяются редко
2. **Worker scripts**: код Workers — деплоится при каждом push в main

Варианты управления:
1. Всё через Terraform (`cloudflare_worker_script`) — единый IaC, но медленно и не интегрируется с npm build
2. Всё через Wrangler CLI — просто, но KV/Queue не version-controlled
3. Terraform для инфраструктуры + Wrangler для Workers — разделение ответственности

## Решение

**Разделение по типу ресурса:**

| Ресурс | Инструмент | Триггер |
|---|---|---|
| KV Namespaces, Queue | Terraform | `workflow_dispatch` (ручной) |
| Worker scripts | Wrangler (`npx wrangler deploy`) | Автоматически после CI |

Terraform state хранится в Cloudflare R2 bucket (`ia-terraform-state`).
Worker scripts намеренно **не** объявлены в `terraform/main.tf`.

## Обоснование

- Worker scripts деплоятся часто (каждый PR) — Wrangler оптимизирован для этого
- KV/Queue создаются один раз — Terraform с state file гарантирует идемпотентность
- Wrangler собирает TypeScript бандл через esbuild — Terraform не умеет этого
- Разделение исключает ситуацию, когда `terraform destroy` случайно удаляет рабочий Worker

## Последствия

- ID ресурсов (KV namespace IDs) берутся из `terraform output` и вручную вписываются в `wrangler.toml` — нет автоматической связи
- При потере Terraform state нужно импортировать ресурсы через `terraform import`
- Два инструмента для деплоя требуют знания обоих от команды
