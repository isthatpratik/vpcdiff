# vpcdiff

See how a Terraform change affects AWS network reachability before you run `apply`.

`vpcdiff` reads a Terraform plan (`terraform show -json`), builds the network
reachability graph before and after the change, and shows the difference:

- paths that become reachable (for example, `0.0.0.0/0 → aws_db_instance.main:5432`)
- paths that are lost (for example, `alb → ecs:8080`)
- replacements (`-/+`, delete before create) on a path that stays open, which can cause a
  short outage during apply

Every result comes with a hop-by-hop explanation: which route, NACL rule, and
security group rule allowed or blocked the traffic.

> **Status:** v0.1 in progress. The engine and CLI evaluate internet-to-instance
> reachability (see the [support matrix](#support-matrix)). Design notes are in
> [`docs/design`](docs/design), [`docs/adr`](docs/adr), and [`docs/semantics`](docs/semantics).

## Quick start (CLI)

```sh
pnpm install && pnpm build
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra show -json tfplan > plan.json
node packages/cli/dist/vpcdiff.mjs plan.json
```

Example output for [`fixtures/sg-5432-opened`](fixtures/sg-5432-opened):

```text
vpcdiff: 1 added, 0 removed, 0 changed, 0 unknown, 0 unchanged

ADDED     internet -> aws_instance.db  tcp/5432
  before: blocked at security-group: no ingress rule of aws_security_group.db allows tcp/5432 from the internet
  after:  allowed from internet
    public-ip        allow   aws_instance.db associate_public_ip_address = true
    internet-gateway allow   aws_internet_gateway.main is attached to aws_vpc.main
    nacl-inbound     allow   default NACL of aws_vpc.main ingress rule 100: allow all traffic (AWS default)
    security-group   allow   aws_security_group.db ingress tcp 5432 from 0.0.0.0/0
    nacl-outbound    allow   default NACL of aws_vpc.main egress rule 100: allow all traffic (AWS default)
    route            allow   aws_route_table.public route 0.0.0.0/0 -> aws_internet_gateway.main
```

Options: `--format text|json|markdown`, `--all` (also unchanged paths),
`--fail-on added|changed|unknown|never` (default `added`). Exit codes: `0` no failing
paths, `1` failing paths, `2` usage or input error.

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
| `aws_internet_gateway`, `aws_internet_gateway_attachment` | supported |
| `aws_route_table` (inline routes), `aws_route`, `aws_route_table_association` | supported |
| Main route table: `aws_default_route_table`, `aws_main_route_table_association`, unmanaged default | supported |
| `aws_security_group` (inline), `aws_security_group_rule`, `aws_vpc_security_group_ingress_rule` | supported (IPv4 CIDR sources) |
| `aws_default_security_group`, unmanaged default security group | supported |
| `aws_network_acl` (inline), `aws_network_acl_rule`, `aws_network_acl_association`, `aws_default_network_acl`, unmanaged default NACL | supported |
| `aws_instance` (endpoint), `aws_eip`, `aws_eip_association` | supported |
| `aws_vpc_security_group_egress_rule` | read; does not affect inbound paths (security groups are stateful) |
| `aws_db_instance` (endpoint; `publicly_accessible`, `aws_db_subnet_group`) | supported |
| `aws_lb` (endpoint; internet-facing ALB and NLB, `aws_lb_listener` for NLBs without groups) | supported |
| Aurora, ECS services, Classic and Gateway Load Balancers | noted |
| Prefix lists, VPN route propagation, network interface attachments, secondary VPC CIDRs | unknown |
| NAT gateway, VPC peering, Transit Gateway, VPC endpoints, IPv6 | not yet; unknown or noted |

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
