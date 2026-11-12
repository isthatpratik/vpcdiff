# Oracle: tgw-blackhole

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can `aws_instance.web` (VPC a) open a TCP connection to port 5432 on `aws_instance.db`
(VPC b) through `aws_ec2_transit_gateway.hub`, before and after the plan?

## Setup

- `aws_vpc.a` (`10.30.0.0/16`) with `aws_subnet.web` (`10.30.1.0/24`, `us-east-1a`).
  `aws_vpc.b` (`10.40.0.0/16`) with `aws_subnet.db` (`10.40.1.0/24`, `us-east-1a`).
  Default NACLs (allow all).
- `aws_ec2_transit_gateway.hub`: default association and propagation (the defaults),
  `security_group_referencing_support = "enable"`.
- `aws_ec2_transit_gateway_vpc_attachment.a` (subnet `web`) and `.b` (subnet `db`), with
  the default association and propagation (the defaults). Attachment referencing is
  `enable` by default.
- `aws_route_table.a`: `10.40.0.0/16` to the transit gateway. `aws_route_table.b`:
  `10.30.0.0/16` to the transit gateway.
- `aws_security_group.web`: out all to `0.0.0.0/0`. `aws_security_group.db`: in tcp/5432
  from `aws_security_group.web`.
- **After only:** `aws_ec2_transit_gateway_route.quarantine`, `10.40.1.0/24` blackhole in
  the default route table.

Rules: [transit-gateway.md](../../docs/semantics/transit-gateway.md).

## Proof, before

1. **Source security group, outbound.** All traffic to `0.0.0.0/0` covers `10.40.1.0/24`.
   Passes.
2. **Source route.** `aws_route_table.a` sends `10.40.0.0/16` (which contains
   `10.40.1.0/24`) to the transit gateway. Attachment `a` has a subnet in `us-east-1a`,
   the zone of `web`. Attachment `a` is associated with the default route table (rule 3).
   That table has the propagated routes `10.30.0.0/16` to attachment `a` and
   `10.40.0.0/16` to attachment `b` (rule 4). `10.40.1.0/24` matches `10.40.0.0/16`, to
   attachment `b` of VPC b. Attachment `b` enters VPC b at subnet `db`, whose route table
   has the local route for `10.40.0.0/16`. Passes.
3. and 4. **NACLs.** Default NACLs allow all. Pass.
5. **Target security group, inbound.** tcp/5432 from the group of `web`. Referencing is
   `enable` on the gateway and on both attachments, so the reference matches across the
   transit gateway (rule 8). Passes.
6. and 7. **NACLs for the response.** Pass.
8. **Target route.** The same as step 2 in the other direction: `aws_route_table.b`
   sends `10.30.0.0/16` to the gateway, attachment `b` has a subnet in `us-east-1a`, and
   the default route table sends `10.30.1.0/24` to attachment `a`. Passes.

Result: `allowed`.

## Proof, after

1. **Source security group, outbound.** Passes, as before.
2. **Source route.** In the default route table, `10.40.1.0/24` (blackhole) is more
   specific than the propagated `10.40.0.0/16`, so it wins (rule 1). "You can create a
   blackhole route in your transit gateway route table that drops traffic that matches
   the route" (rule 5). Fails.

Result: `blocked` at `source-route`.

## Expected result

| | `aws_instance.web` to `aws_instance.db` tcp/5432 |
|---|---|
| Before | `allowed` |
| After | `blocked` at `source-route` (the blackhole route) |
| Diff | path **removed** |

## How to verify with Reachability Analyzer

Use a throwaway account that the maintainer names for the run. Apply `before/` with a real
AMI and analyze a path from `aws_instance.web` to `aws_instance.db` on TCP 5432:
reachable. Apply `after/` and analyze again: not reachable, with the blackhole route as
the explanation.
