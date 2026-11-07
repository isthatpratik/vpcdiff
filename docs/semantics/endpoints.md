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

## Aurora cluster instance (`aws_rds_cluster_instance`)

- **Security groups:** the cluster's `vpc_security_group_ids`. "In an Aurora DB cluster,
  the VPC security group associated with the DB cluster is also associated with all of
  the DB instances in the DB cluster."
  Source: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Overview.RDSSecurityGroups.html>
- **Subnet:** the instance's `db_subnet_group_name`, else the cluster's. Every subnet of
  the group is evaluated, as for RDS.
- **Public address:** `publicly_accessible` on the instance.
- **Cluster:** found by `cluster_identifier`, or by the configuration reference when the
  value is unknown until apply. A cluster that is not in the plan gives `unknown`.

## ECS service (`aws_ecs_service`)

- Only services with `network_configuration` (awsvpc networking) are endpoints. Each
  task gets its own network interface in one of `subnets`; every subnet is evaluated.
  Source: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html>
- **Public address:** `assign_public_ip = true` on Fargate (`launch_type = "FARGATE"`,
  or only `FARGATE` / `FARGATE_SPOT` capacity providers). On the EC2 or EXTERNAL launch
  type: "your task ENIs aren't given public IP addresses." Other capacity providers give
  `unknown`.
- **Security groups:** `network_configuration.security_groups`; none means the VPC's
  default group ("If you don't specify a security group, the default security group for
  the VPC is used").
  Source: <https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_AwsVpcConfiguration.html>
- Services without `network_configuration` (bridge or host mode) share the container
  instance's interface. They get a note and no path.

## Classic Load Balancer (`aws_elb`)

- **Subnets:** `subnets`; a node in each. A load balancer placed with
  `availability_zones` only is outside a VPC in this plan and gives `unknown`.
- **Public address:** internet-facing unless `internal = true`. Unset, `internal` is
  computed; "By default, Elastic Load Balancing creates an Internet-facing load
  balancer."
  Source: <https://docs.aws.amazon.com/elasticloadbalancing/2012-06-01/APIReference/API_CreateLoadBalancer.html>
- **Security groups:** `security_groups`; none means the VPC's default group ("your load
  balancer is automatically associated with the default security group for the VPC").
  Source: <https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/elb-vpc-security-groups.html>
- Like an Application Load Balancer, the engine reports the ports the groups open; it
  does not narrow them to the listener ports.

## Interface VPC endpoint (`aws_vpc_endpoint`, `vpc_endpoint_type = "Interface"`)

- "For each subnet that you specify from your VPC, we create an endpoint network
  interface in the subnet and assign it a private IP address from the subnet address
  range." So it is a target for paths inside the VPC, never from the internet.
- **Security groups:** `security_group_ids`; "By default, we associate the default
  security group for the VPC."
  Source: <https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html>

## Gateway VPC endpoint (`vpc_endpoint_type = "Gateway"`)

- Not an endpoint for paths. AWS adds a route to the service's prefix list in each of
  its route tables (`route_table_ids`, `aws_vpc_endpoint_route_table_association`).
  Source: <https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html#route-tables-vpce>
- The list is AWS-managed and cannot be expanded offline. Responses to internet clients
  in it are undecided. It holds the service's public ranges ("the IP address ranges for
  Amazon S3"), so it cannot match a subnet in private address space (RFC 1918 or
  100.64.0.0/10); paths between such subnets get no doubt from it.

## Not modeled yet

Gateway Load Balancers and their endpoints, ECS services in bridge or host mode, and instances with
`network_interface` blocks. They get a note, or an `unknown` path when a modeled hop
depends on them.
