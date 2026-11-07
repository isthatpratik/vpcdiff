# Fixture peering-route-removed, AFTER: the plan removes VPC b's route back to VPC a.
# Synthetic values only. To apply for a Reachability Analyzer check, pass a real AMI.

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

resource "aws_vpc" "a" {
  cidr_block = "10.10.0.0/16"
}

resource "aws_vpc" "b" {
  cidr_block = "10.20.0.0/16"
}

resource "aws_subnet" "web" {
  vpc_id     = aws_vpc.a.id
  cidr_block = "10.10.1.0/24"
}

resource "aws_subnet" "db" {
  vpc_id     = aws_vpc.b.id
  cidr_block = "10.20.1.0/24"
}

resource "aws_vpc_peering_connection" "ab" {
  vpc_id      = aws_vpc.a.id
  peer_vpc_id = aws_vpc.b.id
  auto_accept = true
}

resource "aws_route_table" "a" {
  vpc_id = aws_vpc.a.id

  route {
    cidr_block                = "10.20.0.0/16"
    vpc_peering_connection_id = aws_vpc_peering_connection.ab.id
  }
}

resource "aws_route_table" "b" {
  vpc_id = aws_vpc.b.id

  # route is computed: removing the blocks keeps the old routes, so an empty list
  # removes them (attributes as blocks).
  route = []
}

resource "aws_route_table_association" "web" {
  subnet_id      = aws_subnet.web.id
  route_table_id = aws_route_table.a.id
}

resource "aws_route_table_association" "db" {
  subnet_id      = aws_subnet.db.id
  route_table_id = aws_route_table.b.id
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.a.id

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "db"
  vpc_id = aws_vpc.b.id

  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.web.id]
  }
}

resource "aws_instance" "web" {
  ami                    = var.ami
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.web.id
  vpc_security_group_ids = [aws_security_group.web.id]
}

resource "aws_instance" "db" {
  ami                    = var.ami
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.db.id
  vpc_security_group_ids = [aws_security_group.db.id]
}
