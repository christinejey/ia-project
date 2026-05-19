terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Partial backend configuration — dynamic values are passed at init time via -backend-config flags.
  # Prerequisites before first apply:
  #   1. Create R2 bucket "ia-project-tfstate" in Cloudflare dashboard
  #   2. Create R2 API token (Object Read & Write on that bucket)
  #   3. Add secrets to GitHub: TF_BACKEND_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  #
  # Local init (one-time):
  #   terraform init \
  #     -backend-config="endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  #     -backend-config="access_key=<R2_ACCESS_KEY_ID>" \
  #     -backend-config="secret_key=<R2_SECRET_ACCESS_KEY>"
  backend "s3" {
    bucket = "ia-project-tfstate"
    key    = "production/terraform.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
