# Oracle: peering-route-removed

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can `aws_instance.web` (VPC `a`) open a TCP connection to port 5432 on `aws_instance.db`
(VPC `b`)?

## Setup

- `aws_vpc.a` `10.10.0.0/16` and `aws_vpc.b` `10.20.0.0/16` (no overlap), both with
  their default NACL (allows all).
- `aws_vpc_peering_connection.ab` joins them with `auto_accept = true`, so it is active.
- `aws_instance.web` in `aws_subnet.web` (`10.10.1.0/24`) with `aws_security_group.web`
  (out: all to `0.0.0.0/0`). `aws_instance.db` in `aws_subnet.db` (`10.20.1.0/24`) with
  `aws_security_group.db` (in: tcp/5432 from `aws_security_group.web`).
- `aws_route_table.a` (subnet `web`): `10.20.0.0/16` to the peering connection.
- `aws_route_table.b` (subnet `db`): before, `10.10.0.0/16` to the peering connection;
  after, no routes (`route = []`).

## Proof

Hops ([internal-paths.md](../../docs/semantics/internal-paths.md), "Across a VPC peering
connection"):

1. Source SG out: all traffic to `0.0.0.0/0` contains `10.20.1.0/24`. Passes in both.
2. Source route: in `aws_route_table.a`, `10.20.1.0/24` matches `10.20.0.0/16` to
   `aws_vpc_peering_connection.ab`, which joins `a` and `b` and is active. Passes in both.
3. and 4. Default NACLs. Pass.
5. Target SG in: the rule allows tcp/5432 from instances with `aws_security_group.web`;
   group references work across a peering connection in one Region. Passes in both.
6. and 7. Default NACLs for the response. Pass.
8. Target route: the response to `10.10.1.0/24` from `aws_route_table.b`.
   - Before: `10.10.0.0/16` to the peering connection. **Passes.**
   - After: no route contains `10.10.1.0/24`, and the local route `10.20.0.0/16` does
     not. **Blocked.**

## Expected result

| | `aws_instance.web` to `aws_instance.db` tcp/5432 |
|---|---|
| Before | `allowed` |
| After | `blocked` at the target route: `aws_route_table.b` has no route to the subnet of `aws_instance.web` |
| Diff | path **removed** |

## How to verify with Reachability Analyzer

Apply `before/` with a real AMI and analyze a path from `aws_instance.web` to
`aws_instance.db` on TCP 5432: reachable. Apply `after/` and analyze again: not
reachable, explanation at `aws_route_table.b`.
