# Fixture tgw-blackhole, AFTER: the plan adds a blackhole route for the db subnet to the
# transit gateway's default route table. It is more specific than the propagated route of VPC b.
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
  cidr_block = "10.30.0.0/16"
}

resource "aws_vpc" "b" {
  cidr_block = "10.40.0.0/16"
}

resource "aws_subnet" "web" {
  vpc_id            = aws_vpc.a.id
  cidr_block        = "10.30.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "db" {
  vpc_id            = aws_vpc.b.id
  cidr_block        = "10.40.1.0/24"
  availability_zone = "us-east-1a"
}

# Security group references across the transit gateway need it on the gateway too.
resource "aws_ec2_transit_gateway" "hub" {
  security_group_referencing_support = "enable"
}

resource "aws_ec2_transit_gateway_vpc_attachment" "a" {
  transit_gateway_id = aws_ec2_transit_gateway.hub.id
  vpc_id             = aws_vpc.a.id
  subnet_ids         = [aws_subnet.web.id]
}

resource "aws_ec2_transit_gateway_vpc_attachment" "b" {
  transit_gateway_id = aws_ec2_transit_gateway.hub.id
  vpc_id             = aws_vpc.b.id
  subnet_ids         = [aws_subnet.db.id]
}

resource "aws_route_table" "a" {
  vpc_id = aws_vpc.a.id

  route {
    cidr_block         = "10.40.0.0/16"
    transit_gateway_id = aws_ec2_transit_gateway.hub.id
  }

  depends_on = [aws_ec2_transit_gateway_vpc_attachment.a]
}

resource "aws_route_table" "b" {
  vpc_id = aws_vpc.b.id

  route {
    cidr_block         = "10.30.0.0/16"
    transit_gateway_id = aws_ec2_transit_gateway.hub.id
  }

  depends_on = [aws_ec2_transit_gateway_vpc_attachment.b]
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

resource "aws_ec2_transit_gateway_route" "quarantine" {
  destination_cidr_block         = "10.40.1.0/24"
  blackhole                      = true
  transit_gateway_route_table_id = aws_ec2_transit_gateway.hub.association_default_route_table_id
}
