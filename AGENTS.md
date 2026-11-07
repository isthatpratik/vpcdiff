# Working rules for coding agents

These rules apply to any AI coding agent working in this repository.

## Workflow

- Spec first. Do not write code without an issue that links to a section of the design doc or an ADR.
- Use TDD for the engine. Write the failing test or fixture first, then the code.
- One concern per pull request. Keep a PR under about 400 changed lines, except for generated code.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).
- Do not add `Co-Authored-By` trailers or tool attribution to commits or PRs.

## Git and GitHub approval

The maintainer decides what an agent may do without asking. The current scope:

- Allowed without asking: read-only git and `gh` operations; creating issues,
  branches, and pull requests; committing; pushing feature branches; merging a pull
  request after CI passes (squash, delete branch); closing issues fixed by a merge.
  This scope was granted to finish the v0.1 work and ends when v0.1 is done.
- Always ask first: force-push or any history rewrite; deleting a branch with
  unmerged work; changing repository settings (for example GitHub Pages); creating
  tags or releases; publishing to npm or the GitHub Marketplace; anything that costs
  money, such as AWS Reachability Analyzer runs; a new runtime dependency.
- Approval for one asked-for action does not cover the next one.

## Engine invariants

- `packages/engine` is pure. No `fs`, network, `Date.now()`, or `Math.random()`.
- The same input gives the same output, byte for byte. Sort every collection before output.
- Every AWS networking rule in the code cites its AWS documentation URL in a comment.
- When the engine cannot decide a path, return `unknown` with a reason. Never guess allow or deny.

## Fixtures

- Never edit `fixtures/**/expected.json` to make a test pass.
- A new or changed `expected.json` needs an oracle note: the AWS Reachability Analyzer result, or a written proof.

## Boundaries

- No new runtime dependency without an ADR.
- No secrets, real AWS account IDs, or real plans in the repository. Use synthetic fixtures only.
- Nothing real, ever. An agent never uses the maintainer's cloud profiles, saved logins, or
  accounts (AWS, Azure, Google Cloud). Every Terraform or OpenTofu run goes through
  `scripts/sandbox-env.ts`: an empty home, no inherited cloud variables, fake credentials.
  `fixtures/sandbox.test.ts` enforces it. A Reachability Analyzer run uses a throwaway
  account that the maintainer names for that run, never their own.
- The web viewer never sends plan data off the device.

## Definition of done

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- The design doc or an ADR is updated when behavior or design changes.
- The support matrix in `README.md` is updated when resource coverage changes.

## Needs human review

- Any change to engine semantics, fixtures, or ADRs.
