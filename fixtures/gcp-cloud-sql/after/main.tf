# Fixture gcp-cloud-sql: two Cloud SQL instances with public IP addresses. One authorizes an
# office range; the other has no authorized networks, so it refuses every public connection.
# Synthetic values only. Everything is created by this plan. The project is a placeholder.

terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "= 8.11.0" }
  }
}

provider "google" {
  project = "demo-project"
  region  = "us-central1"
}

resource "google_sql_database_instance" "orders" {
  name                = "orders"
  database_version    = "POSTGRES_16"
  region              = "us-central1"
  deletion_protection = false

  settings {
    tier = "db-f1-micro"

    ip_configuration {
      ipv4_enabled = true

      authorized_networks {
        name  = "office"
        value = "203.0.113.0/24"
      }
    }
  }
}

resource "google_sql_database_instance" "reports" {
  name                = "reports"
  database_version    = "MYSQL_8_0"
  region              = "us-central1"
  deletion_protection = false

  settings {
    tier = "db-f1-micro"

    ip_configuration {
      ipv4_enabled = true
    }
  }
}
