# Oracle: sg-ref-opened

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can `aws_instance.web` open a TCP connection to port 8080 on `aws_instance.app`?

## Setup

- `aws_vpc.main`: `10.4.0.0/16`, created by Terraform. No internet gateway.
- No route table is managed, so both subnets use the VPC's main route table, which has
  only the local route `10.4.0.0/16`.
- Both instances are private: no `associate_public_ip_address`, and the subnets do not
  set `map_public_ip_on_launch`. So there is no path from the internet.
- Each instance has one security group, created by Terraform, with one egress rule:
  all traffic to `0.0.0.0/0`.
- `aws_instance.web` in `aws_subnet.web` (`10.4.1.0/24`) with `aws_security_group.web`,
  which has no ingress rule.
- `aws_instance.app` in `aws_subnet.app` (`10.4.2.0/24`) with `aws_security_group.app`.
- The only change: `aws_security_group.app` gets an ingress rule tcp/8080 from the
  group `aws_security_group.web` (before: no ingress rule).

## Proof

Hops in path order ([internal-paths.md](../../docs/semantics/internal-paths.md),
"Hops"). The source address is some address in `10.4.1.0/24`.

1. **Source security group, outbound.** The `web` group's egress rule allows all
   traffic to `0.0.0.0/0`, which contains all of `10.4.2.0/24`.
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 2. Passes in both.
2. **Source route.** Longest prefix match for `10.4.2.0/24` in the main route table: only
   the local route `10.4.0.0/16` contains it.
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 4. Passes in both.
3. **Source NACL, outbound.** `aws_subnet.web` uses the VPC's default NACL, which allows all
   traffic. [network-acls.md](../../docs/semantics/network-acls.md) rule 5. Passes in both.
4. **Target NACL, inbound.** `aws_subnet.app` uses the default NACL too. Passes in both.
5. **Target security group, inbound.**
   [internal-paths.md](../../docs/semantics/internal-paths.md) rule 1.
   - Before: `aws_security_group.app` has no ingress rule. **Blocked.**
   - After: the rule allows tcp/8080 from instances associated with
     `aws_security_group.web`, and `aws_instance.web` is one. **Passes.**
6. **Target NACL, outbound (response).** Default NACL: all ephemeral ports allowed.
7. **Source NACL, inbound (response).** Default NACL: allowed.
8. **Target route.** The local route contains `10.4.1.0/24`. Passes.

## Expected result

| | `aws_instance.web` to `aws_instance.app` tcp/8080 |
|---|---|
| Before | `blocked` at the target security group: no ingress rule of `aws_security_group.app` |
| After | `allowed`, deciding rule: `aws_security_group.app` ingress tcp 8080 from `aws_security_group.web` |
| Diff | path **added** |

No other path: `aws_security_group.web` has no ingress rule, so nothing references a
group of `aws_instance.app` in the other direction.

## How to verify with Reachability Analyzer

Apply `after/` with a real AMI, then create a path from `aws_instance.web` to
`aws_instance.app`, protocol TCP, destination port 8080. Expected: reachable. Then
apply `before/` and run it again. Expected: not reachable, explanation at the security
group of `aws_instance.app`.
