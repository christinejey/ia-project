terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Sensitive and version-specific backend params are injected at init time via backend.hcl.
  # CI generates terraform/backend.hcl from GitHub Secrets before running terraform init.
  #
  # Local init (one-time):
  #   create terraform/backend.hcl with content from terraform/backend.hcl.example
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    bucket = "ia-project-tfstate"
    key    = "production/terraform.tfstate"
    region = "us-east-1"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
  }
}
