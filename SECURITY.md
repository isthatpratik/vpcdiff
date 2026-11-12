# Security policy

`vpcdiff` reads Terraform plans, which can contain sensitive infrastructure details.
The tool is designed to run fully offline and never sends plan data anywhere.

## Reporting a vulnerability

Please do not open a public issue for security problems.
Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**).

I will acknowledge a report within 7 days.

## Scope

In scope:

- Any path where plan data leaves the user's device
- Code execution through a crafted plan file
- Incorrect results that hide real exposure (false "not reachable")
- Output injection from a crafted plan: terminal escape sequences, Markdown or HTML in a
  pull request comment, or a comment that the GitHub Action writes into the wrong place

## Threat model

A plan comes from the change under review, so every string in it is untrusted. Resource
addresses can hold any characters (`for_each` keys). What the project does about it:

- **Engine.** Pure functions over the plan JSON: no file system, network, clock, or
  random values (ADR 0002). It rejects a malformed plan with `PlanError` and never throws
  anything else; `fixtures/fuzz.test.ts` mutates every fixture plan to check this, and
  that `Object.prototype` is never polluted.
- **CLI.** Text and Markdown output show control characters from the plan as `�`, so no
  terminal escape sequence reaches the terminal. JSON output escapes them by itself.
- **GitHub Action.** The pull request comment shows plan strings in code spans that they
  cannot close and escapes Markdown, HTML, and `@` mentions elsewhere. The Action updates
  only a comment that a bot wrote. It needs `pull-requests: write` for the comment and
  nothing else; on pull requests from forks the token is read-only, and the report goes
  to the job summary.
- **Viewer.** Runs in the browser with `connect-src 'none'`, and every script, style, font,
  and image comes from its own origin, so plan data cannot leave the device and no third
  party sees a visit. A plan you open is kept in the tab's `sessionStorage` (up to about
  5 MB) until the tab closes or you open another plan; it is never sent anywhere. React
  renders plan strings as text.
- **Fixtures.** Terraform and OpenTofu run in a sandbox with fake credentials
  (`scripts/sandbox-env.ts`); Azure plans use a local stand-in on `127.0.0.1`
  (`scripts/azure-standin.ts`). No real cloud account is used.
