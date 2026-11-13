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
  /** Top-level attribute name to full references, including the attribute part (`aws_vpc.main.default_route_table_id`). */
  fullRefs: Record<string, string[]>;
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
  /**
   * Single-resource attributes that the configuration ties to one of several instances, in
   * unknown order (`module.net.subnets[0]` over `aws_subnet.a[*]`). Filled while the model is
   * built; key is `<resource address>\u0000<attribute>`.
   */
  ambiguous: Map<string, Ambiguity>;
}

export interface Ambiguity {
  resource: string;
  attr: string;
  /** Instance addresses the attribute may point at, sorted. */
  candidates: string[];
}

export class PlanError extends Error {}

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const stripKeys = (address: string) => address.replace(/\[[^\]]*\]/g, "");

interface ConfigInfo {
  refs: Record<string, string[]>;
  fullRefs: Record<string, string[]>;
  configured: Set<string>;
  otherRefs: Set<string>;
}

// Resource types of the clouds the engine reads: aws_, google_, azurerm_ (ADR 0011).
// A reference may start with module segments (`module.net[0].aws_subnet.a`) after a module output or input was followed.
const MODULE_PATH = "(?:module\\.[\\w-]+(?:\\[[^\\]]+\\])?\\.)*";
const RESOURCE_REF = new RegExp(`^${MODULE_PATH}(?:aws|google|azurerm)_\\w+\\.[\\w-]+(?:\\[[^\\]]+\\])?(?:\\.|$)`);
const RESOURCE_BASE = new RegExp(`^(${MODULE_PATH}(?:aws|google|azurerm)_\\w+\\.[\\w-]+(?:\\[[^\\]]+\\])?)$`);
// `module.net.subnet_id` and `module.net[0].subnet_id[1]`: the call, its key, and the output name.
const MODULE_OUTPUT = /^(module\.[\w-]+(?:\[[^\]]+\])?)\.([\w-]+)(?![\w-])/;
const BARE_MODULE = /^module\.[\w-]+(?:\[[^\]]+\])?$/;
const VARIABLE = /^var\.([\w-]+)(?![\w-])/;
const MAX_MODULE_DEPTH = 16;
/** Most references one expression may follow, so a hostile plan cannot make the work grow without bound. */
const MAX_FOLLOW_STEPS = 10_000;

/** A module of the configuration, with the way the root module reaches it. */
interface Frame {
  mod: Obj;
  /** Module path from the root, with the instance keys as written (`module.net[0].`). Empty for the root. */
  prefix: string;
  /** The calling module and the call's `expressions` (its inputs). Absent for the root. */
  parent?: { frame: Frame; inputs: Obj };
}

/**
 * Follows module outputs and module inputs to the resources they come from (issue #140).
 * The plan hides the value of a module output or input until apply, but the configuration
 * keeps the references of its expression. `module.net.subnet_id` becomes the references
 * of that output inside `net`. `var.vpc_id` inside a module becomes the references of
 * the matching input in the call. The result has absolute references from the root module:
 * a resource reference carries its module path (`module.net[0].aws_subnet.a`). Anything
 * else (`local.y`, `data.z`, a variable that the call does not set) stays as it is, so the
 * caller treats the attribute as undecided; locals are not in the plan at all.
 * A reference that cannot be followed stays as it is.
 * Terraform also lists the bare module (`module.net`) beside every output reference. That
 * entry is dropped when a more specific reference exists.
 */
function follow(frame: Frame, refs: string[], budget = { steps: MAX_FOLLOW_STEPS }, chain = new Set<string>(), depth = 0): string[] {
  const out: string[] = [];
  const unique = [...new Set(refs)];
  for (const ref of unique) {
    if (BARE_MODULE.test(ref) && unique.some((o) => o.startsWith(`${ref}.`) || (!ref.includes("[") && o.startsWith(`${ref}[`)))) continue;
    // Followed references that lead nowhere (a constant, a loop, a spent budget) stay as they are: the attribute is undecided.
    const keep = () => out.push(/^(?:aws|google|azurerm)_/.test(ref) ? frame.prefix + ref : ref);
    const here = `${frame.prefix}|${ref}`;
    const output = MODULE_OUTPUT.exec(ref);
    const variable = VARIABLE.exec(ref);
    const call = output ? (isObj(frame.mod.module_calls) ? frame.mod.module_calls : {})[(output[1] as string).replace(/^module\.|\[.*$/g, "")] : undefined;
    const child = isObj(call) && isObj(call.module) ? call.module : undefined;
    const expr = output && child && isObj(child.outputs) ? child.outputs[output[2] as string] : undefined;
    const inner = isObj(expr) && isObj(expr.expression) && Array.isArray(expr.expression.references) ? expr.expression.references.filter((x): x is string => typeof x === "string") : undefined;
    const input = variable && frame.parent ? frame.parent.inputs[variable[1] as string] : undefined;
    const target: { frame: Frame; refs: string[] } | undefined =
      child && isObj(call) && inner ? { frame: { mod: child, prefix: `${frame.prefix}${(output as RegExpExecArray)[1] as string}.`, parent: { frame, inputs: isObj(call.expressions) ? call.expressions : {} } }, refs: inner }
      : variable && frame.parent && isObj(input) ? { frame: frame.parent.frame, refs: gather(input) }
      : undefined;
    if (!target || depth >= MAX_MODULE_DEPTH || budget.steps-- <= 0 || chain.has(here)) {
      keep();
      continue;
    }
    chain.add(here);
    const followed = follow(target.frame, target.refs, budget, chain, depth + 1);
    chain.delete(here);
    if (followed.length) out.push(...followed);
    else keep();
  }
  return out;
}

const gather = (expr: unknown): string[] => {
  const found: string[] = [];
  collect(expr, (r) => found.push(r));
  return found;
};

/** Collects resource references per top-level attribute from the configuration section. */
function configRefs(plan: Obj): Map<string, ConfigInfo> {
  const out = new Map<string, ConfigInfo>();
  const walkModule = (frame: Frame, prefix: string) => {
    const mod = frame.mod;
    for (const r of Array.isArray(mod.resources) ? mod.resources : []) {
      if (!isObj(r) || r.mode !== "managed") continue;
      const info: ConfigInfo = { refs: {}, fullRefs: {}, configured: new Set(), otherRefs: new Set() };
      for (const [attr, expr] of Object.entries(isObj(r.expressions) ? r.expressions : {})) {
        info.configured.add(attr);
        const found = new Set<string>();
        const full = new Set<string>();
        const all: string[] = [];
        collect(expr, (ref) => all.push(ref));
        for (const ref of follow(frame, all)) {
          const m = RESOURCE_BASE.exec(ref);
          if (m) found.add(m[1] as string);
          if (RESOURCE_REF.test(ref)) full.add(ref);
          else info.otherRefs.add(attr);
        }
        if (found.size) info.refs[attr] = [...found].sort(cmp);
        if (full.size) info.fullRefs[attr] = [...full].sort(cmp);
      }
      out.set(prefix + String(r.address), info);
    }
    for (const [name, call] of Object.entries(isObj(mod.module_calls) ? mod.module_calls : {})) {
      if (isObj(call) && isObj(call.module)) walkModule({ mod: call.module, prefix: `${frame.prefix}module.${name}.`, parent: { frame, inputs: isObj(call.expressions) ? call.expressions : {} } }, `${prefix}module.${name}.`);
    }
  };
  const root = isObj(plan.configuration) ? plan.configuration.root_module : undefined;
  if (isObj(root)) walkModule({ mod: root, prefix: "" }, "");
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

/**
 * `pins` fixes an ambiguous attribute to one instance (key `<resource address>\u0000<attribute>`
 * to an instance address). The engine tries each candidate this way.
 */
export function parsePlan(input: unknown, pins: ReadonlyMap<string, string> = new Map()): { before: Snapshot; after: Snapshot } {
  if (!isObj(input) || typeof input.format_version !== "string" || !input.format_version.startsWith("1.")) {
    throw new PlanError("Not a Terraform plan: expected `terraform show -json` output with format_version 1.x.");
  }
  if (!Array.isArray(input.resource_changes)) throw new PlanError("Plan has no resource_changes.");
  const refs = configRefs(input);
  const before: Snapshot = { side: "before", resources: new Map(), byId: new Map(), instancesOf: new Map(), ambiguous: new Map() };
  const after: Snapshot = { side: "after", resources: new Map(), byId: new Map(), instancesOf: new Map(), ambiguous: new Map() };

  const changes = input.resource_changes.filter(isObj).toSorted((a, b) => cmp(String(a.address), String(b.address)));
  for (const rc of changes) {
    if (rc.mode !== "managed" || !isObj(rc.change)) continue;
    const address = String(rc.address);
    const type = String(rc.type);
    const actions = Array.isArray(rc.change.actions) ? rc.change.actions.map(String) : [];
    const base = stripKeys(address);
    // Module paths in references are relative to the module; configRefs already prefixed them.
    const info = refs.get(base) ?? { refs: {}, fullRefs: {}, configured: new Set<string>(), otherRefs: new Set<string>() };
    const sides: [Snapshot, unknown, unknown][] = [
      [before, rc.change.before, false],
      [after, rc.change.after, rc.change.after_unknown ?? false],
    ];
    for (const [snap, values, unknown] of sides) {
      if (!isObj(values)) continue;
      let pinned = info.refs;
      for (const [key, instance] of pins) {
        const [target, attr] = key.split("\u0000") as [string, string];
        if (target === address) pinned = { ...pinned, [attr]: [instance] };
      }
      snap.resources.set(address, { address, type, values, unknown, refs: pinned, fullRefs: info.fullRefs, configured: info.configured, otherRefs: info.otherRefs, actions });
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
  | { kind: "unknown"; reason: string; /** Instances the reference may point at, when it names several instances of one resource. */ candidates?: string[] };

const refOrder = (r: Ref): string => (r.kind === "resource" ? `0${r.address}` : r.kind === "external" ? `1${r.id}` : `2${r.reason}`);

/**
 * Resolves an attribute that points at other resources (`vpc_id`, `subnet_id`,
 * `vpc_security_group_ids`) to resource addresses in the same snapshot.
 * Known IDs are looked up by value. Unknown IDs use the configuration references,
 * but only when the expression uses resources alone and the count matches.
 * Results are sorted by address, so both sides of a plan list them in the same order.
 */
export function resolveRefs(snap: Snapshot, r: Resource, attr: string, targetType: string | string[]): Ref[] {
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

// The resource part may end with an attribute (`aws_vpc.main.default_route_table_id`).
// The prefix is whole module segments, so a module named like a resource type (`module.google_net.`) stays in it.
const ADDRESS = /^((?:module\.[\w-]+(?:\[[^\]]+\])?\.)*)((?:aws|google|azurerm)_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.\w+)?)$/;

/**
 * Configuration references carry the module path without instance keys. A reference
 * always points into the module instance of the resource that makes it, into a module
 * below it, or into a module above it (a followed module output or input). This puts the
 * referring resource's module instances (with keys) in front of the shared part of the
 * path. Keys that the reference itself carries (`module.net[0].`) stay.
 */
export function localize(from: string, ref: string): string {
  const own = ADDRESS.exec(from)?.[1] ?? "";
  const m = ADDRESS.exec(ref);
  if (!m) return own + ref;
  const segments = (path: string) => path.match(/module\.[\w-]+(?:\[[^\]]+\])?\./g) ?? [];
  const a = segments(own);
  const b = segments(m[1] as string);
  let common = 0;
  // A segment is shared when the names match and the reference either has no key (it adopts the key of the
  // referring resource) or writes the same key. `module.a[0]` is not `module.a[1]`.
  const shared = (x: string, y: string) => stripKeys(x) === stripKeys(y) && (x === y || y === stripKeys(y));
  while (common < a.length && common < b.length && shared(a[common] as string, b[common] as string)) common++;
  return a.slice(0, common).join("") + b.slice(common).join("") + (m[2] as string);
}

/** The instance address a localized reference points at, if exactly one exists. */
export function instanceOf(snap: Snapshot, t: string): string | undefined {
  if (snap.resources.has(t)) return t;
  const instances = [...snap.resources.keys()].filter((a) => a.startsWith(t) && stripKeys(a.slice(t.length)) === "");
  return instances.length === 1 ? instances[0] : undefined;
}

/** Resolves an attribute through configuration references only. */
export function fromConfig(snap: Snapshot, r: Resource, attr: string, targetType: string | string[]): Ref[] {
  const types = Array.isArray(targetType) ? targetType : [targetType];
  const targets = (r.refs[attr] ?? []).filter((a) => types.includes(stripKeys(a).split(".").at(-2) ?? ""));
  if (!targets.length) return [{ kind: "unknown", reason: `${r.address}: ${attr} is unknown until apply and has no resource reference` }];
  const refs = targets.map((ref): Ref => {
    const t = localize(r.address, ref);
    if (snap.resources.has(t)) return { kind: "resource", address: t };
    const instances = [...snap.resources.keys()].filter((a) => a.startsWith(t) && stripKeys(a.slice(t.length)) === "");
    if (instances.length === 1) return { kind: "resource", address: instances[0] as string };
    return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${t}, which has ${instances.length} instances on the ${snap.side} side`, ...(instances.length > 1 ? { candidates: instances.toSorted(cmp) } : {}) };
  });
  // `aws_subnet.a[0]` and its parent `aws_subnet.a` can name the same instance.
  const seen = new Set<string>();
  return refs.filter((x) => {
    const key = JSON.stringify(x);
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

export function resolveRef(snap: Snapshot, r: Resource, attr: string, targetType: string | string[]): Ref {
  const refs = resolveRefs(snap, r, attr, targetType);
  if (refs.length === 1 && refs[0]?.kind === "resource") return refs[0];
  // The attribute holds one value, so it is one of the named resources. Record them: the
  // engine can try each one and decide when all agree.
  const named = refs.flatMap((x) => (x.kind === "resource" ? [x.address] : x.kind === "unknown" && x.candidates ? x.candidates : []));
  if (refs.length && named.length > 1 && refs.every((x) => x.kind === "resource" || (x.kind === "unknown" && x.candidates))) {
    snap.ambiguous.set(`${r.address}\u0000${attr}`, { resource: r.address, attr, candidates: [...new Set(named)].toSorted(cmp) });
  }
  if (refs.length === 1) return refs[0] as Ref;
  if (!refs.length) return { kind: "unknown", reason: `${r.address}: ${attr} is not set` };
  return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${refs.length} resources` };
}
