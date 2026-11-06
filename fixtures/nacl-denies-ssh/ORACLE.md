# Oracle: nacl-denies-ssh

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Which TCP ports on `aws_instance.web` can a client on the internet reach?

## Setup

Everything is created by this plan, so every path is new.

- `aws_vpc.main`: `10.1.0.0/16`.
- `aws_subnet.web`: `10.1.1.0/24`, `map_public_ip_on_launch = true`, associated with
  `aws_route_table.web` and listed in `aws_network_acl.web`.
- `aws_route_table.web`: route `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_network_acl.web`: ingress rule 100 denies tcp/22 from `0.0.0.0/0`; ingress rule
  200 allows all traffic from `0.0.0.0/0`; egress rule 100 allows all traffic.
- `aws_security_group.web`: ingress tcp/22 and tcp/443 from `0.0.0.0/0`.
- `aws_instance.web`: does not set `associate_public_ip_address`.

The plan does not know the IDs (`vpc_id`, `subnet_id`, security group IDs) until
apply, so the engine must link resources through the configuration references
([terraform-plan-json.md](../../docs/semantics/terraform-plan-json.md)).

## Proof

For a client at any public address `C` (outside `10.1.0.0/16`):

1. **Public address.** The instance does not set `associate_public_ip_address`, so the
   subnet's `map_public_ip_on_launch = true` gives it a public IPv4 address.
   [gateways.md](../../docs/semantics/gateways.md). Passes.
2. **Internet gateway.** Attached to `aws_vpc.main`. Passes.
3. **NACL inbound.** Rules are evaluated from the lowest number, first match wins
   ([network-acls.md](../../docs/semantics/network-acls.md) rule 3).
   - tcp/22: rule 100 (deny tcp 22 from `0.0.0.0/0`) matches first. **Blocked.**
   - tcp/443: rule 100 does not match port 443; rule 200 allows. Passes.
4. **Security group (443).** Ingress tcp/443 from `0.0.0.0/0`. Passes.
5. **NACL outbound (443 response).** Egress rule 100 allows all traffic, so all
   ephemeral ports 1024-65535 are allowed. Passes.
6. **Route (443 response).** Longest prefix match for `C`: `0.0.0.0/0` to
   `aws_internet_gateway.main` (the local route `10.1.0.0/16` does not contain `C`).
   Passes.

## Expected result

| Path | Before | After | Change |
|---|---|---|---|
| internet to `aws_instance.web` tcp/22 | `absent` | `blocked` at NACL inbound, rule 100 | `unchanged` (no exposure either way) |
| internet to `aws_instance.web` tcp/443 | `absent` | `allowed` from any public address | `added` |

## How to verify with Reachability Analyzer

This costs money. Check current prices first.

1. In a test account: `terraform apply -var ami=ami-...` in `after/`.
2. Run two analyses from the internet gateway to the instance's network interface:
   TCP 22 (expected: not reachable, explanation names the network ACL) and TCP 443
   (expected: reachable).
3. Run `terraform destroy`.
4. Record the analysis IDs, the date, and both results here, and change the status line.
