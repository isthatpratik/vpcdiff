# Google Cloud: internet to Compute Engine VMs (#95)

The first Google Cloud scope ([ADR 0011](../adr/0011-multi-cloud.md)): IPv4 paths from the
internet to a `google_compute_instance`. Each path has `provider: "gcp"`. Its hops are
`public-ip`, `firewall`, and `route`.

## AWS terms and Google Cloud terms

| AWS | Google Cloud |
|---|---|
| VPC | VPC network (`google_compute_network`), global |
| Subnet | Subnet (`google_compute_subnetwork`), regional |
| Security group and NACL | VPC firewall rules (`google_compute_firewall`), per network |
| Internet gateway and route table | Default internet gateway, routes (`google_compute_route`) |
| Public IP or Elastic IP | External IP address (`access_config` on the interface) |

## Rules

1. **External IP address.** A VM interface has an external IPv4 address only with an
   `access_config` block: "Access configurations, i.e. IPs via which this instance can be
   accessed via the Internet. Omit to ensure that the instance is not accessible from the
   Internet."
   Source: <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_instance>
2. **Rules belong to a network.** "While firewall rules are defined at the network level,
   connections are allowed or denied on a per-instance basis."
   Source: <https://docs.cloud.google.com/firewall/docs/firewalls>
3. **Priority.** "Only the highest priority (lowest priority number) rule whose other
   components match traffic is applied." The default priority is 1000, and the range is 0
   to 65535. "If two rules match, they must have the same priority but different
   actions"; then "Cloud NGFW enforces the `deny` VPC firewall rule, and ignores the
   `allow` VPC firewall rule."
   Source: <https://docs.cloud.google.com/firewall/docs/firewalls>
   Source: <https://docs.cloud.google.com/firewall/docs/firewall-policies-rule-eval-order>
4. **Implied rule.** When no rule matches, "If the target resource is a network interface
   of a VM instance, the implied ingress action is `deny`."
   Source: <https://docs.cloud.google.com/firewall/docs/firewall-policies-rule-eval-order>
5. **Targets.** "When you omit a target specification, the firewall rule applies to all
   instances in the VPC network." A rule with target tags applies "if the instances have
   a network tag that matches at least one of the firewall rule's target network tags",
   and the same for target service accounts.
   Source: <https://docs.cloud.google.com/firewall/docs/firewalls>
6. **Sources.** Only `source_ranges` can match an internet address. "Source tags cannot
   be used to control traffic to an instance's external IP address", and the same holds
   for source service accounts. When a rule sets ranges and tags, it applies to an
   address in the ranges "OR" to a tagged instance.
   Source: <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_firewall>
7. **Disabled rules.** "When set to true, the firewall rule is not enforced and the
   network behaves as if it did not exist."
   Source: <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_firewall>
8. **Stateful.** "If a connection is allowed between a source and a target (for an
   ingress rule) ... all response traffic is allowed as long as the firewall's connection
   tracking state is active." Egress rules do not affect the response.
   Source: <https://docs.cloud.google.com/firewall/docs/firewalls>
9. **Default route.** "Google Cloud adds a system-generated IPv4 default route to the VPC
   network" to the default internet gateway, unless `delete_default_routes_on_create` is
   true. VMs "with external IPv4 addresses assigned to their network interfaces" use that
   next hop.
   Source: <https://docs.cloud.google.com/vpc/docs/routes>
   Source: <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network>

## Hops

1. **`public-ip`**: the VM's interface has an `access_config` block. Without one,
   `blocked`.
2. **`firewall`**: the ingress rules of the interface's network that apply to the VM
   (rule 5), not disabled, ordered by priority with `deny` first on a tie. The first rule
   that matches the protocol, the port, and the source address decides; no match is the
   implied deny. Sources are public IPv4 addresses (the same set as for AWS). Some
   allowed sources give `partial`.
3. **`route`**: the network keeps the system default route, and no custom route that
   applies to the VM sends public addresses elsewhere.

When allowed, `sources` is `["internet"]` or the allowed CIDRs.

## Returns `unknown` with a reason

- The network is not in the plan, for example `default`. The default network "is
  pre-populated with firewall rules that allow incoming connections to instances", and
  those rules are not in the plan.
- The VM has more than one network interface.
- The VM's tags or service accounts are unknown, and a rule with target tags or target
  service accounts could apply.
- A rule's priority, action, protocol, ports, sources, or targets are unknown until apply.
- `access_config` is unknown until apply.
- The network uses a firewall policy in the plan:
  `google_compute_network_firewall_policy_association`,
  `google_compute_region_network_firewall_policy_association`, or
  `google_compute_firewall_policy_association`. Policies are evaluated with the VPC
  firewall rules, and they are not modeled yet.
- The network has `delete_default_routes_on_create = true` and no custom default route to
  the default internet gateway. Whether a response needs the default route is not stated
  in the documentation.
- A custom route that applies to the VM sends public addresses to another next hop, or a
  policy-based route is in the plan.

## Scope

- Hierarchical firewall policies attached to the organization or a folder are evaluated
  first, and they are never in a project's plan. The engine cannot see them; the result
  assumes there is none.
- Firewall rules for the network that live in another configuration are not seen, as for
  AWS.
- IPv6, load balancers, Cloud SQL, and paths between VMs are not modeled yet.
- Google Cloud blocks some traffic before firewall rules: "External IPv4 and IPv6
  addresses only accept TCP, UDP, ICMP, IPIP, AH, ESP, SCTP, and GRE packets." The engine
  checks TCP and UDP only, so this does not change a result.

## Edge cases

- **Deny wins a tie**: an allow and a deny rule with the same priority both match: the
  deny decides.
- **Lower number wins**: an allow at priority 100 beats a deny at priority 1000.
- **Tags**: a rule with `target_tags = ["web"]` applies only to VMs with the tag `web`.
- **Source tags only**: such a rule never matches an internet address.
- **Disabled**: a disabled rule is ignored.
- **All protocols**: `allow { protocol = "all" }` matches every port.
