# Fixture modules-web, AFTER: a web server built from public terraform-aws-modules.
# Synthetic values only. No data sources, so a plan needs no AWS access.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = "web"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b"]
  public_subnets  = ["10.0.1.0/24"]
  private_subnets = ["10.0.11.0/24"]

  enable_nat_gateway = false
}

module "web_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "6.0.0"

  name   = "web"
  vpc_id = module.vpc.vpc_id

  ingress_rules = {
    https = { from_port = 443, to_port = 443, ip_protocol = "tcp", cidr_ipv4 = "0.0.0.0/0" }
    ssh   = { from_port = 22, to_port = 22, ip_protocol = "tcp", cidr_ipv4 = "10.0.0.0/16" }
  }
}

# The ec2-instance module always reads an SSM parameter for the AMI, so it cannot be
# planned without AWS access. A plain instance references the modules' outputs instead.
resource "aws_instance" "web" {
  ami                         = "ami-00000000000000000"
  instance_type               = "t3.micro"
  subnet_id                   = module.vpc.public_subnets[0]
  vpc_security_group_ids      = [module.web_sg.id]
  associate_public_ip_address = true
}
