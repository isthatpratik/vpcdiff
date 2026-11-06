# Network ACLs

## AWS rules

1. **Stateless.** "If you create a NACL rule to allow specific inbound traffic to a
   subnet, responses to that traffic are not automatically allowed."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html>
2. **Checked at the subnet edge.** Rules are evaluated "when traffic enters and leaves
   the subnet, not as it is routed within a subnet."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html>
3. **Ordered, first match wins.** "Rules are evaluated starting with the lowest
   numbered rule. As soon as a rule matches traffic, it's applied regardless of any
   higher-numbered rule that might contradict it." Rule numbers are 1 to 32766.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html>
4. **Implicit deny.** Every NACL has a rule numbered `*` that denies any packet that
   matches no other rule. It cannot be deleted.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html>
5. **Default NACL.** The default NACL of a VPC allows all inbound and outbound traffic.
   A subnet that is not associated with another NACL uses the default NACL.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html>
6. **Ephemeral ports.** "The client that initiates the request chooses the ephemeral
   port range." Examples from AWS: Linux 32768-61000, Windows Server 2008 and later
   49152-65535, Elastic Load Balancing and NAT gateway 1024-65535. "To cover the
   different types of clients that might initiate traffic to public-facing instances
   in your VPC, you can open ephemeral ports 1024-65535."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports>

## Terraform differences

- `aws_default_network_acl` adopts the default NACL. "When Terraform first adopts the
  Default Network ACL, it immediately removes all rules in the ACL", then creates the
  rules in the configuration.
  Source: <https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/default_network_acl>
- A VPC created in the plan has a default NACL that does not appear in the plan.

## Engine behavior

A path from the internet to an instance crosses the subnet NACL twice:

1. **Request, inbound rules.** Protocol tcp, destination port 5432, source = the
   client address.
2. **Response, outbound rules.** Protocol tcp, destination = the client address,
   destination port = the client's ephemeral port.

The client's ephemeral port is not known. The engine uses 1024-65535, the range that
AWS recommends to cover all clients (rule 6). For the response hop:

- All of 1024-65535 allowed: `allowed`.
- None of 1024-65535 allowed: `blocked`.
- Only part allowed: `unknown`, reason "response depends on the client's ephemeral
  port". The result lists the allowed port ranges.

This choice needs review. A Linux-only client would need only 32768-61000.

## Slice 1 scope

Handled:

- A subnet with no NACL association, in a VPC managed in the plan (created or
  unchanged): the AWS default NACL (allow all, rule 5). The engine assumes the default
  NACL was not changed outside Terraform. Use `aws_default_network_acl` to make its
  rules part of the plan.
- `aws_default_network_acl` and `aws_network_acl` with inline `ingress`/`egress`
  blocks, associated through `subnet_ids` or `aws_network_acl_association`.
- `aws_network_acl_rule`, merged by rule number with the inline rules (or with the AWS
  default rules of an unmanaged default NACL). Two rules with the same number and
  direction return `unknown`.

Returns `unknown` with a reason:

- A VPC that is not created or managed in the plan. Its default NACL rules are unknown.
- IPv6 rules, ICMP rules, and any unknown value in the plan.
