# Oracle: aurora-public

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 5432 on the Aurora instance
`aws_rds_cluster_instance.a`?

## Setup (the plan creates everything)

- `aws_vpc.main`: `10.5.0.0/16`, created by Terraform. The default NACL is not managed,
  so it allows all traffic ([network-acls.md](../../docs/semantics/network-acls.md) rule 5).
- `aws_subnet.a` (`10.5.1.0/24`) and `aws_subnet.b` (`10.5.2.0/24`) are both associated
  with `aws_route_table.public`, which routes `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_internet_gateway.main` is attached to `aws_vpc.main`.
- `aws_rds_cluster.main` uses `aws_db_subnet_group.db` (subnets `a` and `b`) and
  `aws_security_group.db`. `aws_rds_cluster_instance.a` belongs to it and sets
  `publicly_accessible = true`; it sets no subnet group of its own.

## Proof

Aurora rules ([endpoints.md](../../docs/semantics/endpoints.md), Aurora): the cluster's
security groups apply to every instance, the instance's subnet group is the cluster's,
and `publicly_accessible` is set per instance.

For a client at any public address `C` (outside `10.5.0.0/16`), in both subnets:

1. **Public address.** `publicly_accessible = true`. Passes.
2. **Internet gateway.** Attached to the VPC. Passes.
3. **NACL inbound.** Default NACL, allow all. Passes.
4. **Security group inbound.** `aws_security_group.db` allows tcp/5432 from `0.0.0.0/0`, which contains
   `C`. [security-groups.md](../../docs/semantics/security-groups.md) rule 1. Passes.
5. **NACL outbound (response).** Default NACL, allow all ephemeral ports. Passes.
6. **Return route.** `C` is outside the local route, so `0.0.0.0/0` to the internet
   gateway wins ([route-tables.md](../../docs/semantics/route-tables.md) rules 2 and 3).
   Passes.

Both subnets give the same result, so the placement does not matter.

## Expected result

| | Internet to `aws_rds_cluster_instance.a` tcp/5432 |
|---|---|
| Before | `absent`: the plan creates the instance |
| After | `allowed` from every public address, deciding rule: `aws_security_group.db` ingress tcp 5432 from 0.0.0.0/0 |
| Diff | path **added** |

## How to verify with Reachability Analyzer

Apply `after/` (with real values where the file says so), then create a path from the
internet gateway to the endpoint's network interface, protocol TCP, on the port above.
Expected: the verdicts in the table.
