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

- Inline `route` blocks with `cidr_block` and `gateway_id` on `aws_route_table`.
- `aws_route_table_association` with `subnet_id`.
- The main route table of a VPC created in the plan (local route only).

Returns `unknown` with a reason:

- A winning route whose target is not an internet gateway (NAT gateway, instance,
  network interface, peering, transit gateway, VPC endpoint).
- Separate `aws_route` resources, prefix list destinations, and IPv6 routes.
- Two routes with the same prefix length that match (the tie rules are not modeled yet).
- Gateway route tables (associated with the internet gateway itself).
- A VPC that is not created or managed in the plan.
