variable "cloudflare_account_id" {
  description = "Cloudflare Account ID — passed via TF_VAR_cloudflare_account_id or GitHub Secret"
  type        = string
  sensitive   = true
}
