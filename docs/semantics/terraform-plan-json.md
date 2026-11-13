# Terraform plan JSON

Input is the output of `terraform show -json <planfile>`.
Source for every field below: <https://developer.hashicorp.com/terraform/internals/json-format>

## Fields the engine reads

- `format_version`: the format version. The engine accepts major version `1`.
- `resource_changes[]`: one entry per resource instance, with `address`, `mode`,
  `type`, `name`, and `change`.
- `change.actions`: one of `["no-op"]`, `["create"]`, `["read"]`, `["update"]`,
  `["delete", "create"]`, `["create", "delete"]`, or `["delete"]`. The two lists with
  both `delete` and `create` are replacements.
- `change.before` and `change.after`: the object before and after the action.
  `before` is `null` for `create`, and `after` is `null` for `delete`.
- `change.after_unknown`: same shape as `after`. Every leaf whose value is known only
  after apply is `true`. Known leaves are omitted.
- `change.replace_paths`: the attribute paths that caused a replacement.

## Engine behavior

- **Before model:** built from `change.before` of every managed resource that is not
  being created.
- **After model:** built from `change.after` of every managed resource that is not
  being deleted, combined with `change.after_unknown`.
- **Unknown values:** a value marked in `after_unknown` is unknown. If a hop depends
  on it, the result is `unknown`, and the reason names the resource address and the
  attribute path (ADR 0003).
- **References that resolve at apply time.** In a create-only plan, IDs such as
  `vpc_id` are unknown. The engine links resources through the `configuration`
  section's `references` instead of through ID values.
- **Module outputs and inputs** (issue #140). A reference such as `module.net.subnet_id`
  points at a module output, and `var.vpc_id` inside a module points at a module input.
  The plan hides the value, but `configuration` keeps the expression's references: the
  output's references inside the module (`configuration...module_calls.net.module.outputs`)
  and the input's references in the call (`module_calls.web.expressions`). The engine
  follows them, through any number of levels, until it reaches resources, and then links
  as before. Rules:
  - A resource reference keeps its module path, with the instance key that the
    reference writes (`module.net[0].aws_subnet.a`).
  - Terraform lists the bare module (`module.net`) beside every output reference. The
    engine ignores it when a more specific reference exists.
  - It decides only when the references lead to exactly one resource instance. A list
    output indexed with `[0]` over a resource with several instances stays `unknown`,
    because the plan does not say in which order the module lists them.
  - `local.*`, `data.*`, `each.*`, `count.*`, a variable that the call does not set, and
    a reference to a module or output that does not exist stay as they are, so the
    attribute is `unknown` with a reason. The plan does not contain locals at all, so a
    module that links resources through a local (for example `local.vpc_id` in
    `terraform-aws-modules/vpc`) is `unknown` when the linked resources are created in
    the same plan. When they already exist, their IDs are known and no reference is needed.
- **References in nested blocks are merged.** Terraform 1.13 lists the references of
  a whole block under the block name. For example, an `aws_route_table` with two
  `route` blocks has one `route.references` list for both. With one route this is
  exact. With several routes, a route whose target is unknown returns `unknown`.
- **Data sources** (`mode: "data"`) are not part of the network model in slice 1. A
  hop that depends on one returns `unknown`.
- **Replacements.** `["delete", "create"]` deletes the old object first;
  `["create", "delete"]` comes from `create_before_destroy`: "Terraform creates a
  replacement resource before destroying the current resource."
  Source: <https://developer.hashicorp.com/terraform/language/block/resource>
  A path allowed before and after gets `outageRisk` with the resources on it that are
  replaced delete-first: traffic can drop while the old object is gone.

## Open questions

1. Answered by `fixtures/sg-5432-opened` (Terraform 1.13.3): `resource_changes`
   lists unchanged managed resources with `["no-op"]` and full `before` and `after`
   values. The engine does not need `prior_state` for them.
2. Sensitive values (`before_sensitive`, `after_sensitive`) are not network fields in
   slice 1. The engine must never print a sensitive value in an explanation.

## OpenTofu

OpenTofu's `tofu show -json` writes the same plan format (`format_version` 1.x,
`resource_changes`, `configuration`). The one difference the engine meets is the
provider address: `registry.opentofu.org/hashicorp/aws` instead of
`registry.terraform.io/hashicorp/aws`. The engine does not read provider addresses, so
the result is the same. CI checks this for every fixture (`fixtures/opentofu.test.ts`).
Source: <https://opentofu.org/docs/internals/json-format/>
