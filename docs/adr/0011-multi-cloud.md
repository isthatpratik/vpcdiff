# 0011: Google Cloud and Azure are modules of the one engine

- **Status:** Accepted
- **Date:** 2026-11-12
- **Amends:** [ADR 0001](0001-typescript-single-engine.md) (one engine) and
  [ADR 0002](0002-pure-engine.md) stay as they are.

## Context

The engine reads AWS resources only. Issue #36 asks for Azure and Google Cloud. The
questions are where the code goes, what the result looks like, and how fixtures get made
when nobody may touch a real account.

## Decision

- **One package, one module per cloud.** `packages/engine/src/gcp/` and `.../azure/` sit
  next to the AWS code. The engine stays pure and gets no new dependency.
- **One result.** `analyze()` finds the clouds in a plan by resource type prefix (`aws_`,
  `google_`, `azurerm_`), runs each module, and merges the paths and notes in one sorted
  list. A plan can hold several clouds.
- **Result format stays `0.2`; the change is additive.** `Path.provider` is `"gcp"` or
  `"azure"`; absent means AWS, so every AWS result stays byte for byte the same. New hop
  kinds: `firewall` (a Google Cloud VPC firewall decision) and `nsg` (an Azure network
  security group, subnet or interface level). `public-ip` and `route` are reused. A path
  id is still `internet->` plus the Terraform address, which is unique. Consumers must
  show a hop kind they do not know by its name instead of failing; the viewer, CLI, and
  Action in this repository do.
- **Viewer, CLI, and Action** pick the columns from `path.provider`, as they already do
  for paths inside the VPC. Wording says "the internet", the resource, and the cloud's own
  terms. The scope line and the support matrix list each cloud.
- **First scope of each cloud:** paths from the internet to virtual machines, and to
  managed databases that use an address allow list. Paths between a cloud's own
  resources are not modeled yet; resources that could change a path get a note.
- **Same rules as AWS:** every rule cites its documentation, and anything the plan cannot
  decide is `unknown` with the reason.
- **Fixtures run in a sandbox.** Every Terraform run goes through `scripts/sandbox-env.ts`
  (empty home, no inherited credentials). No cloud account is used.
  - Google Cloud plans offline with a fake `access_token`.
  - The Azure provider calls the Azure management API even for a plan. The generator
    starts a small local stand-in for that API and a test double of the `az` command that
    returns made-up identity data, so nothing leaves the machine and no real login is used.

## Alternatives considered

- **A package per cloud.** More packaging and a result format that has to be shared
  anyway. It can be split out later without changing the result.
- **Bump the result format to `0.3`.** Every fixture's `expected.json` would change only
  in its version string. The change is additive, so the version stays.
- **One generic graph model for all clouds.** It would hide the real differences: Google
  Cloud firewall rules have priorities and tags, Azure NSGs have two levels and default
  rules, AWS security groups only allow. Each cloud keeps its own rules and shares only
  the result.
- **Planning against real accounts for fixtures.** Rejected: nothing real, ever
  (AGENTS.md).

## Consequences

- A plan with several clouds gives one report. The README matrix grows a section per cloud.
- The result format does not change version. Consumers see a new optional `provider`
  field and new hop kinds; AWS results do not change.
- The Azure fixture generator has more moving parts than the others; its stand-in API and
  `az` test double are small, documented, and covered by the guard tests.
