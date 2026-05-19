terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Dynamic backend values (endpoint, credentials) are passed via -backend-config flags at init time.
  # See .github/workflows/tf-plan.yml and tf-apply.yml for CI usage.
  #
  # Local init:
  #   terraform init \
  #     -backend-config="endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  #     -backend-config="access_key=<R2_ACCESS_KEY_ID>" \
  #     -backend-config="secret_key=<R2_SECRET_ACCESS_KEY>" \
  #     -backend-config="skip_requesting_account_id=true"
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
