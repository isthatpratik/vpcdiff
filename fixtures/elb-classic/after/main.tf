# Fixture elb-classic: an internet-facing Classic Load Balancer with HTTPS open, and an
# internal one that the same rule cannot reach from the internet.
# Synthetic values only. Everything is created by this plan.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.5.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.5.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.5.2.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.b.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.main.id

  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elb" "public" {
  name            = "public"
  subnets         = [aws_subnet.a.id, aws_subnet.b.id]
  security_groups = [aws_security_group.web.id]

  listener {
    lb_port           = 443
    lb_protocol       = "tcp"
    instance_port     = 443
    instance_protocol = "tcp"
  }
}

resource "aws_elb" "internal" {
  name            = "internal"
  internal        = true
  subnets         = [aws_subnet.a.id, aws_subnet.b.id]
  security_groups = [aws_security_group.web.id]

  listener {
    lb_port           = 443
    lb_protocol       = "tcp"
    instance_port     = 443
    instance_protocol = "tcp"
  }
}
