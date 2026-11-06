# Oracle: rule-resources

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Which TCP ports on `aws_instance.app` can a client on the internet reach, when rules,
routes, and associations are separate resources?

## Setup

Everything is created by this plan.

- `aws_vpc.main`: `10.2.0.0/16`. `aws_default_security_group.default` removes all rules
  from the default security group.
- `aws_internet_gateway.main`: attached to `aws_vpc.main` by
  `aws_internet_gateway_attachment.main`.
- `aws_subnet.app`: `10.2.1.0/24`, no route table association, no
  `map_public_ip_on_launch`.
- `aws_default_route_table.main`: adopts the VPC's default route table, which is the
  main route table. `aws_route.internet` adds `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_network_acl.app`: no inline rules; associated with the subnet by
  `aws_network_acl_association.app`. `aws_network_acl_rule.in`: ingress 100 allow tcp
  1-65535 from `0.0.0.0/0`. `aws_network_acl_rule.out`: egress 100 allow tcp
  1024-65535 to `0.0.0.0/0`.
- `aws_security_group.app`: no inline rules.
  `aws_vpc_security_group_ingress_rule.https`: tcp/443 from `0.0.0.0/0`.
  `aws_security_group_rule.admin`: tcp/22 from `198.51.100.0/24`.
- `aws_instance.app`: `associate_public_ip_address = false`, group `aws_security_group.app`.
- `aws_eip.app`: `instance = aws_instance.app.id`.

## Proof

For a client at a public address `C`:

1. **Public address.** `associate_public_ip_address = false`, but `aws_eip.app` is
   associated with the instance, so it has a public IPv4 address (the Elastic IP).
   Passes.
2. **Internet gateway.** Attached by `aws_internet_gateway_attachment.main`. Passes.
3. **NACL inbound.** The subnet uses `aws_network_acl.app` (association). Rule 100
   allows tcp 1-65535 from `0.0.0.0/0`, which covers 22 and 443. Passes.
4. **Security group.** The group has no inline rules; the rule resources add:
   - tcp/443 from `0.0.0.0/0`: every public `C`. Passes.
   - tcp/22 from `198.51.100.0/24` only. Passes for `C` in `198.51.100.0/24`.
     (`198.51.100.0/24` is a documentation range; the engine treats it as public, see
     "Internet sources" in [gateways.md](../../docs/semantics/gateways.md).)
5. **NACL outbound.** Rule 100 allows tcp 1024-65535, which is the whole ephemeral range
   the engine checks. Passes.
6. **Route.** The subnet has no association, so it uses the main route table: the
   default route table adopted by `aws_default_route_table.main`. Terraform removes its
   routes on adoption, then `aws_route.internet` adds `0.0.0.0/0` to the internet
   gateway. Longest prefix match for `C` picks that route. Passes.

## Expected result

| Path | Before | After | Change |
|---|---|---|---|
| internet to `aws_instance.app` tcp/22 | `absent` | `allowed` from `198.51.100.0/24` | `added` |
| internet to `aws_instance.app` tcp/443 | `absent` | `allowed` from any public address | `added` |

## How to verify with Reachability Analyzer

This costs money. Check current prices first.

1. In a test account: `terraform apply -var ami=ami-...` in `after/`.
2. Run analyses from the internet gateway to the instance's network interface for TCP 22
   and TCP 443. Expected: both reachable. For TCP 22, also check that the explanation
   names the rule from `aws_security_group_rule.admin`, and, if the analysis lets you set
   a source address, that an address outside `198.51.100.0/24` is not reachable.
3. Run `terraform destroy`.
4. Record the analysis IDs, the date, and both results here, and change the status line.
