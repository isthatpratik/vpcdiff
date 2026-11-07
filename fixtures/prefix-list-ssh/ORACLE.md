# Oracle: prefix-list-ssh

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Which internet addresses can open a TCP connection to port 22 on `aws_instance.bastion`?

## Setup

- `aws_vpc.main`: `10.7.0.0/16`, default NACL (allows all), `aws_internet_gateway.main`
  attached. `aws_subnet.public` (`10.7.1.0/24`) routes `0.0.0.0/0` to the gateway.
- `aws_instance.bastion` has a public IPv4 address and one group,
  `aws_security_group.bastion`, with one rule: tcp/22 from the prefix list
  `aws_ec2_managed_prefix_list.office`.
- The change: the list has entry `203.0.113.0/24` before, and `203.0.113.0/24` and
  `198.51.100.0/24` after.

## Proof

A rule with a prefix list as its source allows the list's entries
([security-groups.md](../../docs/semantics/security-groups.md), prefix lists). The list is
customer-managed and in the plan, so its entries are known.

For a client at a public address `C`: public address, internet gateway, NACL inbound,
NACL outbound, and the return route (`0.0.0.0/0` to the internet gateway) all pass, as
in `sg-5432-opened`. The security group hop decides:

- Before: `C` passes only if it is in `203.0.113.0/24`.
- After: `C` passes if it is in `203.0.113.0/24` or `198.51.100.0/24`.

## Expected result

| | Internet to `aws_instance.bastion` tcp/22 |
|---|---|
| Before | `allowed` from `203.0.113.0/24` |
| After | `allowed` from `198.51.100.0/24`, `203.0.113.0/24` |
| Diff | path **changed** (sources) |

## How to verify with Reachability Analyzer

Apply each side with a real AMI and analyze a path from the internet gateway to the
instance on TCP 22 with a source in each range (for example `198.51.100.10`). Expected:
not reachable before, reachable after; `203.0.113.10` is reachable in both.
