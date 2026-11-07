# AWS networking semantics

One note per concept. Each note states the rule, links the AWS documentation,
and lists the edge cases the engine must handle.

Each note also has a "Slice 1 scope" section: what the engine handles now, and what
returns `unknown` with a reason.

- [security-groups.md](security-groups.md): stateful, allow-only, Terraform removes the default egress rule
- [network-acls.md](network-acls.md): stateless, ordered rules, implicit deny, default NACL, ephemeral ports
- [route-tables.md](route-tables.md): main vs explicit association, `local` route, longest-prefix match
- [gateways.md](gateways.md): internet gateway, public IPv4 address (NAT and egress-only IGW later)
- [endpoints.md](endpoints.md): EC2 instances, RDS DB instances, load balancers
- [ipv6.md](ipv6.md): IPv6 paths from the internet, egress-only internet gateways
- [internal-paths.md](internal-paths.md): paths between endpoints inside a VPC, from security group references
- [terraform-plan-json.md](terraform-plan-json.md): `actions`, `before`, `after`, `after_unknown`, replacements
