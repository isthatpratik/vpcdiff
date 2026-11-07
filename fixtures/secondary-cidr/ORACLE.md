# Oracle: secondary-cidr

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can `aws_instance.app` open a TCP connection to port 5432 on `aws_instance.db`, when both
are in subnets of a secondary CIDR block of the VPC?

## Setup (the plan creates everything)

- `aws_vpc.main`: primary block `10.20.0.0/16`. `aws_vpc_ipv4_cidr_block_association.extra`
  adds `10.21.0.0/16`. The default NACL is not managed (allows all) and the main route
  table is not managed.
- `aws_subnet.app` (`10.21.1.0/24`) and `aws_subnet.db` (`10.21.2.0/24`) are in the
  secondary block. Both use the main route table.
- `aws_instance.app` with `aws_security_group.app` (out: all to `0.0.0.0/0`).
  `aws_instance.db` with `aws_security_group.db` (in: tcp/5432 from `aws_security_group.app`).
  Neither has a public address.

## Proof

Every route table has a local route for each block of the VPC
([route-tables.md](../../docs/semantics/route-tables.md), "Secondary CIDR blocks"), so the
main route table has local routes for `10.20.0.0/16` and `10.21.0.0/16`.

1. **Source security group, outbound.** All traffic to `0.0.0.0/0` contains `10.21.2.0/24`. Passes.
2. **Source route.** `10.21.2.0/24` is inside the local route `10.21.0.0/16`. Passes.
3. and 4. **NACLs.** The default NACL allows all. Pass.
5. **Target security group, inbound.** tcp/5432 from the group of `aws_instance.app`, which
   `aws_instance.app` has. Passes.
6. and 7. **NACLs for the response.** Pass.
8. **Target route.** `10.21.1.0/24` is inside the local route `10.21.0.0/16`. Passes.

## Expected result

| | `aws_instance.app` to `aws_instance.db` tcp/5432 |
|---|---|
| Before | `absent` |
| After | `allowed`; the route hops name the local route of `10.21.0.0/16` |
| Diff | path **added** |

There is no path from the internet: neither instance has a public address.

## How to verify with Reachability Analyzer

Use a throwaway account that the maintainer names for the run. Apply `after/` with a real
AMI and analyze a path from `aws_instance.app` to `aws_instance.db` on TCP 5432: reachable.
