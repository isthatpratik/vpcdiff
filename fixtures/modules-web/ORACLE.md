# Oracle: modules-web

**Status:** written proof. Not verified by AWS Reachability Analyzer.

## Question

Can a client on the internet open a TCP or UDP connection to `aws_instance.web`?

## Setup

All resources are created by the plan. The network and the group come from public
modules: `terraform-aws-modules/vpc/aws` 6.7.3 and `terraform-aws-modules/security-group/aws`
6.0.0. The instance is a plain `aws_instance` with `subnet_id = module.vpc.public_subnets[0]`
and `vpc_security_group_ids = [module.web_sg.id]` (the `ec2-instance` module reads an SSM
parameter, so it cannot be planned without AWS access).

## Proof

The engine follows both module outputs
(see [terraform-plan-json.md](../../docs/semantics/terraform-plan-json.md)):

- `module.vpc.public_subnets` is `aws_subnet.public[*].id` in the module, and there is one
  public subnet, so `aws_instance.web` is in `module.vpc.aws_subnet.public[0]`.
- `module.web_sg.id` is `aws_security_group.this[0].id`.

The next link cannot be followed. In the module, `aws_subnet.public[0].vpc_id` is
`local.vpc_id`. A `terraform show -json` plan lists `local.vpc_id` as a reference and
holds no expression for it (locals are not in the plan). In a create-only plan the
subnet's `vpc_id` is also unknown. Nothing in the plan says which VPC the subnet is in,
so the engine cannot find the internet gateway or the route table. A different module
version or a different `local` could place the subnet in another VPC.

An honest answer is `unknown`, with the reason (ADR 0003).

## Expected result

| | Internet to `aws_instance.web`, tcp and udp |
|---|---|
| Before | the resource does not exist |
| After | `unknown` at the public IP hop: `module.vpc.aws_subnet.public[0]: vpc_id uses values that are unknown until apply` |
| Diff | `unknown` |

This fixture records a limit. When the VPC already exists, its ID is known in the plan
and the same module gives a decided result. If a later change makes this plan decidable,
the expected result must change in the same pull request, with a new proof.
