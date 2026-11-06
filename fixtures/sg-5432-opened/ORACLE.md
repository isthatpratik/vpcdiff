# Oracle: sg-5432-opened

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 5432 on `aws_instance.db`?

## Setup (same in before and after)

- `aws_vpc.main`: `10.0.0.0/16`, created by Terraform. Its default NACL is not managed.
- `aws_subnet.public`: `10.0.1.0/24`, associated with `aws_route_table.public`.
- `aws_route_table.public`: route `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_internet_gateway.main`: attached to `aws_vpc.main`.
- `aws_instance.db`: in `aws_subnet.public`, `associate_public_ip_address = true`,
  only security group `aws_security_group.db`.
- The only change: `aws_security_group.db` ingress tcp/5432 source
  `10.0.0.0/16` (before) becomes `0.0.0.0/0` (after).

## Proof

Hops, in path order, for a client at a public address `C`
(any address outside `10.0.0.0/16`):

1. **Public address.** The instance has a public IPv4 address
   (`associate_public_ip_address = true`).
   [gateways.md](../../docs/semantics/gateways.md) rule 1. Passes in both.
2. **Internet gateway.** `aws_internet_gateway.main` is attached to the instance's VPC.
   [gateways.md](../../docs/semantics/gateways.md) rule 2. Passes in both.
3. **NACL inbound.** The subnet has no explicit NACL association, so it uses the VPC's
   default NACL. The VPC is created by Terraform and `aws_default_network_acl` is not
   used, so the default NACL allows all traffic.
   [network-acls.md](../../docs/semantics/network-acls.md) rule 5. Passes in both.
4. **Security group inbound.** The instance has one group, `aws_security_group.db`.
   [security-groups.md](../../docs/semantics/security-groups.md) rule 1.
   - Before: the only ingress rule allows tcp/5432 from `10.0.0.0/16`. `C` is not in
     `10.0.0.0/16`, and there is no other rule. **Blocked.**
   - After: the rule allows tcp/5432 from `0.0.0.0/0`, which contains `C`. **Passes.**
5. **NACL outbound (response).** Default NACL allows all, so every ephemeral port in
   1024-65535 is allowed. [network-acls.md](../../docs/semantics/network-acls.md)
   rules 5 and 6. Passes in both.
6. **Route for the response.** Longest prefix match for `C` in
   `aws_route_table.public`: the local route `10.0.0.0/16` does not contain `C`, so
   `0.0.0.0/0` to `aws_internet_gateway.main` wins.
   [route-tables.md](../../docs/semantics/route-tables.md) rules 2 and 3. Passes in both.

The security group does not need an egress rule for the response, because security
groups are stateful ([security-groups.md](../../docs/semantics/security-groups.md)
rule 2).

## Expected result

| | Internet to `aws_instance.db` tcp/5432 |
|---|---|
| Before | `blocked` at the security group hop: no rule of `aws_security_group.db` matches the source |
| After | `allowed`, deciding rule: `aws_security_group.db` ingress tcp/5432 from `0.0.0.0/0` |
| Diff | path **added** |

## How to verify with Reachability Analyzer

This costs money: Reachability Analyzer charges per analysis, and the instance runs
while it exists. Check current prices first.

1. In a test account, apply `before/` with a real AMI: `terraform apply -var ami=ami-...`.
2. Create a Network Insights Path from the internet gateway to the instance's network
   interface, protocol TCP, destination port 5432. Run the analysis.
   Expected: not reachable, explanation names the security group.
3. Apply `after/` (same AMI). Run the analysis again. Expected: reachable.
4. Run `terraform destroy`.
5. Record the analysis IDs, the date, and both results here, and change the status line.
