# Oracle: gcp-vm-firewall

**Status:** written proof. Not verified against a real Google Cloud project.

## Question

Which TCP and UDP ports of `google_compute_instance.web` and
`google_compute_instance.worker` can the internet reach?

## Setup (the plan creates everything)

- `google_compute_network.main` (custom subnets; the system default route is kept).
  `google_compute_subnetwork.app` (`10.50.1.0/24`).
- Firewall rules of `main`, all ingress:
  - `ssh`: priority 1000, allow tcp/22 from `0.0.0.0/0`, target tag `web`.
  - `block_range`: priority 900, deny tcp/22 from `198.51.100.0/24`, all instances.
  - `http_off`: allow tcp/80 from `0.0.0.0/0`, **disabled**.
  - `from_bastion`: allow tcp/5432 from source tag `bastion` only.
- `web`: tag `web`, an `access_config` (external IP). `worker`: tag `web`, no
  `access_config`.

Rules: [gcp.md](../../docs/semantics/gcp.md).

## Proof

`web`, tcp/22:

1. **External IP.** `access_config` is set (rule 1). Passes.
2. **Firewall.** Rules that apply to `web` (rule 5): `ssh` (tag `web`), `block_range`
   (no target), `from_bastion` (no target). `http_off` is disabled (rule 7).
   `from_bastion` has source tags only, so it matches no internet address (rule 6). In
   priority order (rule 3): `block_range` (900) denies `198.51.100.0/24`; then `ssh`
   (1000) allows every other address. Result: partial, every public address except
   `198.51.100.0/24`.
3. **Route.** The network keeps the system default route to the default internet
   gateway (rule 9). Passes.

`web`, other ports and UDP: no applying rule allows them, so the implied rule denies them
(rule 4). They are not reported as paths.

`worker`, tcp/22: `ssh` applies (tag `web`), so tcp/22 is a candidate. **External IP:**
there is no `access_config`, so `blocked` at `public-ip`.

## Expected result

| Path | Before | After | Diff |
|---|---|---|---|
| internet to `web` tcp/22 | `absent` | `allowed`, sources: public IPv4 except `198.51.100.0/24` | **added** |
| internet to `worker` tcp/22 | `absent` | `blocked` at `public-ip` | `unchanged` |

## How to verify in Google Cloud

Use a throwaway project that the maintainer names for the run. Apply `after/` and run
Connectivity Tests from an external address to `web` on TCP 22 (reachable), from an
address in `198.51.100.0/24` (dropped by `deny-range`), and to `worker` (no external IP).
