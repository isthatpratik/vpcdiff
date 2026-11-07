<p align="center">
  <a href="https://isthatpratik.github.io/vpcdiff/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
      <img alt="vpcdiff: see what a Terraform plan opens to the internet" src="docs/assets/banner-light.png" width="100%">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/isthatpratik/vpcdiff/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/isthatpratik/vpcdiff/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/isthatpratik/vpcdiff/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/isthatpratik/vpcdiff?color=111111"></a>
  <a href="https://github.com/marketplace/actions/vpcdiff"><img alt="GitHub Marketplace" src="https://img.shields.io/badge/marketplace-vpcdiff-111111?logo=github"></a>
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache%202.0-111111"></a>
</p>

<p align="center">
  <a href="https://isthatpratik.github.io/vpcdiff/app/"><b>Try it live</b></a> ·
  <a href="https://isthatpratik.github.io/vpcdiff/">Site</a> ·
  <a href="#github-action">GitHub Action</a> ·
  <a href="#quick-start-cli">CLI</a> ·
  <a href="#support-matrix">Support matrix</a>
</p>

# vpcdiff

See what a Terraform plan opens to the internet, before you run `apply`.

`vpcdiff` reads a Terraform plan (`terraform show -json`), works out which AWS resources
the internet can reach before and after the plan, and shows what changes:

- paths the plan opens (for example, `0.0.0.0/0 → aws_instance.db` on tcp/5432)
- paths the plan closes, and paths whose allowed sources change
- paths it cannot decide, reported as unknown with the reason, never guessed
- outage risk: a security group or route on an open path that the plan replaces by
  deleting it first

Every result names the hop and the rule that decided it (public IP, internet gateway,
network ACL, security group, route), with a link to the AWS documentation. It needs no
AWS account or credentials, and the viewer never sends your plan anywhere.

<p align="center">
  <img alt="The vpcdiff viewer on a plan that opens PostgreSQL to the internet: the plan verdict, the path, the security group rule that decided it, what to do, and the hops before and after" src="docs/assets/viewer.png" width="100%">
</p>

> **Status:** [v0.1.1](https://github.com/isthatpratik/vpcdiff/releases/tag/v0.1.1) is
> released. It checks IPv4 paths from the internet to instances, databases, and load
> balancers (see the [support matrix](#support-matrix)); paths inside the VPC are next on
> the [roadmap](#roadmap). Design notes are in [`docs/design`](docs/design),
> [`docs/adr`](docs/adr), and [`docs/semantics`](docs/semantics).

## GitHub Action

```yaml
- run: terraform show -json tfplan > plan.json
- uses: isthatpratik/vpcdiff@v0.1.1
  with:
    plan: plan.json
    # fail-on: added   # added | changed | unknown | never
    # added = new exposure to the internet; changed also counts
    # paths inside the VPC that the plan opens or cuts
```

It comments on the pull request, writes the report to the job summary, and fails the
check when the plan opens a path. Full setup: [`packages/action`](packages/action/README.md).
Listed on the [GitHub Marketplace](https://github.com/marketplace/actions/vpcdiff).

## Quick start (CLI)

```sh
pnpm install && pnpm build
cd infra
node ../packages/cli/dist/vpcdiff.mjs
```

With no arguments, in a terminal, `vpcdiff` asks which plan to read. It finds plan JSON
and binary plans (`tfplan`, `*.tfplan`) in the folder, converts a binary plan with
`terraform show -json`, or runs `terraform plan` for you after you confirm. Then it
prints the report and offers next steps: every path, one path in full, or a Markdown
summary for the pull request.

<p align="center">
  <img alt="The vpcdiff CLI in guided mode: it finds plan.json, shows that the plan opens aws_instance.db on tcp/5432 to the internet, and saves a Markdown summary" src="docs/assets/cli-demo.gif" width="100%">
</p>

To pass a plan yourself:

```sh
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra show -json tfplan > plan.json
node packages/cli/dist/vpcdiff.mjs plan.json
```

In a terminal, the report leads with the verdict. Example for
[`fixtures/sg-5432-opened`](fixtures/sg-5432-opened):

```text
vpcdiff  plan.json
Fix before merge · 1 path opens to any public IPv4 address
1 opened · 0 closed · 0 changed · 0 outage risk · 0 unknown

● Opened to the internet
  aws_instance.db  tcp/5432 (PostgreSQL)  Blocked → Reachable
  After this plan, the network lets any public IPv4 address reach aws_instance.db on tcp/5432 (PostgreSQL).
  Decided at the Security groups hop:
    aws_security_group.db ingress tcp 5432 from 0.0.0.0/0
  What to do: If this is not intended, narrow the rule's source to a private range, such as your VPC CIDR.

  Hop               Before       After
  Security groups   denies       allows      aws_security_group.db
  Target            not checked  allows      aws_instance.db
  NACL outbound     not checked  allows      default NACL of aws_vpc.main
  Return route      not checked  allows      aws_route_table.public
  4 other hops are the same before and after.
```

In pipes and CI, the text output is stable plain text with every hop:

```text
vpcdiff: 1 added, 0 removed, 0 changed, 0 unknown, 0 unchanged

ADDED     internet -> aws_instance.db  tcp/5432
  before: blocked at security-group: no ingress rule of aws_security_group.db allows tcp/5432 from the internet
  after:  allowed from internet
    public-ip        allow   aws_instance.db associate_public_ip_address = true
    ...
```

Options: `--format text|json|markdown`, `--all` (also unchanged paths),
`--fail-on added|changed|unknown|never` (default `added`). Set `NO_COLOR=1` to turn
color off. Exit codes: `0` no failing paths, `1` failing paths, `2` usage or input
error.

## Interfaces

| Interface | Use |
|---|---|
| Web viewer | Load a plan in the browser. Each path, from the internet or inside the VPC, with a verdict in plain words and a hop table. The plan never leaves your device. |
| CLI | Guided mode in a terminal, or text, JSON, or Markdown output. Exit code `1` when the plan adds new exposure. |
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

Plans from Terraform (`terraform show -json`) and OpenTofu (`tofu show -json`) work the
same way: OpenTofu writes the same plan JSON format. CI plans every fixture with
OpenTofu 1.13 and checks that the result matches the Terraform result byte for byte.

What the engine models today. "unknown" means a path that such a resource can change is
reported as `unknown` with a reason, never as allowed or blocked by guess.

| Resource | Status |
|---|---|
| `aws_vpc` (primary IPv4 CIDR), `aws_subnet` | supported |
| `aws_internet_gateway`, `aws_internet_gateway_attachment` | supported |
| `aws_route_table` (inline routes), `aws_route`, `aws_route_table_association` | supported |
| Main route table: `aws_default_route_table`, `aws_main_route_table_association`, unmanaged default | supported |
| `aws_security_group` (inline), `aws_security_group_rule`, `aws_vpc_security_group_ingress_rule` | supported (IPv4 CIDR and security group sources) |
| `aws_default_security_group`, unmanaged default security group | supported |
| `aws_network_acl` (inline), `aws_network_acl_rule`, `aws_network_acl_association`, `aws_default_network_acl`, unmanaged default NACL | supported |
| `aws_instance` (endpoint), `aws_eip`, `aws_eip_association` | supported |
| Egress rules: inline `egress`, `aws_security_group_rule`, `aws_vpc_security_group_egress_rule` | supported for paths inside the VPC; internet paths do not need them (security groups are stateful) |
| Paths inside the VPC: endpoint to endpoint through a security group reference (`security_groups`, `source_security_group_id`, `referenced_security_group_id`, `self`) | supported in one VPC and across an active VPC peering connection (`aws_vpc_peering_connection`, `_accepter`); Transit Gateway and middlebox routes are unknown |
| `aws_db_instance` (endpoint; `publicly_accessible`, `aws_db_subnet_group`) | supported |
| `aws_lb` (endpoint; internet-facing ALB and NLB, `aws_lb_listener` for NLBs without groups) | supported |
| `aws_rds_cluster_instance` (Aurora endpoint; groups and subnet group from `aws_rds_cluster`) | supported |
| `aws_ecs_service` (endpoint with awsvpc `network_configuration`; public IP on Fargate only) | supported |
| `aws_elb` (Classic Load Balancer endpoint in a VPC) | supported |
| Gateway Load Balancers, ECS services in bridge or host mode | noted |
| Customer-managed prefix lists in the plan (`aws_ec2_managed_prefix_list`, `aws_ec2_managed_prefix_list_entry`) in rules and routes | supported |
| Prefix lists outside the plan (AWS-managed) | undecided sources; unknown when nothing else decides |
| VPN route propagation, network interface attachments, secondary VPC CIDRs | unknown |
| Response routes to a NAT gateway, a VPC peering connection, or a blackhole | supported (they block internet paths) |
| Transit Gateway, VPN gateway, middlebox network interfaces | unknown (routing continues outside the plan) |
| `aws_vpc_endpoint` Interface (target inside the VPC) and Gateway (prefix list route; its addresses undecided) | supported |
| IPv6 | not yet; unknown or noted |

Paths evaluated: from the internet to each endpoint, for every TCP and UDP port that one
of its security groups opens to a public address.

## Roadmap

In order. Each item lands with a spec, unit tests, fixture tests with written proofs, a
security review, and an updated support matrix.

1. [Paths inside the VPC](https://github.com/isthatpratik/vpcdiff/issues/32): security
   group references, so "load balancer to service" or "web to database" changes show up.
   In review: #76, #77, and the display PR.
2. [More AWS networking](https://github.com/isthatpratik/vpcdiff/issues/33): NAT gateways,
   VPC peering, Transit Gateway, VPC endpoints, IPv6, and prefix lists.
3. [OpenTofu support](https://github.com/isthatpratik/vpcdiff/issues/34): done. Every
   fixture is also planned with OpenTofu in CI, and the result must match byte for byte.
4. [More endpoints](https://github.com/isthatpratik/vpcdiff/issues/35) (done): Aurora, ECS
   services, and Classic Load Balancers.
5. [Azure and Google Cloud](https://github.com/isthatpratik/vpcdiff/issues/36), after v1,
   with an ADR first.

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
