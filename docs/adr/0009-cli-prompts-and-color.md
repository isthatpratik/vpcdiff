# 0009: Interactive mode and color output for the CLI

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The maintainer asked for a CLI that is easy to use: it should ask for what it needs,
and its report should read as well as the viewer's. The CLI printed one plain text
format and needed a plan JSON file that the user made by hand with
`terraform show -json`.

The CLI also runs in CI and in the GitHub Action, where the output must stay stable
and plain, and the exit code is the contract.

## Decision

- Add two runtime dependencies to `packages/cli`, approved by the maintainer:
  - [`@clack/prompts`](https://github.com/bombshell-dev/clack) (MIT) for the prompts,
    spinner, and notes.
  - [`picocolors`](https://github.com/alexeyraspopov/picocolors) (ISC, no dependencies)
    for color. It follows `NO_COLOR` and `FORCE_COLOR`.
- Choose the output by where it goes:
  - **No arguments, in a terminal:** the interactive mode (`src/interactive.ts`). It
    lists plan JSON and binary plans in the current folder, converts a binary plan with
    `terraform show -json`, or runs `terraform plan` after the user confirms. Then it
    prints the report and offers next steps: every path, one path in full, or a
    Markdown summary saved to a file (it asks before it replaces a file).
  - **Text format, stdout is a terminal, `CI` not set:** the readable report
    (`src/pretty.ts`): the verdict first in plain words, the deciding rule, what to do,
    and only the hops that differ. It uses the same words as the viewer, from
    `@vpcdiff/engine/explain`.
  - **Everything else** (pipes, files, CI, `--format json|markdown`): unchanged.
- Run Terraform with `execFile` and an argument array, never through a shell. Write the
  temporary plan to a new folder in the system temp folder and delete it after.
- Move `explain.ts` and the hop lanes (`lanes.ts`) from the viewer into the engine as
  the subpath exports `@vpcdiff/engine/explain` and `@vpcdiff/engine/lanes`, so the
  viewer and the CLI share them. Both are pure.

## Alternatives considered

- **Ink (React for terminals).** More flexible, but React and its renderer are a large
  bundle for a few prompts.
- **Inquirer.** Mature, but heavier, and its look is older than clack's.
- **No prompts, better help text only.** Cheaper, but it does not remove the
  `terraform show -json` step, which is where new users stop.

## Consequences

- The CLI bundle is about 155 KB with both libraries included.
- `vpcdiff` with no arguments no longer prints the usage error in a terminal. In a pipe
  or CI it still does, with exit code `2`.
- The interactive mode is not unit tested end to end. Plan discovery (`discover.ts`)
  and the report (`pretty.ts`) are tested; the prompts are checked by hand.
