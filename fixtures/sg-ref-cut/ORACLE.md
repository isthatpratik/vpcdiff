# Oracle: sg-ref-cut

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can `aws_instance.app` open a TCP connection to port 5432 on `aws_instance.db`?

## Setup

- `aws_vpc.main`: `10.4.0.0/16`, created by Terraform. No internet gateway.
- No route table is managed, so both subnets use the VPC's main route table, which has
  only the local route `10.4.0.0/16`.
- Both instances are private: no `associate_public_ip_address`, and the subnets do not
  set `map_public_ip_on_launch`. So there is no path from the internet.
- Each instance has one security group, created by Terraform, with one egress rule:
  all traffic to `0.0.0.0/0`.
- `aws_instance.app` in `aws_subnet.app` (`10.4.1.0/24`) with `aws_security_group.app`.
- `aws_instance.db` in `aws_subnet.db` (`10.4.2.0/24`) with `aws_security_group.db`,
  which allows tcp/5432 from the group `aws_security_group.app`. Same in both.
- The only change: the plan creates `aws_network_acl.db` for `aws_subnet.db`. Inbound
  rule 100 denies tcp/5432 from `10.4.1.0/24`, rule 200 allows all; outbound rule 100
  allows all.

## Proof

Hops in path order ([internal-paths.md](../../docs/semantics/internal-paths.md),
"Hops"). The source address is some address in `10.4.1.0/24`.

1. **Source security group, outbound.** The `app` group's egress rule allows all
   traffic to `0.0.0.0/0`, which contains all of `10.4.2.0/24`.
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 2. Passes in both.
2. **Source route.** Longest prefix match for `10.4.2.0/24` in the main route table: only
   the local route `10.4.0.0/16` contains it.
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 4. Passes in both.
3. **Source NACL, outbound.** `aws_subnet.app` uses the VPC's default NACL, which allows all
   traffic. [network-acls.md](../../docs/semantics/network-acls.md) rule 5. Passes in both.
4. **Target NACL, inbound.** 
   - Before: `aws_subnet.db` uses the default NACL, which allows all. **Passes.**
   - After: `aws_subnet.db` is associated with `aws_network_acl.db`. Rules are checked
     from the lowest number ([network-acls.md](../../docs/semantics/network-acls.md)
     rule 2). Rule 100 matches tcp/5432 from `10.4.1.0/24`, which contains every
     possible source address, and denies it. **Blocked.**
5. **Target security group, inbound.** The rule allows tcp/5432 from instances
   associated with `aws_security_group.app`, and `aws_instance.app` is one.
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 1. Passes before
   (after, the path stops at hop 4).
6. **Target NACL, outbound (response).** Before: default NACL, allowed.
7. **Source NACL, inbound (response).** Default NACL, allowed.
8. **Target route.** The local route contains `10.4.1.0/24`. Passes.

## Expected result

| | `aws_instance.app` to `aws_instance.db` tcp/5432 |
|---|---|
| Before | `allowed`, deciding rule: `aws_security_group.db` ingress tcp 5432 from `aws_security_group.app` |
| After | `blocked` at the target NACL inbound: `aws_network_acl.db` ingress rule 100 denies tcp 5432 from `10.4.1.0/24` |
| Diff | path **removed** |

## How to verify with Reachability Analyzer

Apply `before/` with a real AMI and create a path from `aws_instance.app` to
`aws_instance.db`, protocol TCP, destination port 5432. Expected: reachable. Apply
`after/` and run it again. Expected: not reachable, explanation at `aws_network_acl.db`.
