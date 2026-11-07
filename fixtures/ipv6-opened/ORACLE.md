# Oracle: ipv6-opened

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 443 on `aws_instance.web`,
over IPv4 and over IPv6?

## Setup

- `aws_vpc.main`: `10.9.0.0/16` and an Amazon-provided IPv6 block
  (`assign_generated_ipv6_cidr_block = true`). Its default NACL is not managed, so with
  an IPv6 block it allows all IPv4 traffic (rule 100) and all IPv6 traffic (rule 101).
- `aws_subnet.public` (`10.9.1.0/24` and a `/64` of the VPC's IPv6 block) uses
  `aws_route_table.public`: `0.0.0.0/0` and `::/0` to `aws_internet_gateway.main`.
- `aws_instance.web`: a public IPv4 address and one IPv6 address
  (`ipv6_address_count = 1`), group `aws_security_group.web`.
- The change: `aws_security_group.web` allows tcp/443 from `0.0.0.0/0` before; after, it
  also allows tcp/443 from `::/0`.

## Proof

**IPv4** (as in `sg-5432-opened`): every hop passes in both. **Unchanged.**

**IPv6** ([ipv6.md](../../docs/semantics/ipv6.md)), for a client at a global unicast
address `C` outside the VPC's block:

1. **IPv6 address.** `ipv6_address_count = 1`; AWS IPv6 addresses are global. Passes.
2. **Internet gateway.** Attached to the VPC; it carries IPv6 both ways. Passes.
3. **NACL inbound.** Default NACL rule 101 allows all IPv6. Passes.
4. **Security group inbound.**
   - Before: the only rule allows `0.0.0.0/0`, an IPv4 range; nothing matches `C`. **Blocked.**
   - After: `::/0` contains `C`. **Passes.**
5. **NACL outbound.** Rule 101 allows all IPv6. Passes.
6. **Return route.** `::/0` to the internet gateway is the only IPv6 route besides the
   VPC's local route, which does not contain `C`. Passes.

## Expected result

| | Internet to `aws_instance.web` tcp/443, IPv4 | IPv6 |
|---|---|---|
| Before | `allowed` | `blocked` at the security group |
| After | `allowed` | `allowed` from every global IPv6 address |
| Diff | unchanged | **added** |
