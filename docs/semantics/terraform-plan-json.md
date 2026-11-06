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
