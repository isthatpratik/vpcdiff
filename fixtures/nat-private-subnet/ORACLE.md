# Oracle: nat-private-subnet

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 443 on `aws_instance.app`?

## Setup

- `aws_vpc.main`: `10.6.0.0/16`, created by Terraform; default NACL, not managed (allows
  all). `aws_internet_gateway.main` is attached to it.
- `aws_instance.app` in `aws_subnet.app` (`10.6.1.0/24`) with
  `associate_public_ip_address = true` and `aws_security_group.app`, which allows
  tcp/443 from `0.0.0.0/0`.
- `aws_subnet.app` is associated with `aws_route_table.app`.
- The change: the route `0.0.0.0/0` in `aws_route_table.app` goes to
  `aws_internet_gateway.main` before, and to a new `aws_nat_gateway.main` (in its own
  subnet `10.6.0.0/24`) after.

## Proof

For a client at any public address `C` (outside `10.6.0.0/16`):

1. **Public address.** `associate_public_ip_address = true`. Passes in both.
2. **Internet gateway.** Attached to the VPC. Passes in both.
3. **NACL inbound.** Default NACL, allow all. Passes in both.
4. **Security group inbound.** tcp/443 from `0.0.0.0/0` contains `C`. Passes in both.
5. **NACL outbound (response).** Default NACL, allow all. Passes in both.
6. **Route for the response.** Longest prefix match for `C` in `aws_route_table.app`:
   the local route does not contain `C`, so `0.0.0.0/0` wins
   ([route-tables.md](../../docs/semantics/route-tables.md) rule 3).
   - Before: the target is the internet gateway. **Passes.**
   - After: the target is a NAT gateway. "Connections must always be initiated from
     within the VPC containing the NAT gateway"
     ([route-tables.md](../../docs/semantics/route-tables.md), response routes that
     block). **Blocked.**

## Expected result

| | Internet to `aws_instance.app` tcp/443 |
|---|---|
| Before | `allowed` from every public address |
| After | `blocked` at the route hop: `aws_route_table.app` route 0.0.0.0/0 to a NAT gateway |
| Diff | path **removed** |

No note: `aws_nat_gateway` is modeled as a route target.

## How to verify with Reachability Analyzer

Apply `before/` with a real AMI and analyze a path from the internet gateway to the
instance on TCP 443: reachable. Apply `after/` and analyze again: not reachable, with
the explanation at the route table.
