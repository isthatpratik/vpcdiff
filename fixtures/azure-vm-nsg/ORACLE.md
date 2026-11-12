# Oracle: azure-vm-nsg

**Status:** written proof. Not verified against a real Azure subscription.

## Question

Which ports of `azurerm_linux_virtual_machine.web` and `.behind` can the internet reach?

## Setup (the plan creates everything)

- `azurerm_virtual_network.main` (`10.60.0.0/16`), subnets `web` (`10.60.1.0/24`) and
  `behind` (`10.60.2.0/24`).
- `web`: Standard public IP on its network interface.
  - Subnet NSG `web_subnet`: priority 100 allow tcp/22 from `Internet` to `*`.
  - NIC NSG `web_nic` (rules as separate resources): priority 100 deny tcp/22 from
    `198.51.100.0/24`; priority 110 allow tcp/22 from `*`.
- `behind`: Standard public IP. Subnet NSG `behind`: priority 100 allow tcp/443 from `*`.
  The subnet's route table sends `0.0.0.0/0` to a virtual appliance (`10.60.9.4`).

Rules: [azure.md](../../docs/semantics/azure.md).

## Proof

`web`, tcp/22:

1. **Public IP.** Standard public IP on the primary IP configuration (rule 1). Passes.
2. **NSGs.** The subnet NSG first (rule 3): rule `ssh` (100) allows every internet address
   (rule 6, `Internet`). Then the NIC NSG: `deny-range` (100) denies `198.51.100.0/24`;
   `ssh` (110) allows every other address (rule 4). Result: partial.
3. **Route.** The subnet has no route table, so the system route `0.0.0.0/0` to
   `Internet` carries the response (rule 8). The system routes always drop
   `157.59.0.0/16`, `104.147.0.0/16`, and `104.146.0.0/17`, so those are not internet
   sources. Passes.

Every other port and UDP: `DenyAllInbound` (65500) of the subnet NSG denies them; no rule
opens them, so they are not reported.

`behind`, tcp/443:

1. **Public IP.** Passes.
2. **NSG.** Rule `https` (100) allows tcp/443 from `*`. Passes.
3. **Route.** `0.0.0.0/0` goes to a virtual appliance: "You can no longer directly access
   resources in the subnet from the internet" (rule 8). Fails.

## Expected result

| Path | Before | After | Diff |
|---|---|---|---|
| internet to `web` tcp/22 | `absent` | `allowed`, the internet except `198.51.100.0/24` (and the ranges above) | **added** |
| internet to `behind` tcp/443 | `absent` | `blocked` at `route` | `unchanged` |

## How to verify in Azure

Use a throwaway subscription that the maintainer names for the run. Apply `after/` with an
appliance at `10.60.9.4` or none, and use Network Watcher IP flow verify for `web` on
TCP 22 (allowed from an outside address, denied from `198.51.100.0/24`) and for `behind`
on TCP 443 (the NSG allows it; the route sends the response to the appliance).
