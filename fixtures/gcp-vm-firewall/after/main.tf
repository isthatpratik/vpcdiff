# Fixture gcp-vm-firewall: Google Cloud VPC firewall rules for two VMs. A deny rule with a
# lower priority number carves a range out of an allow rule; a disabled rule and a rule
# with source tags only do not open anything to the internet.
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

resource "google_compute_network" "main" {
  name                    = "main"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "app" {
  name          = "app"
  network       = google_compute_network.main.id
  ip_cidr_range = "10.50.1.0/24"
  region        = "us-central1"
}

# SSH from anywhere to VMs tagged "web".
resource "google_compute_firewall" "ssh" {
  name          = "allow-ssh"
  network       = google_compute_network.main.name
  priority      = 1000
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# A lower number wins: this range cannot reach SSH.
resource "google_compute_firewall" "block_range" {
  name          = "deny-range"
  network       = google_compute_network.main.name
  priority      = 900
  source_ranges = ["198.51.100.0/24"]

  deny {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Disabled: as if it did not exist.
resource "google_compute_firewall" "http_off" {
  name          = "allow-http"
  network       = google_compute_network.main.name
  source_ranges = ["0.0.0.0/0"]
  disabled      = true

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }
}

# Source tags never match an internet address.
resource "google_compute_firewall" "from_bastion" {
  name        = "allow-from-bastion"
  network     = google_compute_network.main.name
  source_tags = ["bastion"]

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-micro"
  zone         = "us-central1-a"
  tags         = ["web"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
    access_config {}
  }
}

# Tagged "web" too, but without an external IP address.
resource "google_compute_instance" "worker" {
  name         = "worker"
  machine_type = "e2-micro"
  zone         = "us-central1-a"
  tags         = ["web"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
  }
}
