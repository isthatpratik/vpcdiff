# Oracle: vpc-endpoints

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Questions

1. Can a client on the internet open a TCP connection to port 443 on `aws_instance.app`?
2. Can `aws_instance.app` open a TCP connection to port 443 on the interface endpoint
   `aws_vpc_endpoint.ssm`?

## Setup (the plan creates everything)

- `aws_vpc.main`: `10.8.0.0/16`, default NACL (allows all), `aws_internet_gateway.main`
  attached.
- `aws_subnet.app` (`10.8.1.0/24`) uses `aws_route_table.app`: `0.0.0.0/0` to the
  internet gateway. The S3 gateway endpoint `aws_vpc_endpoint.s3` is associated with
  this table, so AWS adds a route to the S3 prefix list (AWS-managed).
- `aws_subnet.endpoints` (`10.8.2.0/24`) uses the main route table (local route only).
- `aws_instance.app` in `aws_subnet.app`: public IPv4 address, `aws_security_group.app`
  (in: tcp/443 from `0.0.0.0/0`; out: all to `0.0.0.0/0`).
- `aws_vpc_endpoint.ssm`, an interface endpoint in `aws_subnet.endpoints` with
  `aws_security_group.endpoints` (in: tcp/443 from `aws_security_group.app`).

## Proof

**1. Internet to `aws_instance.app` tcp/443.** Public address, internet gateway, NACL in,
security group (443 from `0.0.0.0/0`), NACL out: all pass. Return route: for a client
`C`, the S3 prefix list route may match first if `C` is an S3 address; the list is
AWS-managed and cannot be expanded offline
([route-tables.md](../../docs/semantics/route-tables.md), prefix list destinations).
Every other `C` uses `0.0.0.0/0` to the internet gateway. Result: **allowed**, with the
S3 list's addresses reported as undecided.

**2. `aws_instance.app` to `aws_vpc_endpoint.ssm` tcp/443**
([internal-paths.md](../../docs/semantics/internal-paths.md)):

1. Source SG out: all traffic to `0.0.0.0/0` contains `10.8.2.0/24`. Passes.
2. Source route: in `aws_route_table.app`, `10.8.2.0/24` uses the local route. The S3
   prefix list holds the public ranges of Amazon S3, so it cannot contain this private
   subnet. Passes.
3. to 7. Default NACL both ways; target SG allows tcp/443 from `aws_security_group.app`,
   which `aws_instance.app` has. Pass.
8. Target route: the main route table has the local route for `10.8.1.0/24`. Passes.

The endpoint's address is private, so there is no path from the internet to it, and its
group allows no CIDR source, so none is listed.

## Expected result

| | Internet to `aws_instance.app` tcp/443 | `aws_instance.app` to `aws_vpc_endpoint.ssm` tcp/443 |
|---|---|---|
| Before | `absent` | `absent` |
| After | `allowed`; S3 prefix list addresses undecided | `allowed` |
| Diff | **added** | **added** |
