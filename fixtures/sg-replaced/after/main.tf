# Fixture sg-replaced, AFTER: the security group is renamed, which forces Terraform to replace it.
# Synthetic values only. To apply for a Reachability Analyzer check, pass a real AMI:
#   terraform apply -var ami=ami-...

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
  cidr_block = "10.4.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "web" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.4.1.0/24"
}

resource "aws_route_table" "web" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "web" {
  subnet_id      = aws_subnet.web.id
  route_table_id = aws_route_table.web.id
}

resource "aws_security_group" "web" {
  name   = "web-v2"
  vpc_id = aws_vpc.main.id

  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami                         = var.ami
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.web.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true
}
