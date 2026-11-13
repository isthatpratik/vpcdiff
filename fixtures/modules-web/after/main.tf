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
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets = ["10.0.11.0/24", "10.0.12.0/24"]

  enable_nat_gateway = false
}

module "web_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "6.0.0"

  name   = "web"
  vpc_id = module.vpc.vpc_id

  ingress_with_cidr_blocks = [
    { from_port = 443, to_port = 443, protocol = "tcp", cidr_ipv4 = "0.0.0.0/0" },
    { from_port = 22, to_port = 22, protocol = "tcp", cidr_ipv4 = "10.0.0.0/16" },
  ]
}

module "web" {
  source  = "terraform-aws-modules/ec2-instance/aws"
  version = "6.4.1"

  name                        = "web"
  ami                         = "ami-00000000000000000"
  instance_type               = "t3.micro"
  subnet_id                   = module.vpc.public_subnets[0]
  vpc_security_group_ids      = [module.web_sg.security_group_id]
  associate_public_ip_address = true
  create_security_group       = false
}
