# Oracle: modules-local

**Status:** written proof. Not verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP connection to port 443 on
`module.web.aws_instance.web`?

## Setup

All resources are created by the plan (no `before`).

- Root: `aws_vpc.main` (`10.0.0.0/16`), `aws_internet_gateway.main`, `aws_subnet.public`
  (`10.0.1.0/24`), `aws_route_table.public` (route `0.0.0.0/0` to the internet gateway),
  and `aws_route_table_association.public`.
- Local module `web` (`./modules/web`) gets `vpc_id` and `subnet_id` as inputs. It creates
  `aws_security_group.web` (ingress tcp/443 from `0.0.0.0/0`, `vpc_id = var.vpc_id`) and
  `aws_instance.web` (`subnet_id = var.subnet_id`, public IP, group `aws_security_group.web`).
- In a create-only plan every ID is unknown. The link from the instance to the subnet is
  `var.subnet_id` in the module and `subnet_id = aws_subnet.public.id` in the module call
  (`configuration.root_module.module_calls.web.expressions`).

## Proof

The hops are the same as in [sg-5432-opened](../sg-5432-opened/ORACLE.md), with these two
links followed through the module (see "Module outputs and inputs" in
[terraform-plan-json.md](../../docs/semantics/terraform-plan-json.md)):

- `aws_instance.web.subnet_id = var.subnet_id` and the call sets `subnet_id` to
  `aws_subnet.public.id`, so the instance is in `aws_subnet.public`. The reference names
  exactly one resource, and that resource has one instance.
- `aws_security_group.web.vpc_id = var.vpc_id` and the call sets `vpc_id` to
  `aws_vpc.main.id`, so the group is in `aws_vpc.main`.

Then, for a client at any public address `C`:

1. Public address: `associate_public_ip_address = true`. Passes.
2. Internet gateway: `aws_internet_gateway.main` is attached to `aws_vpc.main`. Passes.
3. NACL inbound: the VPC's default NACL is not managed, so it allows all. Passes.
4. Security group: `aws_security_group.web` allows tcp/443 from `0.0.0.0/0`. Passes on 443.
   No rule allows any other port, so every other port is not a path.
5. NACL outbound (response): default NACL allows all. Passes.
6. Route for the response: `0.0.0.0/0` to the internet gateway in `aws_route_table.public`,
   associated with the subnet. Passes.

## Expected result

| | Internet to `module.web.aws_instance.web` tcp/443 |
|---|---|
| Before | the resource does not exist |
| After | `allowed`, deciding rule: `module.web.aws_security_group.web` ingress tcp/443 from `0.0.0.0/0` |
| Diff | path **added** |

## How to verify with Reachability Analyzer

Same steps as [sg-5432-opened](../sg-5432-opened/ORACLE.md), with a real AMI
(`terraform apply` costs money; check current prices first). Record the analysis IDs and
change the status line when done.
