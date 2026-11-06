# Endpoints

An endpoint is a resource that traffic from the internet can arrive at. The engine
evaluates the same hops for every endpoint (see the other notes); what differs is where
the public address comes from, which subnets it can be in, and which rules act as the
allow list.

## EC2 instance (`aws_instance`)

- **Subnet:** `subnet_id`.
- **Public address:** an Elastic IP (`aws_eip`, `aws_eip_association`), else
  `associate_public_ip_address`, else the subnet's `map_public_ip_on_launch`
  ([gateways.md](gateways.md)).
- **Allow rules:** the groups in `vpc_security_group_ids`; an empty list means the VPC's
  default group.

## RDS DB instance (`aws_db_instance`)

- **Subnet:** "Amazon RDS chooses a subnet and an IP address within that subnet group to
  associate with your DB instance." The engine evaluates every subnet of the DB subnet
  group (`db_subnet_group_name` to `aws_db_subnet_group.subnet_ids`). If the results
  differ, the path is `unknown`.
  Source: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html>
- **Public address:** "You control whether your DB instance receives a public IP
  address": `publicly_accessible = true`. Same source.
- **Allow rules:** `vpc_security_group_ids`; empty means the VPC's default group.
- The engine reports the ports the security groups open. It does not narrow them to the
  database's listening `port`.

## Load balancer (`aws_lb`)

- **Subnets:** `subnets` or `subnet_mapping`. An internet-facing load balancer has a node
  in each subnet; the engine evaluates every subnet, and different results give `unknown`.
- **Public address:** `internal = false` (internet-facing).
  Source: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html>
- **Allow rules:** `security_groups`. An Application Load Balancer without groups uses the
  VPC's default group. For a Network Load Balancer without groups: "If you don't assign a
  security group to your Network Load Balancer, all client traffic can reach the Network
  Load Balancer listeners." The engine then uses the `aws_lb_listener` ports (TCP, TLS:
  tcp; UDP: udp; TCP_UDP: both) as allow rules from every address.
  Source: <https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-security-groups.html>
- For an Application Load Balancer, the engine reports the ports the security groups
  open; it does not narrow them to the listener ports.

## Not modeled yet

Aurora (`aws_rds_cluster`, `aws_rds_cluster_instance`), ECS services with
`assign_public_ip`, Classic Load Balancers (`aws_elb`), Gateway Load Balancers, and
instances with `network_interface` blocks. They get a note, or an `unknown` path when a
modeled hop depends on them.
