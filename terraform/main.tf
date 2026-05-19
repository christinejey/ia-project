provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from environment automatically — no inline token needed
}

# ── KV Namespaces ────────────────────────────────────────────────────────────

resource "cloudflare_workers_kv_namespace" "users" {
  account_id = var.cloudflare_account_id
  title      = "ia-users-kv"
}

resource "cloudflare_workers_kv_namespace" "chats" {
  account_id = var.cloudflare_account_id
  title      = "ia-chats-kv"
}

resource "cloudflare_workers_kv_namespace" "context" {
  account_id = var.cloudflare_account_id
  title      = "ia-context-kv"
}

resource "cloudflare_workers_kv_namespace" "config" {
  account_id = var.cloudflare_account_id
  title      = "ia-config-kv"
}

# ── Queue ────────────────────────────────────────────────────────────────────

resource "cloudflare_queue" "messages" {
  account_id = var.cloudflare_account_id
  name       = "ia-messages-queue"
}

# ── Worker scripts are NOT managed here ──────────────────────────────────────
# Wrangler handles Worker deployments (see .github/workflows/deploy.yml).
# Terraform only provisions supporting infrastructure so KV/Queue IDs
# are stable and can be referenced in wrangler.toml.
