# Fixture aurora-public: an Aurora PostgreSQL cluster whose instance is publicly accessible.
# Synthetic values only. Everything is created by this plan.
# The password is a placeholder for planning; do not apply as is.

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

resource "aws_security_group" "db" {
  name   = "db"
  vpc_id = aws_vpc.main.id

  ingress {
    protocol    = "tcp"
    from_port   = 5432
    to_port     = 5432
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "aurora-subnets"
  subnet_ids = [aws_subnet.a.id, aws_subnet.b.id]
}

resource "aws_rds_cluster" "main" {
  cluster_identifier     = "main"
  engine                 = "aurora-postgresql"
  master_username        = "app"
  master_password        = "placeholder-not-a-secret"
  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = true
}

resource "aws_rds_cluster_instance" "a" {
  identifier          = "main-a"
  cluster_identifier  = aws_rds_cluster.main.id
  instance_class      = "db.r6g.large"
  engine              = aws_rds_cluster.main.engine
  publicly_accessible = true
}
