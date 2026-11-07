# Oracle: public-db-and-alb

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet reach `aws_db_instance.main` on tcp/5432 and `aws_lb.web`
on tcp/443?

## Setup

Everything is created by this plan.

- `aws_vpc.main`: `10.3.0.0/16`, default NACL not managed.
- `aws_subnet.a` (`10.3.1.0/24`) and `aws_subnet.b` (`10.3.2.0/24`), both associated with
  `aws_route_table.public`, which routes `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_db_subnet_group.db`: subnets `a` and `b`.
- `aws_db_instance.main`: `publicly_accessible = true`, group `aws_security_group.db`
  (tcp/5432 from `0.0.0.0/0`).
- `aws_lb.web`: `internal = false`, Application Load Balancer, subnets `a` and `b`, group
  `aws_security_group.web` (tcp/443 from `0.0.0.0/0`).

## Proof

Both endpoints can be placed in either subnet (RDS chooses one subnet of the DB subnet
group; the load balancer has a node in each). Subnets `a` and `b` have the same route
table and the same default NACL, so every hop below is the same for both placements.

For a client at any public address `C`:

1. **Public address.** `publicly_accessible = true` gives the DB instance a public
   address; `internal = false` makes the load balancer internet-facing. Passes.
2. **Internet gateway.** Attached to `aws_vpc.main`. Passes.
3. **NACL inbound.** Default NACL, allows all. Passes.
4. **Security group.** tcp/5432 (DB) and tcp/443 (load balancer) from `0.0.0.0/0`. Passes.
5. **NACL outbound.** Default NACL, allows all ephemeral ports. Passes.
6. **Route.** `0.0.0.0/0` to `aws_internet_gateway.main`. Passes.

The load balancer's listeners are not part of this check: for an Application Load
Balancer the security group decides which ports the internet can reach.

## Expected result

| Path | Before | After | Change |
|---|---|---|---|
| internet to `aws_db_instance.main` tcp/5432 | `absent` | `allowed` from any public address | `added` |
| internet to `aws_lb.web` tcp/443 | `absent` | `allowed` from any public address | `added` |

## How to verify with Reachability Analyzer

This costs money (an RDS instance and a load balancer run while the test lasts). Check
current prices first. Set a real password through a variable before applying.

1. Apply `after/` in a test account.
2. Run analyses from the internet gateway to the DB instance's network interface (TCP
   5432) and to one of the load balancer's network interfaces (TCP 443). Expected: both
   reachable.
3. Run `terraform destroy`.
4. Record the analysis IDs, the date, and both results here, and change the status line.

## Result format 0.2 (2026-11-07)

The result format changed from `0.1` to `0.2` for paths inside the VPC (#32). In
`expected.json` only the `format` field changed. The paths and notes are byte for byte
the same as before: this plan has no security group rule that references a group of
another endpoint, so it has no path inside the VPC.
