// Generates fixtures/<name>/plan.json without an AWS account.
//
// Usage: node scripts/make-fixture-plan.ts fixtures/<name>
//
// Fixture layout:
//   after/main.tf    the configuration under review (required)
//   before/main.tf   the configuration already applied (optional)
//
// Without before/, the plan creates everything. With before/, the script plans
// before/, turns that plan into a synthetic state (fake IDs, AWS example account
// 123456789012), and plans after/ against it with -refresh=false. Terraform then
// produces a real update plan, and no AWS API is called.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const ACCOUNT = "123456789012"; // AWS documentation example account, not a real one.
const REGION = "us-east-1";
const AWS = 'provider["registry.terraform.io/hashicorp/aws"]';

const PROVIDER_OVERRIDE = `provider "aws" {
  access_key                  = "AKIAFAKEFAKEFAKEFAKE"
  secret_key                  = "fake"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
}
`;

// ID prefix and ARN resource name per resource type.
const KINDS: Record<string, [string, string]> = {
  aws_vpc: ["vpc", "vpc"],
  aws_internet_gateway: ["igw", "internet-gateway"],
  aws_subnet: ["subnet", "subnet"],
  aws_route_table: ["rtb", "route-table"],
  aws_route_table_association: ["rtbassoc", "route-table-association"],
  aws_security_group: ["sg", "security-group"],
  aws_network_acl: ["acl", "network-acl"],
  aws_instance: ["i", "instance"],
};

const cache = join(tmpdir(), "vpcdiff-tf-plugin-cache");
mkdirSync(cache, { recursive: true });
const env = { ...process.env, TF_PLUGIN_CACHE_DIR: cache, TF_IN_AUTOMATION: "1", CHECKPOINT_DISABLE: "1" };

function tf(cwd: string, args: string[]): string {
  return execFileSync("terraform", args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function plan(configDir: string, state?: Obj): { plan: Obj; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vpcdiff-fixture-"));
  for (const f of readdirSync(configDir)) if (f.endsWith(".tf")) cpSync(join(configDir, f), join(dir, f));
  writeFileSync(join(dir, "fixture_override.tf"), PROVIDER_OVERRIDE);
  if (state) writeFileSync(join(dir, "terraform.tfstate"), JSON.stringify(state, null, 2));
  tf(dir, ["init", "-input=false", "-no-color"]);
  tf(dir, ["plan", "-input=false", "-no-color", "-refresh=false", "-out=tfplan"]);
  return { plan: JSON.parse(tf(dir, ["show", "-json", "tfplan"])) as Obj, dir };
}

function resourceSchemas(dir: string): Obj {
  const all = JSON.parse(tf(dir, ["providers", "schema", "-json"])) as Obj;
  const aws = (all.provider_schemas as Obj)["registry.terraform.io/hashicorp/aws"] as Obj;
  return aws.resource_schemas as Obj;
}

/** Empty value for a top-level attribute or block, as AWS state stores it. */
function emptyValue(schema: Obj | undefined, key: string): Json {
  const block = (schema?.block ?? {}) as Obj;
  const attr = ((block.attributes ?? {}) as Obj)[key] as Obj | undefined;
  const kind = Array.isArray(attr?.type) ? attr.type[0] : undefined;
  if (kind === "list" || kind === "set") return [];
  if (kind === "map") return {};
  if (((block.block_types ?? {}) as Obj)[key]) return [];
  return null;
}

/** Resource addresses an expression refers to (entries like "aws_vpc.main", not "aws_vpc.main.id"). */
function referencedResources(expr: Json | undefined): string[] {
  const out = new Set<string>();
  const walk = (v: Json | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "references" && Array.isArray(x)) {
          for (const r of x) if (typeof r === "string" && /^aws_\w+\.[\w-]+$/.test(r)) out.add(r);
        } else walk(x);
      }
    }
  };
  walk(expr);
  return [...out].sort();
}

/** Turn a create-only plan into a Terraform v4 state with synthetic computed values. */
function toState(before: Obj, schemas: Obj): Obj {
  const changes = (before.resource_changes as Obj[]).filter((r) => r.mode === "managed");
  const config = ((before.configuration as Obj).root_module as Obj).resources as Obj[];
  const exprs = new Map(config.map((r) => [r.address as string, (r.expressions ?? {}) as Obj]));

  const ids = new Map<string, string>();
  [...changes]
    .sort((a, b) => String(a.address).localeCompare(String(b.address)))
    .forEach((r, i) => {
      const kind = KINDS[r.type as string];
      if (!kind) throw new Error(`No synthetic ID rule for ${String(r.type)}`);
      ids.set(r.address as string, `${kind[0]}-${(i + 1).toString(16).padStart(17, "0")}`);
    });

  const resources = changes.map((r) => {
    const address = r.address as string;
    const type = r.type as string;
    const change = r.change as Obj;
    const refs = exprs.get(address) ?? {};
    const id = ids.get(address) as string;

    const fill = (value: Json, unknown: Json, path: string[]): Json => {
      if (unknown === true) {
        const key = path[path.length - 1];
        if (path.length === 1 && key === "id") return id;
        if (path.length === 1 && key === "arn") return `arn:aws:ec2:${REGION}:${ACCOUNT}:${(KINDS[type] as [string, string])[1]}/${id}`;
        if (key === "owner_id") return ACCOUNT;
        if (key === "tags_all") return {};
        if (type === "aws_security_group" && path.length === 1 && key === "egress") return [];
        if (key?.endsWith("_id") || key === "vpc_security_group_ids") {
          const targets = referencedResources(refs[path[0] as string]).map((a) => ids.get(a)).filter(Boolean) as string[];
          if (key === "vpc_security_group_ids") return targets;
          if (targets.length === 1) return targets[0] as string;
        }
        return path.length === 1 && key ? emptyValue(schemas[type] as Obj | undefined, key) : null;
      }
      if (Array.isArray(value)) return value.map((v, i) => fill(v, Array.isArray(unknown) ? (unknown[i] ?? false) : false, [...path, String(i)]));
      if (value && typeof value === "object") {
        const u = (unknown && typeof unknown === "object" && !Array.isArray(unknown) ? unknown : {}) as Obj;
        const keys = new Set([...Object.keys(value), ...Object.keys(u)]);
        const out: Obj = {};
        for (const k of [...keys].sort()) out[k] = fill((value as Obj)[k] ?? null, u[k] ?? false, [...path, k]);
        return out;
      }
      return value;
    };

    return {
      mode: "managed",
      type,
      name: r.name as string,
      provider: AWS,
      instances: [
        {
          schema_version: ((schemas[type] as Obj | undefined)?.version as number | undefined) ?? 0,
          attributes: fill(change.after as Json, change.after_unknown as Json, []),
          sensitive_attributes: [],
          dependencies: Object.values(refs).flatMap((e) => referencedResources(e)).filter((a, i, all) => all.indexOf(a) === i).sort(),
        },
      ],
    };
  });

  return {
    version: 4,
    terraform_version: before.terraform_version as string,
    serial: 1,
    lineage: "00000000-0000-4000-8000-000000000000",
    outputs: {},
    resources,
    check_results: null,
  };
}

const fixture = resolve(process.argv[2] ?? "");
if (!existsSync(join(fixture, "after", "main.tf"))) {
  console.error("Usage: node scripts/make-fixture-plan.ts fixtures/<name>  (needs after/main.tf)");
  process.exit(2);
}

let state: Obj | undefined;
if (existsSync(join(fixture, "before", "main.tf"))) {
  const before = plan(join(fixture, "before"));
  state = toState(before.plan, resourceSchemas(before.dir));
}
const after = plan(join(fixture, "after"), state).plan;
after.timestamp = "2026-01-01T00:00:00Z"; // Fixed, so regenerating gives the same file.
// Remove the fake credentials and skip flags that fixture_override.tf added.
const providerConfig = ((after.configuration as Obj).provider_config as Obj | undefined)?.aws as Obj | undefined;
const providerExprs = providerConfig?.expressions as Obj | undefined;
if (providerConfig && providerExprs) providerConfig.expressions = { region: providerExprs.region ?? null };
writeFileSync(join(fixture, "plan.json"), JSON.stringify(after, null, 2) + "\n");
console.log(`Wrote ${join(fixture, "plan.json")}`);
