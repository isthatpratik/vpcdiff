# Security groups

## AWS rules

1. **Allow only.** "You can specify allow rules, but not deny rules."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html>
2. **Stateful.** "If you send a request from an instance, the response traffic for
   that request is allowed to reach the instance regardless of the inbound security
   group rules." The same holds for responses to allowed inbound traffic.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
3. **New group defaults.** A new group has no inbound rules, so no inbound traffic
   is allowed. It has one outbound rule that allows all outbound traffic.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html>
4. **Several groups on one interface.** "You can also assign multiple security groups
   to a single resource."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html>
   The engine treats traffic as allowed if any rule of any group allows it. AWS does not
   state this in one sentence on these pages. It follows from rule 1: with no deny
   rules, the union is the only possible combination. A Reachability Analyzer fixture
   with two groups must confirm it.

## Terraform differences

- **Terraform removes the default egress rule.** "When creating a new Security Group
  inside a VPC, Terraform will remove this default rule." A group created by
  Terraform with no `egress` block has no outbound rules.
  Source: <https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group>
- Rules can be written in four ways: inline `ingress`/`egress` blocks on
  `aws_security_group`, `aws_security_group_rule`, `aws_vpc_security_group_ingress_rule`,
  and `aws_vpc_security_group_egress_rule`.
- `protocol = "-1"` means all protocols and all ports. The ports are then `0`.

## Engine behavior

- Inbound traffic to an interface is allowed when a rule of one of its groups matches
  the protocol, the destination port, and the source address.
- For a connection that starts outside the instance, outbound rules are not checked
  for the response (rule 2).
- The result names the deciding rule: the group, the rule, and its CIDR and ports.
  When no rule matches, the result is `blocked` at the SG hop.

## Slice 1 scope

Handled:

- Inline `ingress` blocks with `cidr_blocks`.
- `aws_security_group_rule` (`type = "ingress"`) and `aws_vpc_security_group_ingress_rule`,
  merged into the group they target. Egress rules do not affect inbound paths.
- `aws_default_security_group`, and the unmanaged default security group of a VPC
  managed in the plan. AWS's default group allows inbound traffic only from itself, so it
  has no internet source.
  Source: <https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html>
- `protocol` values `tcp`, `6`, `udp`, `17`, and `-1`.
- `vpc_security_group_ids` on `aws_instance`; an empty list means the VPC's default group.

Skipped for internet paths, because they cannot match an internet address: a source
that is another security group (`security_groups`, `self`), and IPv6 sources (IPv6 is
not modeled yet).

Returns `unknown` with a reason:

- A rule resource whose target group cannot be resolved. Then every group is unknown,
  because the rule could belong to any of them.
- A source that is a prefix list. It can contain public ranges that the engine cannot
  expand offline.
- Any rule value that is unknown in the plan (`after_unknown`).
