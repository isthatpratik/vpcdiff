# Fixture instance-eni: an instance launched with an existing network interface; the
# Elastic IP is on the interface.
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
  cidr_block = "10.22.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.22.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
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

resource "aws_network_interface" "web" {
  subnet_id       = aws_subnet.public.id
  security_groups = [aws_security_group.web.id]
}

resource "aws_eip" "web" {
  domain            = "vpc"
  network_interface = aws_network_interface.web.id

  depends_on = [aws_internet_gateway.main]
}

resource "aws_instance" "web" {
  ami           = var.ami
  instance_type = "t3.micro"

  network_interface {
    network_interface_id = aws_network_interface.web.id
    device_index         = 0
  }
}

# The same interface setup without an Elastic IP: the subnet's map_public_ip_on_launch
# does not apply to an existing interface, so this instance has no public address.
resource "aws_network_interface" "quiet" {
  subnet_id       = aws_subnet.public.id
  security_groups = [aws_security_group.web.id]
}

resource "aws_instance" "quiet" {
  ami           = var.ami
  instance_type = "t3.micro"

  network_interface {
    network_interface_id = aws_network_interface.quiet.id
    device_index         = 0
  }
}
