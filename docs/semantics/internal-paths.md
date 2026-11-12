# Paths inside the VPC

A path inside the VPC goes from one endpoint in the plan (the **source**) to another
(the **target**), where a security group of the target allows traffic from a security
group of the source. Example: an Application Load Balancer to its targets, or an
application instance to its database.

## Which paths are checked

- The engine checks a path from source `A` to target `T` when an ingress rule of a
  group of `T` references a group of `A`, on either side of the plan: by
  `security_groups`, `source_security_group_id`, `referenced_security_group_id`, or
  `self`. `A` and `T` are different endpoints.
- The ports checked are the ports of those rules.
- A group reference is the trigger, but every rule decides the hop. A CIDR rule that
  covers the whole source subnet also allows the traffic.
- A load balancer without security groups is never a source: its targets see the
  client's address. A rule that references a group whose ID is outside the plan has no
  source in the plan, so no path is checked.

## AWS rules

1. **A group as a source or destination.** "When you specify a security group as the
   source or destination for a rule, the rule affects all instances that are associated
   with the security groups. The instances can communicate in the specified direction,
   using the private IP addresses of the instances, over the specified protocol and
   port." `self` names the rule's own group.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html>
2. **Outbound rules of the source.** A connection that starts at the source needs an
   outbound rule of one of the source's groups. The response is allowed without an
   inbound rule, because groups are stateful.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
3. **Network ACLs filter traffic that enters or leaves a subnet.** "We evaluate the
   network ACL rules when traffic enters and leaves the subnet, not as it is routed
   within a subnet." So no NACL applies between two interfaces in the same subnet.
   Between two subnets, the request leaves the source subnet and enters the target
   subnet, and the response does the reverse. "NACLs are *stateless*", so all four
   directions need a rule.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html>
4. **The local route.** "Every route table contains a local route for communication
   within the VPC." A route can be more specific than the local route and send part of
   the VPC range to a middlebox.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html>
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html>
   When such a route sends traffic through a middlebox, "If you reference the security
   group of the other instance as the source, this does not allow traffic to flow
   between the instances." The engine returns `unknown` for that case.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html>

## Hops

In path order. Each hop decides allow, deny, or unknown.

1. **Source security groups (outbound).** A rule matches the protocol and port, and its
   destination is a group of `T`, or a CIDR that contains `T`'s whole subnet.
2. **Source route.** In `A`'s route table, `T`'s subnet uses the local route.
3. **Source NACL outbound.** `A`'s subnet NACL lets the request out to `T`'s subnet.
4. **Target NACL inbound.** `T`'s subnet NACL lets the request in from `A`'s subnet.
5. **Target security groups (inbound).** A rule matches, and its source is a group of
   `A`, or a CIDR that contains `A`'s whole subnet.
6. **Target NACL outbound.** `T`'s subnet NACL lets the response out to `A`'s subnet,
   on the client's ephemeral ports (1024-65535, as for internet paths).
7. **Source NACL inbound.** `A`'s subnet NACL lets the response in from `T`'s subnet.
8. **Target route.** In `T`'s route table, `A`'s subnet uses the local route.

When `A` and `T` are in the same subnet, hops 3, 4, 6, and 7 allow with the rule
"same subnet: no network ACL applies".

## The address problem

The plan does not say which private address an endpoint gets, only its subnet. So an
address check is decided only when the answer is the same for every address in the
subnet:

- A rule or NACL entry that covers the whole subnet decides it.
- One that covers part of the subnet gives `unknown`, with the reason.

## Returns `unknown` with a reason

- `A` and `T` are in different VPCs and a route to the other subnet uses neither a VPC
  peering connection nor a transit gateway (VPN and other targets are not modeled for
  paths between VPCs). Transit gateway paths: [transit-gateway.md](transit-gateway.md).
- A peering connection that is not accepted in the plan (no `auto_accept`, no
  `aws_vpc_peering_connection_accepter`, no `active` status), or VPCs with overlapping
  CIDR blocks ("You cannot create a VPC peering connection between VPCs that have
  matching or overlapping IPv4 or IPv6 CIDR blocks").
- A route more specific than the local route covers part of the other subnet.
- A rule or NACL entry covers only part of the other subnet.
- A rule of `T` that could match references a group that is unknown until apply, and
  no other rule allows the traffic. The same for an outbound rule of `A`.
- The response is allowed for some ephemeral ports only.
- An endpoint has several placements (RDS, load balancers) and they disagree.

## Across a VPC peering connection (#33)

When `A` and `T` are in different VPCs, hops 2 and 8 check peering instead of the local
route. "To enable the flow of traffic between the VPCs using private IP addresses, the
owner of each VPC in the VPC peering connection must manually add a route to one or more
of their VPC route tables that points to the IP address range of the other VPC."

- Every address of the other subnet must use routes to one peering connection, by
  longest prefix match, in the source's table (hop 2) and the target's table (hop 8).
- That connection must join the two VPCs (`vpc_id`, `peer_vpc_id`) and be active.
- No route gives `blocked`; a NAT gateway or blackhole route gives `blocked`.
- Group references across a peering connection work as in one VPC ("If both VPCs are
  in the same Region, you can reference a security group from the peer VPC").
- Source: <https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html>

## Notes instead of paths

Some cases hide which group a rule references, so no candidate path can be found. The
result then has a note for the resource, which names the targets whose paths are not
checked:

- A rule that references a group that is unknown until apply.
- An endpoint whose security groups are unknown until apply.
- A security group whose inbound rules are unknown until apply.

## Result format

- `Path.from` is the source's address, and `Path.fromType` its resource type. For
  internet paths `from` stays `internet` and `fromType` is absent.
- New hop kinds: `source-security-group`, `source-route`, `source-nacl-outbound`,
  `target-nacl-inbound`, `target-nacl-outbound`, `source-nacl-inbound`, `target-route`.
  Hop 5 uses `security-group`.
- When allowed, `sources` is `[A]`.
- The result format is `0.2`.

## Edge cases

- **Cycles.** Groups that reference each other give one path in each direction. Each
  path is checked on its own, so a cycle needs no special handling.
- **Self references.** `self` on a group that both endpoints share gives a path in
  each direction.
- **Missing groups.** A known ID outside the plan is ignored (no source in the plan).
- **Unknown after apply.** A group ID from the configuration resolves when it names one
  resource; otherwise the rule keeps a reason and the hop can be `unknown`.
