# Transit Gateway paths between VPCs (#94)

A path inside the VPC ([internal-paths.md](internal-paths.md)) can go from a source `A` in
one VPC to a target `T` in another VPC through a transit gateway. The engine checks it
when the route to the other subnet uses a transit gateway that is in the plan, with the
same eight hops. Hops 2 and 8 check the transit gateway instead of the local route, and
the security group hops follow the rules for group references across a transit gateway.

Internet paths whose response route uses a transit gateway stay `unknown`: the traffic
leaves the VPC, and the engine does not follow it to another VPC's internet gateway.

## AWS rules

1. **Routing between attachments.** "When a packet comes from one attachment, it is
   routed to another attachment using the route that matches the destination IP
   address." Routes are evaluated by "the most specific route for the destination
   address". "When a static route and a propagated route have the same destination, the
   static route has the higher priority."
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html>
2. **One associated route table.** "You can associate a transit gateway attachment with
   a single route table." The route table associated with the attachment that the
   packet comes from decides where it goes. An attachment without an association has no
   route table, so the transit gateway drops its traffic.
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html#tgw-route-table-association-overview>
3. **Default route table.** "By default, this route table is the default association
   route table and the default propagation route table." "If either route propagation or
   route table association is enabled, AWS then creates a default route table." When the
   default table exists, the Terraform provider associates an attachment with it, and
   propagates the attachment to it, when the attachment has
   `transit_gateway_default_route_table_association` (or `_propagation`) `true`, the
   default. It does this whatever the gateway's own `default_route_table_association`
   says, and it removes the association when the flag is `false`.
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html>
   Source: <https://github.com/hashicorp/terraform-provider-aws/blob/v6.72.0/internal/service/ec2/transitgateway_vpc_attachment.go>
4. **Propagated routes.** "For a VPC attachment, the CIDR blocks of the VPC are
   propagated to the transit gateway route table."
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html#tgw-route-propagation-overview>
5. **Blackhole routes.** "You can create a blackhole route in your transit gateway
   route table that drops traffic that matches the route."
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html>
6. **Availability Zones.** "Only resources that reside in Availability Zones where there
   is a transit gateway attachment can reach the transit gateway." An attachment subnet
   enables its zone: "traffic can be routed to all subnets in that Availability Zone,
   not just the one you specified." Traffic from the transit gateway enters the VPC at
   an attachment subnet; "If traffic is sourced from an Availability Zone that the
   destination attachment is not present in, AWS Transit Gateway will internally route
   that traffic to a random Availability Zone where the attachment is present."
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html#tgw-az-overview>
7. **Overlapping CIDRs.** "A transit gateway doesn't support routing between VPCs with
   identical CIDRs", and when a newly attached VPC's CIDR overlaps another attached
   VPC's CIDR, "the routes for the newly attached VPC aren't propagated". Which VPC was
   attached first is not in the plan.
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html>
8. **Security group references.** "You can cross-reference security groups in inbound
   rules only. Outbound security rules do not support security group referencing."
   Referencing "will only work if it has been enabled for both a transit gateway and its
   VPC attachments". The default is `enable` on an attachment and `disable` on a transit
   gateway.
   Source: <https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html#vpc-attachment-security>
   Source: <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateTransitGatewayVpcAttachmentRequestOptions.html>

## Hops

Hop 2 (`source-route`) checks the request from `A` to `T`'s subnet. Hop 8
(`target-route`) checks the response from `T` to `A`'s subnet in the same way, with the
roles swapped. Each check passes these steps in order:

1. In the sender's subnet route table, every address of the other subnet uses routes to
   one transit gateway `X`, by longest prefix match. No route gives `blocked`; a
   blackhole route gives `blocked`.
2. `X` is an `aws_ec2_transit_gateway` in the plan, and the sender's VPC has exactly one
   `aws_ec2_transit_gateway_vpc_attachment` to `X`.
3. The sender's subnet is in an Availability Zone of that attachment's subnets.
   Otherwise `blocked`.
4. The attachment is associated with a route table of `X`: by
   `aws_ec2_transit_gateway_route_table_association`, or the default route table (rule
   3). No association gives `blocked`.
5. In that table, every address of the other subnet uses routes to the other VPC's
   attachment to `X`. Static routes (`aws_ec2_transit_gateway_route`) and propagated
   routes (`aws_ec2_transit_gateway_route_table_propagation`, or the default
   propagation) take part. No route, a blackhole route, or a route to an attachment of a
   third VPC gives `blocked`.
6. The traffic enters the other VPC at one of that attachment's subnets. In each of
   their route tables, the other subnet uses the local route.

Security groups (hops 1 and 5) across a transit gateway:

- Hop 1: an outbound rule of `A` that names a group of `T` does not match. Only a CIDR
  rule can allow the request.
- Hop 5: an inbound rule of `T` that names a group of `A` matches only when
  `security_group_referencing_support` is `enable` on `X` and on both attachments.
  Otherwise only a CIDR rule can allow the request, and the reason says so.

## Returns `unknown` with a reason

- The transit gateway, an attachment, or a transit gateway route table is not in the
  plan, or a reference to one is unknown until apply and cannot be matched to one
  resource.
- The sender's VPC has no attachment or more than one attachment to `X`.
- The Availability Zone of the sender's subnet or of an attachment subnet is unknown
  until apply.
- An attachment has both the default association and an explicit association without
  `replace_existing_association`.
- A route to the other subnet targets an attachment that is not a VPC attachment in the
  plan (VPN, peering, Connect).
- Two routes with the same destination of the same kind, or two propagated routes from
  different attachments that overlap where the other subnet is (rule 7).
- The two VPCs have overlapping CIDR blocks.
- A route covers only part of the other subnet, and the parts decide differently.
- In some attachment subnets of the other VPC, the other subnet does not use the local
  route (a middlebox route).
- `security_group_referencing_support` is unknown until apply on `X` or an attachment,
  and only a group reference would allow the request.
- A resource that changes transit gateway routing and is not modeled yet:
  `aws_ec2_transit_gateway_default_route_table_association`,
  `aws_ec2_transit_gateway_default_route_table_propagation`,
  `aws_ec2_transit_gateway_prefix_list_reference`,
  `aws_ec2_transit_gateway_vpc_attachment_accepter`.

## Scope

- IPv4 only, like the other paths inside the VPC.
- Appliance mode does not change the result: the engine requires the local route in every
  attachment subnet of the other VPC, so the zone the transit gateway picks does not
  matter.
- Security group referencing is not supported in the zone `use1-az3`. The plan names
  zones (for example `us-east-1a`), not zone IDs, so the engine cannot check this.
- Transit gateway peering, VPN, and Direct Connect attachments are not modeled.

## Edge cases

- **Blackhole route** in the transit gateway route table: `blocked` at the hop.
- **Missing association**: the attachment has the default association turned off and
  no `aws_ec2_transit_gateway_route_table_association`: `blocked`.
- **Overlapping CIDRs**: the two VPCs overlap, or two other VPCs propagate overlapping
  routes where the other subnet is: `unknown`.
- **Isolated route tables**: each attachment is associated with its own table, and a
  table has no route back. The request hop allows and the response hop gives `blocked`.
