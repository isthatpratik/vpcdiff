# Oracle: elb-classic

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 443 on each of two Classic
Load Balancers, `aws_elb.public` and `aws_elb.internal`?

## Setup (the plan creates everything)

- `aws_vpc.main`: `10.5.0.0/16`, created by Terraform. The default NACL is not managed,
  so it allows all traffic ([network-acls.md](../../docs/semantics/network-acls.md) rule 5).
- `aws_subnet.a` (`10.5.1.0/24`) and `aws_subnet.b` (`10.5.2.0/24`) are both associated
  with `aws_route_table.public`, which routes `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_internet_gateway.main` is attached to `aws_vpc.main`.
- Both load balancers use subnets `a` and `b` and `aws_security_group.web`, which allows
  tcp/443 from `0.0.0.0/0`.
- `aws_elb.public` does not set `internal`. `aws_elb.internal` sets `internal = true`.

## Proof

Classic Load Balancer rules ([endpoints.md](../../docs/semantics/endpoints.md), Classic
Load Balancer): "By default, Elastic Load Balancing creates an Internet-facing load
balancer"; `internal = true` gives only private addresses.

**`aws_elb.public`:**

For a client at any public address `C` (outside `10.5.0.0/16`), in both subnets:

1. **Public address.** `internal` is not set, so the load balancer is internet-facing (the AWS default). Passes.
2. **Internet gateway.** Attached to the VPC. Passes.
3. **NACL inbound.** Default NACL, allow all. Passes.
4. **Security group inbound.** `aws_security_group.web` allows tcp/443 from `0.0.0.0/0`, which contains
   `C`. [security-groups.md](../../docs/semantics/security-groups.md) rule 1. Passes.
5. **NACL outbound (response).** Default NACL, allow all ephemeral ports. Passes.
6. **Return route.** `C` is outside the local route, so `0.0.0.0/0` to the internet
   gateway wins ([route-tables.md](../../docs/semantics/route-tables.md) rules 2 and 3).
   Passes.

Both subnets give the same result, so the placement does not matter.

**`aws_elb.internal`:** hop 1 fails: an internal load balancer has no public IPv4
address. **Blocked.**

## Expected result

| | `aws_elb.public` tcp/443 | `aws_elb.internal` tcp/443 |
|---|---|---|
| Before | `absent` | `absent` |
| After | `allowed`, deciding rule: `aws_security_group.web` ingress tcp 443 from 0.0.0.0/0 | `blocked` at the public IP hop |
| Diff | **added** | unchanged (not reachable before or after) |

## How to verify with Reachability Analyzer

Apply `after/` (with real values where the file says so), then create a path from the
internet gateway to the endpoint's network interface, protocol TCP, on the port above.
Expected: the verdicts in the table.
