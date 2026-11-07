# Fixture secondary-cidr: the app and db subnets are in a secondary CIDR block of the VPC.
# Synthetic values only. Everything is created by this plan. To apply for a Reachability
# Analyzer check, pass a real AMI.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "ami" {
  type    = string
  default = "ami-00000000000000000"
}

resource "aws_vpc" "main" {
  cidr_block = "10.20.0.0/16"
}

resource "aws_vpc_ipv4_cidr_block_association" "extra" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.21.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.21.1.0/24"

  depends_on = [aws_vpc_ipv4_cidr_block_association.extra]
}

resource "aws_subnet" "db" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.21.2.0/24"

  depends_on = [aws_vpc_ipv4_cidr_block_association.extra]
}

resource "aws_security_group" "app" {
  name   = "app"
  vpc_id = aws_vpc.main.id

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "db"
  vpc_id = aws_vpc.main.id

  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_instance" "app" {
  ami                    = var.ami
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.app.id]
}

resource "aws_instance" "db" {
  ami                    = var.ami
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.db.id
  vpc_security_group_ids = [aws_security_group.db.id]
}
