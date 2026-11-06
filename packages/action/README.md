# vpcdiff GitHub Action

Shows how a Terraform plan changes AWS network reachability from the internet. It writes
the report to the job summary, comments on the pull request, and fails the step when
the plan opens a new path.

```yaml
name: vpcdiff
on: pull_request
permissions:
  contents: read
  pull-requests: write   # for the comment
jobs:
  reachability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: |
          terraform -chdir=infra init -input=false
          terraform -chdir=infra plan -input=false -out=tfplan
          terraform -chdir=infra show -json tfplan > "$RUNNER_TEMP/plan.json"
      - uses: isthatpratik/vpcdiff@v0.1.1
        with:
          plan: ${{ runner.temp }}/plan.json
          # fail-on: added     # added | changed | unknown | never
          # comment: "true"
```

| Input | Default | Meaning |
|---|---|---|
| `plan` | (required) | Path to `terraform show -json` output. |
| `fail-on` | `added` | Fail when the plan has paths of this kind or worse: `added`, `changed`, `unknown`, `never`. |
| `comment` | `true` | On pull requests, create or update one comment. |
| `all` | `false` | Also list unchanged paths. |
| `github-token` | `${{ github.token }}` | Token for the comment. Needs `pull-requests: write`. |

Outputs: `added`, `removed`, `changed`, `unknown`, `unchanged` (counts).

Pull requests from forks get a read-only token, so the action cannot comment there. It
writes a warning, and the report is still in the job summary.

The comment and the job summary contain resource addresses and rule text from your
plan. They stay in your repository. The action makes no other network calls.

The action has no runtime dependencies. `dist/index.mjs` is the esbuild bundle of
`src/`; CI fails if it is out of date.
