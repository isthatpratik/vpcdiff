# Oracle: sg-replaced

**Status:** written proof. Not yet verified by AWS Reachability Analyzer (which checks
one moment in time; the outage risk is about the apply itself).

## Question

Does renaming the security group change who can reach `aws_instance.web` on tcp/443,
and can the apply interrupt that path?

## Setup

- A public instance (`associate_public_ip_address = true`) in `aws_subnet.web`, which
  routes `0.0.0.0/0` to `aws_internet_gateway.main`; default NACL.
- `aws_security_group.web` allows tcp/443 from `0.0.0.0/0`, before and after.
- The only change: the group's `name` goes from `web` to `web-v2`. The name cannot be
  changed in place, so the plan replaces the group (`replace_paths: [["name"]]`) with
  `["delete", "create"]`, and updates the instance to use the new group.

## Proof

1. Before and after, every hop is the same as in `sg-5432-opened` (after), with port 443:
   public address, attached internet gateway, default NACL in both directions, the
   group's tcp/443 rule from `0.0.0.0/0`, and the `0.0.0.0/0` route to the internet
   gateway. So the path is `allowed` from any public address on both sides: `unchanged`.
2. `["delete", "create"]` means Terraform deletes the old group before it creates the
   new one (`create_before_destroy` would give `["create", "delete"]`). The group is on
   this path, so while the old group is gone, nothing allows tcp/443 to the instance, or
   the delete fails because the group is still attached. Either way the apply can
   interrupt the path: `outageRisk: ["aws_security_group.web"]`.

## Expected result

| Path | Before | After | Change | Outage risk |
|---|---|---|---|---|
| internet to `aws_instance.web` tcp/443 | `allowed` | `allowed` | `unchanged` | `aws_security_group.web` |

## How to verify

Reachability Analyzer shows the path as reachable before and after the apply. To see the
risk, apply `before/`, then apply `after/` while probing tcp/443, and watch for failed
connections or a `DependencyViolation` error on the group delete. This costs money;
check current prices first.
