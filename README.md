# vpcdiff

See how a Terraform change affects AWS network reachability before you run `apply`.

`vpcdiff` reads a Terraform plan (`terraform show -json`), builds the network
reachability graph before and after the change, and shows the difference:

- paths that become reachable (for example, `0.0.0.0/0 → aws_db_instance.main:5432`)
- paths that are lost (for example, `alb → ecs:8080`)
- security group replacements (`-/+`) that can cause a short outage

Every result comes with a hop-by-hop explanation: which route, NACL rule, and
security group rule allowed or blocked the traffic.

> **Status:** early design. Nothing is usable yet. See [`docs/design`](docs/design) and [`docs/adr`](docs/adr).

## Interfaces

| Interface | Use |
|---|---|
| Web viewer | Load a plan in the browser. Graph diff, path inspector, "can A reach B?" query. The plan never leaves your device. |
| CLI | Text or JSON output. Exit code `1` when the plan adds new exposure. |
| GitHub Action | Posts a reachability summary on the pull request. |

All three use the same engine.

## Goals

- **Correct.** Results are checked against AWS VPC Reachability Analyzer on a fixture corpus.
- **Explainable.** Every allowed or blocked path cites the rule that decided it.
- **Honest.** When the engine cannot decide a path, it returns `unknown` with a reason. It does not guess.
- **Offline.** No AWS credentials. No network calls.

## Non-goals

- Live account scanning. Use AWS Reachability Analyzer or Batfish for that.
- Generic policy rules ("no SSH from 0.0.0.0/0"). Checkov and Trivy already do that well.
- Clouds other than AWS, for now.

## Support matrix

What the engine models today. "unknown" means a path that such a resource can change is
reported as `unknown` with a reason, never as allowed or blocked by guess.

| Resource | Status |
|---|---|
| `aws_vpc` (primary IPv4 CIDR), `aws_subnet` | supported |
| `aws_internet_gateway` (with `vpc_id`) | supported |
| `aws_route_table` (inline `route` blocks), `aws_route_table_association`, main route table | supported |
| `aws_security_group` (inline `ingress` blocks, IPv4 CIDR sources) | supported |
| `aws_network_acl` (inline rules, `subnet_ids`), `aws_default_network_acl`, default NACL | supported |
| `aws_instance` (as endpoint; `associate_public_ip_address`, `map_public_ip_on_launch`) | supported |
| `aws_security_group_rule`, `aws_vpc_security_group_ingress_rule`, `aws_vpc_security_group_egress_rule` | planned; unknown |
| `aws_route`, `aws_main_route_table_association`, `aws_default_route_table` | planned; unknown |
| `aws_network_acl_rule`, `aws_network_acl_association` | planned; unknown |
| `aws_eip`, `aws_eip_association`, `aws_internet_gateway_attachment` | planned; unknown |
| `aws_db_instance`, `aws_lb` (as endpoints) | planned; noted |
| NAT gateway, VPC peering, Transit Gateway, VPC endpoints, prefix lists, IPv6 | not yet; unknown or noted |

Paths evaluated: from the internet to each endpoint, for every TCP and UDP port that one
of its security groups opens to a public address.

## Repository layout

```
packages/engine   pure reachability engine (no I/O)
packages/cli      command-line interface
packages/action   GitHub Action
apps/viewer       client-side web viewer
fixtures          plan.json + expected results, verified against AWS
docs              design doc, ADRs, AWS semantics notes
```

## License

[Apache-2.0](LICENSE)
