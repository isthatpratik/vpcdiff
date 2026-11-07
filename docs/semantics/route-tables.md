# Route tables

## AWS rules

1. **Main route table.** It "controls the routing for all subnets that are not
   explicitly associated with any other route table."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>
2. **Local route.** Every route table has "a default route for communication within
   the VPC" for the VPC's CIDR blocks.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>
3. **Longest prefix match.** "We direct traffic using the most specific route that
   matches the traffic." For example, `10.10.2.15/32` has priority over `10.10.2.0/24`.
   When routes overlap or match, more rules apply (static routes before prefix list
   routes, then propagated routes).
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html>

## Terraform differences

- On `aws_route_table`, "the default route, mapping the VPC's CIDR block to 'local',
  is created implicitly and cannot be specified."
  Source: <https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table>
- Routes can be inline `route` blocks or separate `aws_route` resources.
- A subnet is associated through `aws_route_table_association`. Without one, it uses
  the main route table. The main route table of a new VPC contains only the local route,
  unless `aws_default_route_table` or `aws_main_route_table_association` changes it.

## Engine behavior

For traffic from the internet to an instance, the request enters through the internet
gateway and reaches the instance through the local route. The response leaves the
subnet through the subnet's route table. The engine checks the response route:

- Find the subnet's route table (explicit association, else the main route table).
- Choose the route by longest prefix match for the client address.
- `allowed` if the target is the VPC's internet gateway.
- `blocked` if no route matches. The client address is outside the VPC, so the local
  route never matches it.

The result names the deciding route: table, destination CIDR, and target.

## Slice 1 scope

Handled:

- Inline `route` blocks with `cidr_block` and `gateway_id` on `aws_route_table`, and
  `aws_route` resources.
- `aws_route_table_association` with `subnet_id`.
- The main route table: the table set by `aws_main_route_table_association`, else the
  VPC's default route table. `aws_default_route_table` removes all routes when Terraform
  adopts it, then adds its configured routes. Unmanaged, it has only the local route.
  Source: <https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/default_route_table>

Response routes that block (#33):

- **NAT gateway** (`nat_gateway_id`, or a NAT gateway ID in `gateway_id`): "Connections
  must always be initiated from within the VPC containing the NAT gateway." A response
  to a client on the internet that is routed to a NAT gateway does not return.
  Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html>
- **VPC peering connection:** "If VPC A has an internet gateway, resources in VPC B
  can't use the internet gateway in VPC A to access the internet." (no edge to edge
  routing). Source: <https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html>
- **Blackhole route** (`state = "blackhole"` on an `aws_route`): the target no longer
  exists and AWS drops the traffic.
  Source: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>

Sources whose responses use one of these routes are left out of the allowed sources; a
more specific route to the internet gateway still allows its own sources.

Returns `unknown` with a reason:

- A winning route whose target routes on outside the plan: transit gateway, network
  interface (a middlebox), VPN gateway, VPC endpoint, carrier or local gateway.
- IPv6 routes (skipped for IPv4 traffic).

Prefix list destinations (#33): a customer-managed list in the plan gives one route per
entry, each with its own prefix length. A list outside the plan (for example the
AWS-managed list that a gateway endpoint adds for S3) cannot be expanded: responses to
its addresses are undecided, and the rest of the path is still decided. If no other route
decides, the result is `unknown`.
- Route propagation from a virtual private gateway (`propagating_vgws`,
  `aws_vpn_gateway_route_propagation`).
- Two routes with the same prefix length that match (the tie rules are not modeled yet).
- Gateway route tables (associated with the internet gateway itself).
- A VPC that is not created or managed in the plan.
