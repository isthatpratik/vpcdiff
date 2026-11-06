# Fixture rule-resources: everything is created by this plan. Rules, routes, and
# associations are separate resources instead of inline blocks.
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
  cidr_block = "10.2.0.0/16"
}

# Lock down the default security group (no rules).
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
}

resource "aws_internet_gateway" "main" {}

resource "aws_internet_gateway_attachment" "main" {
  internet_gateway_id = aws_internet_gateway.main.id
  vpc_id              = aws_vpc.main.id
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.2.1.0/24"
}

# The subnet has no route table association, so it uses the main route table,
# which is the VPC's default route table.
resource "aws_default_route_table" "main" {
  default_route_table_id = aws_vpc.main.default_route_table_id
}

resource "aws_route" "internet" {
  route_table_id         = aws_default_route_table.main.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_network_acl" "app" {
  vpc_id = aws_vpc.main.id
}

resource "aws_network_acl_association" "app" {
  network_acl_id = aws_network_acl.app.id
  subnet_id      = aws_subnet.app.id
}

resource "aws_network_acl_rule" "in" {
  network_acl_id = aws_network_acl.app.id
  rule_number    = 100
  egress         = false
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1
  to_port        = 65535
}

resource "aws_network_acl_rule" "out" {
  network_acl_id = aws_network_acl.app.id
  rule_number    = 100
  egress         = true
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

resource "aws_security_group" "app" {
  name   = "app"
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group_rule" "admin" {
  type              = "ingress"
  security_group_id = aws_security_group.app.id
  protocol          = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_blocks       = ["198.51.100.0/24"]
}

resource "aws_instance" "app" {
  ami                         = var.ami
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.app.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = false
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
}
