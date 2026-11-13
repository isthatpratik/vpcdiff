# Fixture modules-local, AFTER: the network is at the root, and a local module "web" holds
# the security group and the instance. The module gets the VPC and the subnet as inputs and
# returns the group ID as an output, the way a company module usually does.
# Synthetic values only. No data sources, so a plan needs no AWS access.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
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

module "web" {
  source = "./modules/web"

  vpc_id    = aws_vpc.main.id
  subnet_id = aws_subnet.public.id
}

output "web_group" {
  value = module.web.group_id
}
