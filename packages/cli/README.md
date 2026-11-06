# @vpcdiff/cli

<img alt="The vpcdiff CLI in guided mode: it finds plan.json, shows that the plan opens aws_instance.db on tcp/5432 to the internet, and saves a Markdown summary" src="../../docs/assets/cli-demo.gif" width="100%">

Command-line interface for the engine.

- `vpcdiff` with no arguments, in a terminal: finds a plan in the current folder (or
  makes one with Terraform after you confirm), shows the report, and offers next steps.
- `vpcdiff plan.json`: in a terminal, a readable report in color. In pipes and CI,
  stable plain text. `--format json|markdown` for machines and pull requests.

Exit code `1` when a plan adds new exposure (see `--fail-on`). Design: [ADR 0009](../../docs/adr/0009-cli-prompts-and-color.md).
