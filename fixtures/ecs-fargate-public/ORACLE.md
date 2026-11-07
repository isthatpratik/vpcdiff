# Oracle: ecs-fargate-public

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 8080 on a task of
`aws_ecs_service.api`?

## Setup (the plan creates everything)

- `aws_vpc.main`: `10.5.0.0/16`, created by Terraform. The default NACL is not managed,
  so it allows all traffic ([network-acls.md](../../docs/semantics/network-acls.md) rule 5).
- `aws_subnet.a` (`10.5.1.0/24`) and `aws_subnet.b` (`10.5.2.0/24`) are both associated
  with `aws_route_table.public`, which routes `0.0.0.0/0` to `aws_internet_gateway.main`.
- `aws_internet_gateway.main` is attached to `aws_vpc.main`.
- `aws_ecs_service.api`: `launch_type = "FARGATE"`, `network_configuration` with subnets
  `a` and `b`, security group `aws_security_group.api`, and `assign_public_ip = true`.

## Proof

ECS rules ([endpoints.md](../../docs/semantics/endpoints.md), ECS): each task has its own
interface in one of the subnets; on Fargate, `assign_public_ip = true` gives it a public
IPv4 address.

For a client at any public address `C` (outside `10.5.0.0/16`), in both subnets:

1. **Public address.** Fargate with `assign_public_ip = true`. Passes.
2. **Internet gateway.** Attached to the VPC. Passes.
3. **NACL inbound.** Default NACL, allow all. Passes.
4. **Security group inbound.** `aws_security_group.api` allows tcp/8080 from `0.0.0.0/0`, which contains
   `C`. [security-groups.md](../../docs/semantics/security-groups.md) rule 1. Passes.
5. **NACL outbound (response).** Default NACL, allow all ephemeral ports. Passes.
6. **Return route.** `C` is outside the local route, so `0.0.0.0/0` to the internet
   gateway wins ([route-tables.md](../../docs/semantics/route-tables.md) rules 2 and 3).
   Passes.

Both subnets give the same result, so the placement does not matter.

## Expected result

| | Internet to `aws_ecs_service.api` tcp/8080 |
|---|---|
| Before | `absent`: the plan creates the service |
| After | `allowed` from every public address, deciding rule: `aws_security_group.api` ingress tcp 8080 from 0.0.0.0/0 |
| Diff | path **added** |

## How to verify with Reachability Analyzer

Apply `after/` (with real values where the file says so), then create a path from the
internet gateway to the endpoint's network interface, protocol TCP, on the port above.
Expected: the verdicts in the table.
