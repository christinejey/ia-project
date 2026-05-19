terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Backend credentials and endpoint are passed via environment variables — no -backend-config flags needed.
  # Prerequisites before first apply:
  #   1. Create R2 bucket "ia-project-tfstate" in Cloudflare dashboard
  #   2. Create R2 API token (Object Read & Write on that bucket)
  #   3. Add GitHub Secrets: TF_BACKEND_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  #
  # Local init (one-time):
  #   export AWS_ENDPOINT_URL_S3="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
  #   export AWS_ACCESS_KEY_ID="<R2_ACCESS_KEY_ID>"
  #   export AWS_SECRET_ACCESS_KEY="<R2_SECRET_ACCESS_KEY>"
  #   terraform init
  backend "s3" {
    bucket = "ia-project-tfstate"
    key    = "production/terraform.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    force_path_style            = true
  }
}
