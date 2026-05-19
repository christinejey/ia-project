# Paste these IDs into each worker's wrangler.toml after running terraform apply

output "kv_users_id" {
  description = "KV_USERS binding — ia-users-kv namespace ID"
  value       = cloudflare_workers_kv_namespace.users.id
}

output "kv_chats_id" {
  description = "KV_CHATS binding — ia-chats-kv namespace ID"
  value       = cloudflare_workers_kv_namespace.chats.id
}

output "kv_context_id" {
  description = "KV_CONTEXT binding — ia-context-kv namespace ID"
  value       = cloudflare_workers_kv_namespace.context.id
}

output "kv_config_id" {
  description = "KV_CONFIG binding — ia-config-kv namespace ID"
  value       = cloudflare_workers_kv_namespace.config.id
}

output "queue_messages_id" {
  description = "ia-messages-queue ID"
  value       = cloudflare_queue.messages.id
}
