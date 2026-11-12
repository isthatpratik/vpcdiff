// Generates fixtures/<name>/plan.json without an AWS account.
//
// Usage: node scripts/make-fixture-plan.ts fixtures/<name> [--tofu] [--out <file>]
//
// --tofu plans with OpenTofu (`tofu`) instead of Terraform. OpenTofu writes the same
// plan JSON format; scripts/check-opentofu.ts uses this to compare results (#34).
// --out writes the plan somewhere else than fixtures/<name>/plan.json.
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
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sandboxEnv } from "./sandbox-env.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const ACCOUNT = "123456789012"; // AWS documentation example account, not a real one.
const REGION = "us-east-1";
const argv = process.argv.slice(2);
const TOFU = argv.includes("--tofu");
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
const BIN = TOFU ? "tofu" : "terraform";
// Each tool resolves the bare "hashicorp/aws" source against its own registry.
const REGISTRY = TOFU ? "registry.opentofu.org" : "registry.terraform.io";
const AWS = `provider["${REGISTRY}/hashicorp/aws"]`;

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
  aws_ec2_managed_prefix_list: ["pl", "prefix-list"],
  aws_vpc_peering_connection: ["pcx", "vpc-peering-connection"],
  aws_ec2_transit_gateway: ["tgw", "transit-gateway"],
  aws_ec2_transit_gateway_vpc_attachment: ["tgw-attach", "transit-gateway-attachment"],
  aws_ec2_transit_gateway_route_table: ["tgw-rtb", "transit-gateway-route-table"],
};

const cache = join(tmpdir(), TOFU ? "vpcdiff-tofu-plugin-cache" : "vpcdiff-tf-plugin-cache");
mkdirSync(cache, { recursive: true });
// Never the caller's environment: no profile, login, or credential can reach the run.
const env = sandboxEnv({ TF_PLUGIN_CACHE_DIR: cache });

function tf(cwd: string, args: string[]): string {
  return execFileSync(BIN, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Provider settings for a plan that never reaches a real account. They live here, not in
// the fixture's main.tf, so a fixture never holds a token, even a fake one (the guard test
// in fixtures/sandbox.test.ts checks that). A Google Cloud plan of new resources needs no
// API call; the token is never valid.
const GOOGLE_OVERRIDE = `provider "google" {
  project      = "demo-project"
  region       = "us-central1"
  access_token = "fake-token-for-planning"
}
`;

/** The override file for the clouds a configuration uses (an override needs its base provider block). */
function overrideFor(configDir: string): string {
  const text = readdirSync(configDir).filter((f) => f.endsWith(".tf")).map((f) => readFileSync(join(configDir, f), "utf8")).join("\n");
  return [/hashicorp\/aws\b/.test(text) ? PROVIDER_OVERRIDE : "", /hashicorp\/google\b/.test(text) ? GOOGLE_OVERRIDE : ""].join("\n");
}

/**
 * A lock file kept from the first verified install of a set of providers. With it,
 * `init` uses the plugin cache and still checks the provider's hash, instead of
 * downloading the provider again for every fixture.
 */
function lockPath(configDir: string): string {
  const providers = readdirSync(configDir).filter((f) => f.endsWith(".tf")).map((f) => readFileSync(join(configDir, f), "utf8")).join("\n").match(/required_providers\s*\{[^}]*\}/g) ?? [];
  return join(cache, `lock-${createHash("sha256").update(providers.join("|")).digest("hex").slice(0, 16)}.hcl`);
}

function plan(configDir: string, state?: Obj): { plan: Obj; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vpcdiff-fixture-"));
  for (const f of readdirSync(configDir)) if (f.endsWith(".tf")) cpSync(join(configDir, f), join(dir, f));
  writeFileSync(join(dir, "fixture_override.tf"), overrideFor(configDir));
  if (state) writeFileSync(join(dir, "terraform.tfstate"), JSON.stringify(state, null, 2));
  const lock = lockPath(configDir);
  if (existsSync(lock)) cpSync(lock, join(dir, ".terraform.lock.hcl"));
  tf(dir, ["init", "-input=false", "-no-color"]);
  if (!existsSync(lock) && existsSync(join(dir, ".terraform.lock.hcl"))) cpSync(join(dir, ".terraform.lock.hcl"), lock);
  tf(dir, ["plan", "-input=false", "-no-color", "-refresh=false", "-out=tfplan"]);
  return { plan: JSON.parse(tf(dir, ["show", "-json", "tfplan"])) as Obj, dir };
}

function resourceSchemas(dir: string): Obj {
  const all = JSON.parse(tf(dir, ["providers", "schema", "-json"])) as Obj;
  const aws = (all.provider_schemas as Obj)[`${REGISTRY}/hashicorp/aws`] as Obj;
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
        // The default route table that AWS creates with a transit gateway (one table for both).
        if (type === "aws_ec2_transit_gateway" && path.length === 1 && (key === "association_default_route_table_id" || key === "propagation_default_route_table_id")) return `tgw-rtb-${id.slice("tgw-".length)}`;
        if (key === "tags_all") return {};
        if (type === "aws_security_group" && path.length === 1 && key === "egress") return [];
        // Amazon-provided IPv6 blocks (documentation-style, from Amazon's 2600:1f00::/24 range).
        if (type === "aws_vpc" && path.length === 1 && key === "ipv6_cidr_block") return "2600:1f18:aa00::/56";
        if (type === "aws_subnet" && path.length === 1 && key === "ipv6_cidr_block") return "2600:1f18:aa00:1::/64";
        // Group IDs in an inline rule (`ingress[0].security_groups`): the security groups
        // the block's expression references. Only one group per attribute is matched.
        // The same for prefix list IDs (`ingress[0].prefix_list_ids`).
        const KIND: Record<string, string> = { security_groups: "aws_security_group.", prefix_list_ids: "aws_ec2_managed_prefix_list." };
        const listOf = (attr: string) => referencedResources(refs[path[0] as string]).filter((x) => x.startsWith(KIND[attr] as string)).map((x) => ids.get(x)).filter(Boolean) as string[];
        if (key && KIND[key]) return listOf(key);
        const parent = path[path.length - 2];
        if (parent && KIND[parent]) {
          const g = listOf(parent);
          if (g.length === 1) return g[0] as string;
          throw new Error(`${address}: cannot fill ${path.join(".")}: the block references ${g.length} resources of that kind`);
        }
        // A list of IDs (`vpc_security_group_ids`, `subnet_ids`): every resource it references.
        const list = path.length === 1 && key?.endsWith("_ids");
        if (key?.endsWith("_id") || list) {
          const targets = referencedResources(refs[path[0] as string]).map((a) => ids.get(a)).filter(Boolean) as string[];
          if (list) return targets;
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

const fixture = resolve(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out") ?? "");
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
// Terraform lists relevant_attributes in a different order on each run.
if (Array.isArray(after.relevant_attributes)) after.relevant_attributes = after.relevant_attributes.map((a) => JSON.stringify(a)).sort().map((a) => JSON.parse(a) as Json);

// Remove the fake credentials and skip flags that fixture_override.tf added.
for (const [name, keep] of [["aws", ["region"]], ["google", ["project", "region"]]] as const) {
  const providerConfig = ((after.configuration as Obj).provider_config as Obj | undefined)?.[name] as Obj | undefined;
  const providerExprs = providerConfig?.expressions as Obj | undefined;
  if (providerConfig && providerExprs) providerConfig.expressions = Object.fromEntries(keep.map((k) => [k, providerExprs[k] ?? null]));
}
// Plan JSON keeps sensitive values in clear text and only marks them: `X` next to
// `X_sensitive` (before, after, values/sensitive_values), outputs with `sensitive: true`,
// and variables declared sensitive. Redact by path, so keys and other values stay intact.
const REDACTED = "(sensitive value removed)";
const secrets = new Set<string>();
const mask = (value: Json, m: Json): Json => {
  if (m === true) {
    if (typeof value === "string") secrets.add(value);
    return value === null ? null : REDACTED;
  }
  if (Array.isArray(value) && Array.isArray(m)) return value.map((v, i) => mask(v, m[i] ?? false));
  if (value && typeof value === "object" && !Array.isArray(value) && m && typeof m === "object" && !Array.isArray(m)) {
    const out: Obj = { ...value };
    for (const [k, mk] of Object.entries(m)) if (k in out) out[k] = mask(out[k] ?? null, mk);
    return out;
  }
  return value;
};
const walk = (node: Json): Json => {
  if (Array.isArray(node)) return node.map(walk);
  if (!node || typeof node !== "object") return node;
  const out: Obj = {};
  for (const [k, v] of Object.entries(node)) out[k] = walk(v);
  for (const k of Object.keys(out)) {
    const m = out[`${k}_sensitive`] ?? (k === "values" ? out.sensitive_values : undefined);
    if (m !== undefined && !k.endsWith("_sensitive")) out[k] = mask(out[k] ?? null, m);
  }
  if (out.sensitive === true && "value" in out) out.value = mask(out.value ?? null, true);
  return out;
};
const redacted = walk(after) as Obj;
const sensitiveVars = new Set(Object.entries((((redacted.configuration as Obj | undefined)?.root_module as Obj | undefined)?.variables as Obj | undefined) ?? {}).filter(([, v]) => (v as Obj).sensitive === true).map(([k]) => k));
for (const [name, v] of Object.entries((redacted.variables as Obj | undefined) ?? {})) if (sensitiveVars.has(name)) (v as Obj).value = mask((v as Obj).value ?? null, true);
// Constants in the configuration that equal a redacted value (for example a literal password).
const scrubConstants = (node: Json): Json => {
  if (Array.isArray(node)) return node.map(scrubConstants);
  if (!node || typeof node !== "object") return node;
  const out: Obj = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === "constant_value" && typeof v === "string" && secrets.has(v) ? REDACTED : scrubConstants(v);
  return out;
};
redacted.configuration = scrubConstants(redacted.configuration ?? null);
const text = JSON.stringify(redacted, null, 2);
const target = OUT ? resolve(OUT) : join(fixture, "plan.json");
writeFileSync(target, text + "\n");
console.log(`Wrote ${target}`);
