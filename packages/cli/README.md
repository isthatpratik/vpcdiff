# vpcdiff

<img alt="The vpcdiff CLI in guided mode: it finds plan.json, shows that the plan opens aws_instance.db on tcp/5432 to the internet, and saves a Markdown summary" src="https://raw.githubusercontent.com/isthatpratik/vpcdiff/main/docs/assets/cli-demo.gif" width="100%">

See what a Terraform or OpenTofu plan opens to the internet before you apply, on AWS,
Google Cloud, and Azure. This is the command-line interface; the
[GitHub Action](https://github.com/marketplace/actions/vpcdiff) and the
[offline web viewer](https://isthatpratik.github.io/vpcdiff/app/) use the same engine.

```sh
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
npx vpcdiff plan.json
```

Needs Node.js 24 or later. No cloud account or credentials: it reads the JSON that
`terraform show` produces, and it never sends your plan anywhere.

- `vpcdiff` with no arguments, in a terminal: finds a plan in the current folder (or
  makes one with Terraform after you confirm), shows the report, and offers next steps.
- `vpcdiff plan.json`: in a terminal, a readable report in color. In pipes and CI,
  stable plain text. `--format json|markdown` for machines and pull requests.

Exit code `1` when a plan adds new exposure (see `--fail-on`), `2` for a usage or input error.
More: [documentation and support matrix](https://github.com/isthatpratik/vpcdiff#readme), [source](https://github.com/isthatpratik/vpcdiff). Design: [ADR 0009](https://github.com/isthatpratik/vpcdiff/blob/main/docs/adr/0009-cli-prompts-and-color.md).
