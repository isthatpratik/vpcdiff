# Contributing

Thanks for your interest. The project is in early design, so the best way to help
right now is to open an issue about AWS networking behavior that the design misses.

## Before you write code

1. Open or find an issue.
2. For a change in engine behavior, link the AWS documentation that describes the behavior.
3. For a design change, propose an ADR in `docs/adr/` (copy `0000-template.md`).

## Pull requests

- Keep each PR to one concern.
- Add or update a fixture for every change in engine behavior.
- Use Conventional Commits for commit messages.
- Make sure `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.

## Fixtures

Fixtures live in `fixtures/<name>/` and contain:

- `after/main.tf`: the Terraform source under review
- `before/main.tf` (optional): the Terraform source already applied
- `plan.json`: generated with `pnpm fixture:plan fixtures/<name>` (see [fixtures/README.md](fixtures/README.md))
- `expected.json`: the expected reachability result
- `ORACLE.md`: how the expected result was verified

Use synthetic resources only. Never commit a plan from a real account.
