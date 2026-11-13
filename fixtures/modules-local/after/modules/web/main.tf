variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = var.vpc_id

  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami                         = "ami-00000000000000000"
  instance_type               = "t3.micro"
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true
}

output "group_id" {
  value = aws_security_group.web.id
}
