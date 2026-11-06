// Reads `terraform show -json` plan output.
// Format: https://developer.hashicorp.com/terraform/internals/json-format

export type Obj = Record<string, unknown>;

export interface Resource {
  /** Instance address, for example `module.net.aws_subnet.a[0]`. */
  address: string;
  type: string;
  /** Values on this side of the plan (`before` or `after`). */
  values: Obj;
  /** `after_unknown` on the after side; `false` on the before side. */
  unknown: unknown;
  /** Top-level attribute name to referenced resource instance addresses. */
  refs: Record<string, string[]>;
  /** Top-level attributes set in the configuration. */
  configured: Set<string>;
  /** Top-level attributes whose expression also uses variables, locals, module outputs, or data sources. */
  otherRefs: Set<string>;
  actions: string[];
}

/** Plain code-unit order, the same on every machine (no locale). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface Snapshot {
  side: "before" | "after";
  resources: Map<string, Resource>;
  /** Known `id` value to resource address. */
  byId: Map<string, string>;
  /** Instance addresses grouped by resource address without instance keys. */
  instancesOf: Map<string, string[]>;
}

export class PlanError extends Error {}

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const stripKeys = (address: string) => address.replace(/\[[^\]]*\]/g, "");

interface ConfigInfo {
  refs: Record<string, string[]>;
  configured: Set<string>;
  otherRefs: Set<string>;
}

const RESOURCE_REF = /^aws_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.|$)/;

/** Collects resource references per top-level attribute from the configuration section. */
function configRefs(plan: Obj): Map<string, ConfigInfo> {
  const out = new Map<string, ConfigInfo>();
  const walkModule = (mod: unknown, prefix: string) => {
    if (!isObj(mod)) return;
    for (const r of Array.isArray(mod.resources) ? mod.resources : []) {
      if (!isObj(r) || r.mode !== "managed") continue;
      const info: ConfigInfo = { refs: {}, configured: new Set(), otherRefs: new Set() };
      for (const [attr, expr] of Object.entries(isObj(r.expressions) ? r.expressions : {})) {
        info.configured.add(attr);
        const found = new Set<string>();
        collect(expr, (ref) => {
          const m = /^(aws_\w+\.[\w-]+(?:\[[^\]]+\])?)$/.exec(ref);
          if (m) found.add(prefix + (m[1] as string));
          else if (!RESOURCE_REF.test(ref)) info.otherRefs.add(attr);
        });
        if (found.size) info.refs[attr] = [...found].sort(cmp);
      }
      out.set(prefix + String(r.address), info);
    }
    for (const [name, call] of Object.entries(isObj(mod.module_calls) ? mod.module_calls : {})) {
      if (isObj(call)) walkModule(call.module, `${prefix}module.${name}.`);
    }
  };
  walkModule(isObj(plan.configuration) ? plan.configuration.root_module : undefined, "");
  return out;
}

function collect(v: unknown, add: (ref: string) => void): void {
  if (Array.isArray(v)) v.forEach((x) => collect(x, add));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === "references" && Array.isArray(x)) x.forEach((r) => typeof r === "string" && add(r));
      else collect(x, add);
    }
  }
}

export function parsePlan(input: unknown): { before: Snapshot; after: Snapshot } {
  if (!isObj(input) || typeof input.format_version !== "string" || !input.format_version.startsWith("1.")) {
    throw new PlanError("Not a Terraform plan: expected `terraform show -json` output with format_version 1.x.");
  }
  if (!Array.isArray(input.resource_changes)) throw new PlanError("Plan has no resource_changes.");
  const refs = configRefs(input);
  const before: Snapshot = { side: "before", resources: new Map(), byId: new Map(), instancesOf: new Map() };
  const after: Snapshot = { side: "after", resources: new Map(), byId: new Map(), instancesOf: new Map() };

  const changes = input.resource_changes.filter(isObj).toSorted((a, b) => cmp(String(a.address), String(b.address)));
  for (const rc of changes) {
    if (rc.mode !== "managed" || !isObj(rc.change)) continue;
    const address = String(rc.address);
    const type = String(rc.type);
    const actions = Array.isArray(rc.change.actions) ? rc.change.actions.map(String) : [];
    const base = stripKeys(address);
    // Module paths in references are relative to the module; configRefs already prefixed them.
    const info = refs.get(base) ?? { refs: {}, configured: new Set<string>(), otherRefs: new Set<string>() };
    const sides: [Snapshot, unknown, unknown][] = [
      [before, rc.change.before, false],
      [after, rc.change.after, rc.change.after_unknown ?? false],
    ];
    for (const [snap, values, unknown] of sides) {
      if (!isObj(values)) continue;
      snap.resources.set(address, { address, type, values, unknown, refs: info.refs, configured: info.configured, otherRefs: info.otherRefs, actions });
      if (typeof values.id === "string") snap.byId.set(values.id, address);
      const list = snap.instancesOf.get(base) ?? [];
      list.push(address);
      snap.instancesOf.set(base, list);
    }
  }
  return { before, after };
}

/** True when the value at `path` (or any parent) is unknown until apply. */
export function isUnknown(r: Resource, path: (string | number)[]): boolean {
  let u: unknown = r.unknown;
  for (const step of path) {
    if (u === true) return true;
    if (Array.isArray(u) && typeof step === "number") u = u[step];
    else if (isObj(u) && typeof step === "string") u = u[step];
    else return false;
  }
  return u === true;
}

/** True when any value at or below `path` is unknown until apply. */
export function hasUnknown(r: Resource, path: (string | number)[]): boolean {
  if (isUnknown(r, path)) return true;
  let u: unknown = r.unknown;
  for (const step of path) {
    if (Array.isArray(u) && typeof step === "number") u = u[step];
    else if (isObj(u) && typeof step === "string") u = u[step];
    else return false;
  }
  const any = (v: unknown): boolean => v === true || (Array.isArray(v) ? v.some(any) : isObj(v) ? Object.values(v).some(any) : false);
  return any(u);
}

export type Ref =
  | { kind: "resource"; address: string }
  | { kind: "external"; id: string }
  | { kind: "unknown"; reason: string };

const refOrder = (r: Ref): string => (r.kind === "resource" ? `0${r.address}` : r.kind === "external" ? `1${r.id}` : `2${r.reason}`);

/**
 * Resolves an attribute that points at other resources (`vpc_id`, `subnet_id`,
 * `vpc_security_group_ids`) to resource addresses in the same snapshot.
 * Known IDs are looked up by value. Unknown IDs use the configuration references,
 * but only when the expression uses resources alone and the count matches.
 * Results are sorted by address, so both sides of a plan list them in the same order.
 */
export function resolveRefs(snap: Snapshot, r: Resource, attr: string, targetType: string): Ref[] {
  const value = r.values[attr];
  const fail = (reason: string): Ref[] => [{ kind: "unknown", reason }];
  if (!isUnknown(r, [attr])) {
    if (value === null || value === undefined) return [];
    const items = Array.isArray(value) ? value : [value];
    const known: Ref[] = [];
    let unknownCount = 0;
    items.forEach((v, i) => {
      if (typeof v === "string" && !isUnknown(r, Array.isArray(value) ? [attr, i] : [attr])) {
        const address = snap.byId.get(v);
        known.push(address ? { kind: "resource", address } : { kind: "external", id: v });
      } else unknownCount++;
    });
    if (!unknownCount) return known.toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
    if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
    const knownAddresses = new Set(known.flatMap((k) => (k.kind === "resource" ? [stripKeys(k.address)] : [])));
    const rest = fromConfig(snap, r, attr, targetType).filter((x) => !(x.kind === "resource" && knownAddresses.has(stripKeys(x.address))));
    if (rest.length !== unknownCount || rest.some((x) => x.kind !== "resource")) return fail(`${r.address}: ${attr} has elements that are unknown until apply and cannot be matched to resources`);
    return [...known, ...rest].toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
  }
  if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
  return fromConfig(snap, r, attr, targetType).toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
}

const ADDRESS = /^(.*?)(aws_\w+\.[\w-]+(?:\[[^\]]+\])?)$/;

/**
 * Configuration references have the module path without instance keys. A reference
 * always points into the module instance of the resource that makes it, so this puts
 * the referring resource's module prefix (with keys) in front of the resource part.
 */
function localize(from: string, ref: string): string {
  const prefix = ADDRESS.exec(from)?.[1] ?? "";
  return prefix + (ADDRESS.exec(ref)?.[2] ?? ref);
}

/** Resolves an attribute through configuration references only. */
export function fromConfig(snap: Snapshot, r: Resource, attr: string, targetType: string): Ref[] {
  const targets = (r.refs[attr] ?? []).filter((a) => stripKeys(a).split(".").at(-2) === targetType);
  if (!targets.length) return [{ kind: "unknown", reason: `${r.address}: ${attr} is unknown until apply and has no resource reference` }];
  return targets.map((ref): Ref => {
    const t = localize(r.address, ref);
    if (snap.resources.has(t)) return { kind: "resource", address: t };
    const instances = [...snap.resources.keys()].filter((a) => a.startsWith(t) && stripKeys(a.slice(t.length)) === "");
    if (instances.length === 1) return { kind: "resource", address: instances[0] as string };
    return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${t}, which has ${instances.length} instances on the ${snap.side} side` };
  });
}

export function resolveRef(snap: Snapshot, r: Resource, attr: string, targetType: string): Ref {
  const refs = resolveRefs(snap, r, attr, targetType);
  if (refs.length === 1) return refs[0] as Ref;
  if (!refs.length) return { kind: "unknown", reason: `${r.address}: ${attr} is not set` };
  return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${refs.length} resources` };
}
