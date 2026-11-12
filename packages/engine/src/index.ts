import { evaluate, exposedPorts, portCuts, segment } from "./evaluate.js";
import { evaluate6, exposedPorts6 } from "./evaluate6.js";
import { evaluateInternal, internalCuts, referencedPorts } from "./internal.js";
import { evaluateGcp, gcpCuts, gcpExposed } from "./gcp/evaluate.js";
import { GcpModel, type GcpVm } from "./gcp/model.js";
import { azureCuts, azureExposed, evaluateAzure } from "./azure/evaluate.js";
import { AzureModel, type AzVm } from "./azure/model.js";
import { formatPorts, union, type IntervalSet, type Range } from "./intervals.js";
import { ModelBuilder, type Endpoint } from "./model.js";
import { cmp, parsePlan, PlanError, type Snapshot } from "./plan.js";
import { RESULT_FORMAT, type Change, type Note, type Outcome, type Path, type Protocol, type Result } from "./types.js";

export { PlanError } from "./plan.js";

/**
 * Limits that keep a crafted plan from using all memory or time. A plan hits them only when
 * it is far beyond real use (the paths inside a VPC grow with the square of the endpoints
 * that share a security group: 1,000 of them make 1 million paths and 2 GB), and the result
 * is a PlanError, never "safe". The CLI and the Action refuse a plan file over
 * MAX_PLAN_CHARS before parsing it.
 */
export const MAX_PATHS = 500_000;
export const MAX_SEGMENTS = 1_000_000;
export const MAX_PAIRS = 25_000_000;
export const MAX_PLAN_CHARS = 256 * 1024 * 1024;

/** Work done so far in one analysis, and the limits (tests lower them). */
interface Budget {
  paths: number;
  segments: number;
  pairs: number;
  maxPaths: number;
  maxSegments: number;
  maxPairs: number;
}

/** True for the error a recursive walk throws when the plan's JSON is nested too deeply. */
export const isStackOverflow = (e: unknown): boolean => e instanceof RangeError && /call stack/i.test(e.message);
export * from "./types.js";

/** Version of the engine package. */
export const ENGINE_VERSION = "0.3.2";

const PROTOCOLS: Protocol[] = ["tcp", "udp"];
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Endpoint and network types the engine models. Other aws_* types in a plan get a note.
const MODELED = new Set([
  "aws_vpc",
  "aws_subnet",
  "aws_internet_gateway",
  "aws_internet_gateway_attachment",
  "aws_route_table",
  "aws_route",
  "aws_route_table_association",
  "aws_main_route_table_association",
  "aws_default_route_table",
  "aws_security_group",
  "aws_security_group_rule",
  "aws_vpc_security_group_ingress_rule",
  "aws_vpc_security_group_egress_rule",
  "aws_default_security_group",
  "aws_network_acl",
  "aws_network_acl_rule",
  "aws_network_acl_association",
  "aws_default_network_acl",
  "aws_eip",
  "aws_eip_association",
  "aws_ec2_transit_gateway",
  "aws_ec2_transit_gateway_vpc_attachment",
  "aws_ec2_transit_gateway_route_table",
  "aws_ec2_transit_gateway_route",
  "aws_ec2_transit_gateway_route_table_association",
  "aws_ec2_transit_gateway_route_table_propagation",
  "aws_instance",
  "aws_db_instance",
  "aws_db_subnet_group",
  "aws_lb",
  "aws_lb_listener",
  "aws_nat_gateway",
  "aws_vpc_ipv4_cidr_block_association",
  "aws_network_interface",
  "aws_network_interface_sg_attachment",
  "aws_vpc_peering_connection",
  "aws_vpc_peering_connection_accepter",
  "aws_vpc_endpoint",
  "aws_vpc_endpoint_route_table_association",
  "aws_ec2_managed_prefix_list",
  "aws_ec2_managed_prefix_list_entry",
  "aws_rds_cluster",
  "aws_rds_cluster_instance",
  "aws_ecs_service",
  "aws_elb",
]);
const NETWORK_TYPE = /^aws_(vpc\w*|vpn_gateway\w*|subnet|route\w*|internet_gateway\w*|nat_gateway|egress_only_internet_gateway|network_acl\w*|default_\w+|security_group\w*|vpc_security_group_\w+|eip\w*|network_interface\w*|lb|alb|elb|db_instance|rds_cluster\w*|ecs_service|ec2_transit_gateway\w*|vpc_peering_connection\w*|vpc_endpoint\w*|instance)$/;

function changeOf(before: Outcome, after: Outcome): Change {
  const b = before.verdict;
  const a = after.verdict;
  // An unknown side cannot prove that nothing changed, even if both sides look the same.
  if (a === "unknown" || b === "unknown") return "unknown";
  if (JSON.stringify(before) === JSON.stringify(after)) return "unchanged";
  if (a === "allowed" && (b === "blocked" || b === "absent")) return "added";
  if (b === "allowed" && (a === "blocked" || a === "absent")) return "removed";
  if (a === "allowed" && b === "allowed") return "changed";
  return "unchanged";
}

/** Endpoints by address; RDS and load balancers have one entry per possible subnet. */
function endpointsOf(snap: Snapshot): Map<string, Endpoint[]> {
  const out = new Map<string, Endpoint[]>();
  for (const e of new ModelBuilder(snap).endpoints()) out.set(e.address, [...(out.get(e.address) ?? []), e]);
  return out;
}

/** One outcome for all placements of an endpoint; placements that disagree give unknown. */
function evaluateAll(list: Endpoint[] | undefined, p: Protocol, ports: Range): Outcome {
  if (!list?.length) return evaluate(undefined, p, ports);
  return combine(list.map((e) => evaluate(e, p, ports)), list.map((e) => (e.subnet.ok ? e.subnet.value : "unknown subnet")), list[0]?.placement);
}

/** IPv6 from the internet for all placements of an endpoint. */
function evaluateAll6(list: Endpoint[] | undefined, p: Protocol, ports: Range): Outcome {
  if (!list?.length) return evaluate6(undefined, p, ports);
  return combine(list.map((e) => evaluate6(e, p, ports)), list.map((e) => (e.subnet.ok ? e.subnet.value : "unknown subnet")), list[0]?.placement);
}

/** A path inside the VPC for every pair of placements of the source and the target. */
function evaluatePairs(from: Endpoint[] | undefined, to: Endpoint[] | undefined, p: Protocol, ports: Range): Outcome {
  if (!from?.length || !to?.length) return evaluateInternal(undefined, undefined, p, ports);
  const pairs = from.flatMap((a) => to.map((t) => [a, t] as const));
  const where = (e: Endpoint) => (e.subnet.ok ? e.subnet.value : "unknown subnet");
  const placement = [from[0]?.placement, to[0]?.placement].filter(Boolean).join("; ") || undefined;
  return combine(pairs.map(([a, t]) => evaluateInternal(a, t, p, ports)), pairs.map(([a, t]) => `${where(a)} to ${where(t)}`), placement);
}

function combine(outcomes: Outcome[], labels: string[], placement: string | undefined): Outcome {
  const first = outcomes[0] as Outcome;
  // Placements that agree on the verdict and the sources give the same answer, even when
  // their explanations name different route tables or NACLs. The first placement explains it.
  const same = (o: Outcome) => o.verdict === first.verdict && JSON.stringify(o.sources) === JSON.stringify(first.sources) && o.reason === first.reason;
  if (outcomes.every(same) || (first.verdict === "blocked" && outcomes.every((o) => o.verdict === "blocked"))) return first;
  const detail = labels.map((l, i) => `${l}: ${outcomes[i]?.verdict ?? "unknown"}`).join("; ");
  return { verdict: "unknown", sources: [], hops: [], reason: `${placement ?? "the result differs between placements"} (${detail})` };
}

/**
 * Resources on an endpoint's path that the plan replaces delete-first. Terraform replaces
 * with ["delete", "create"] unless create_before_destroy is set (["create", "delete"]).
 * https://developer.hashicorp.com/terraform/internals/json-format
 * https://developer.hashicorp.com/terraform/language/block/resource
 */
function deleteFirst(list: Endpoint[] | undefined, snap: Snapshot, internet = true): string[] {
  const out = new Set<string>();
  for (const e of list ?? []) {
    // The objects on the path and every resource that shaped them (rule resources,
    // associations, attachments, Elastic IPs, listeners, DB subnet groups).
    const onPath = [e.address, ...(e.via ?? [])];
    if (e.subnet.ok) onPath.push(e.subnet.value);
    if (e.vpc.ok) {
      onPath.push(e.vpc.value.address, ...(e.vpc.value.via ?? []));
      if (internet && e.vpc.value.igw.ok && e.vpc.value.igw.value) onPath.push(e.vpc.value.igw.value);
    }
    if (e.securityGroups.ok) for (const g of e.securityGroups.value) onPath.push(g.address, ...(g.via ?? []));
    if (e.nacl.ok) onPath.push(e.nacl.value.resource, ...(e.nacl.value.via ?? []));
    if (e.routeTable.ok) onPath.push(e.routeTable.value.resource, ...(e.routeTable.value.via ?? []));
    for (const a of onPath) {
      const r = snap.resources.get(a);
      // Managed defaults (aws_default_*) adopt objects that "can be managed but not
      // destroyed", so replacing them never deletes the real object.
      // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/default_route_table
      if (!r || r.type.startsWith("aws_default_")) continue;
      if (r.actions[0] === "delete" && r.actions.includes("create")) out.add(a);
    }
  }
  return [...out].toSorted(cmp);
}

const unionOf = (list: Endpoint[] | undefined, f: (e: Endpoint) => IntervalSet): IntervalSet => (list ?? []).reduce<IntervalSet>((acc, e) => union(acc, f(e)), []);

function notesFor(before: Snapshot, after: Snapshot): Note[] {
  const seen = new Map<string, Note>();
  for (const snap of [before, after]) {
    for (const r of snap.resources.values()) {
      if (seen.has(r.address)) continue;
      // An ECS service without network_configuration uses bridge or host networking.
      if (r.type === "aws_ecs_service" && !arr(r.values.network_configuration).length && !r.configured.has("network_configuration")) {
        seen.set(r.address, { resource: r.address, message: "aws_ecs_service without awsvpc networking (bridge or host mode) shares the container instance's network interface, which is not modeled yet; paths to its tasks are not reported" });
        continue;
      }
      if (r.type === "aws_vpc_endpoint" && r.values.vpc_endpoint_type === "GatewayLoadBalancer") {
        seen.set(r.address, { resource: r.address, message: "Gateway Load Balancer endpoints are not modeled yet; routes to them are reported as unknown" });
        continue;
      }
      if (MODELED.has(r.type) || !NETWORK_TYPE.test(r.type)) continue;
      seen.set(r.address, { resource: r.address, message: `${r.type} is not modeled yet; paths it can change are reported as unknown or not reported` });
    }
  }
  return [...seen.values()].toSorted((a, b) => cmp(a.resource, b.resource));
}

/**
 * Internet-to-resource reachability before and after a Terraform plan.
 * `plan` is the parsed output of `terraform show -json <planfile>`.
 */
export function analyze(plan: unknown, limits: { maxPaths?: number; maxSegments?: number; maxPairs?: number } = {}): Result {
  try {
    return analyzePlan(plan, { paths: 0, segments: 0, pairs: 0, maxPaths: limits.maxPaths ?? MAX_PATHS, maxSegments: limits.maxSegments ?? MAX_SEGMENTS, maxPairs: limits.maxPairs ?? MAX_PAIRS });
  } catch (e) {
    // Deeply nested JSON overflows the stack in a recursive walk: still a plan we cannot read.
    // Any other RangeError is a defect in the engine and must stay visible, not get a wrong cause.
    if (isStackOverflow(e)) throw new PlanError("The plan is nested too deeply to analyze.");
    throw e;
  }
}

function analyzePlan(plan: unknown, budget: Budget): Result {
  const pathsOf = (spec: PathSpec): Path[] => {
    const out = pathsWithin(spec, budget);
    budget.paths += out.length;
    if (budget.paths > budget.maxPaths) throw new PlanError(`The plan has more than ${budget.maxPaths.toLocaleString("en-US")} paths to report. Split the plan, or narrow the security group rules that connect so many resources.`);
    return out;
  };
  const { before, after } = parsePlan(plan);
  const epBefore = endpointsOf(before);
  const epAfter = endpointsOf(after);
  const addresses = [...new Set([...epBefore.keys(), ...epAfter.keys()])].toSorted(cmp);
  const paths: Path[] = [];

  // Internet to each endpoint.
  for (const address of addresses) {
    const b = epBefore.get(address);
    const a = epAfter.get(address);
    paths.push(
      ...pathsOf({
        id: `internet->${address}`,
        from: "internet",
        to: address,
        toType: (a ?? b)?.[0]?.type ?? "",
        candidates: (p) => union(unionOf(b, (e) => exposedPorts(e, p)), unionOf(a, (e) => exposedPorts(e, p))),
        cuts: [...(b ?? []).flatMap(portCuts), ...(a ?? []).flatMap(portCuts)],
        before: (p, seg) => evaluateAll(b, p, seg),
        after: (p, seg) => evaluateAll(a, p, seg),
        risk: () => deleteFirst(a, after),
      }),
    );
  }

  // IPv6 from the internet to each endpoint with an IPv6 address (docs/semantics/ipv6.md).
  for (const address of addresses) {
    const b = epBefore.get(address);
    const a = epAfter.get(address);
    const ports6 = (list: Endpoint[] | undefined, p: Protocol): IntervalSet => (list ?? []).reduce<IntervalSet>((acc, e) => union(acc, exposedPorts6(e, p).map(({ lo, hi }) => [lo, hi] as const)), []);
    paths.push(
      ...pathsOf({
        id: `internet6->${address}`,
        from: "internet",
        family: "ipv6",
        to: address,
        toType: (a ?? b)?.[0]?.type ?? "",
        candidates: (p) => union(ports6(b, p), ports6(a, p)),
        cuts: [...(b ?? []).flatMap(portCuts), ...(a ?? []).flatMap(portCuts)],
        before: (p, seg) => evaluateAll6(b, p, seg),
        after: (p, seg) => evaluateAll6(a, p, seg),
        risk: () => deleteFirst(a, after),
      }),
    );
  }

  // Inside the VPC: from an endpoint to another whose security group references one of
  // its groups, on either side of the plan (docs/semantics/internal-paths.md).
  for (const from of addresses) {
    for (const to of addresses) {
      if (from === to) continue;
      // The loop is quadratic in the endpoints, so it has its own budget (about 0.7 µs a pair).
      if (++budget.pairs > budget.maxPairs) throw new PlanError(`The plan has more than ${budget.maxPairs.toLocaleString("en-US")} pairs of resources to check. Split the plan.`);
      const fb = epBefore.get(from);
      const fa = epAfter.get(from);
      const tb = epBefore.get(to);
      const ta = epAfter.get(to);
      const refs = (p: Protocol) => union(pairPorts(fb, tb, p), pairPorts(fa, ta, p));
      if (PROTOCOLS.every((p) => !refs(p).length)) continue;
      paths.push(
        ...pathsOf({
          id: `${from}->${to}`,
          from,
          fromType: (fa ?? fb)?.[0]?.type ?? "",
          to,
          toType: (ta ?? tb)?.[0]?.type ?? "",
          candidates: refs,
          cuts: [...fb ?? [], ...fa ?? [], ...tb ?? [], ...ta ?? []].flatMap(internalCuts),
          before: (p, seg) => evaluatePairs(fb, tb, p, seg),
          after: (p, seg) => evaluatePairs(fa, ta, p, seg),
          risk: () => [...new Set([...deleteFirst(fa, after, false), ...deleteFirst(ta, after, false)])].toSorted(cmp),
        }),
      );
    }
  }

  // Google Cloud: internet to each Compute Engine VM (docs/semantics/gcp.md).
  const vmsOf = (snap: Snapshot) => new Map(new GcpModel(snap).vms().map((v) => [v.address, v]));
  const vmBefore = vmsOf(before);
  const vmAfter = vmsOf(after);
  for (const address of [...new Set([...vmBefore.keys(), ...vmAfter.keys()])].toSorted(cmp)) {
    const b: GcpVm | undefined = vmBefore.get(address);
    const a: GcpVm | undefined = vmAfter.get(address);
    paths.push(
      ...pathsOf({
        id: `internet->${address}`,
        from: "internet",
        provider: "gcp",
        to: address,
        toType: (a ?? b)?.type ?? "",
        candidates: (p) => union(gcpExposed(b, p), gcpExposed(a, p)),
        cuts: [...gcpCuts(b), ...gcpCuts(a)],
        before: (p, seg) => evaluateGcp(b, p, seg),
        after: (p, seg) => evaluateGcp(a, p, seg),
        risk: () => [],
      }),
    );
  }

  // Azure: internet to each virtual machine (docs/semantics/azure.md).
  const azOf = (snap: Snapshot) => new Map(new AzureModel(snap).vms().map((v) => [v.address, v]));
  const azBefore = azOf(before);
  const azAfter = azOf(after);
  for (const address of [...new Set([...azBefore.keys(), ...azAfter.keys()])].toSorted(cmp)) {
    const b: AzVm | undefined = azBefore.get(address);
    const a: AzVm | undefined = azAfter.get(address);
    paths.push(
      ...pathsOf({
        id: `internet->${address}`,
        from: "internet",
        provider: "azure",
        to: address,
        toType: (a ?? b)?.type ?? "",
        candidates: (p) => union(azureExposed(b, p), azureExposed(a, p)),
        cuts: [...azureCuts(b), ...azureCuts(a)],
        before: (p, seg) => evaluateAzure(b, p, seg),
        after: (p, seg) => evaluateAzure(a, p, seg),
        risk: () => [],
      }),
    );
  }

  const summary: Record<Change, number> = { added: 0, removed: 0, changed: 0, unchanged: 0, unknown: 0 };
  for (const path of paths) summary[path.change]++;
  const notes = [...notesFor(before, after), ...unresolvedNotes([...epBefore.values(), ...epAfter.values()].flat())];
  // One note per resource; messages for the same resource are joined in a stable order.
  const merged = new Map<string, string[]>();
  for (const n of notes) merged.set(n.resource, [...new Set([...(merged.get(n.resource) ?? []), n.message])]);
  const unique = [...merged.entries()].map(([resource, messages]) => ({ resource, message: messages.toSorted(cmp).join("; ") })).toSorted((x, y) => cmp(x.resource, y.resource));
  return { format: RESULT_FORMAT, summary, paths, notes: unique };
}

/** Ports any placement of `t` opens to a group of any placement of `a`. */
function pairPorts(a: Endpoint[] | undefined, t: Endpoint[] | undefined, p: Protocol): IntervalSet {
  let out: IntervalSet = [];
  for (const x of a ?? []) for (const y of t ?? []) out = union(out, referencedPorts(x, y, p));
  return out;
}

/**
 * What the internal-path check cannot see, so the result says which paths it does not
 * list (ADR 0003): rules whose referenced group is unknown until apply, and endpoints
 * whose groups or inbound rules are unknown (no reference can be found for them).
 */
function unresolvedNotes(list: Endpoint[]): Note[] {
  const byKey = new Map<string, { resource: string; why: string; targets: Set<string> }>();
  const add = (resource: string, why: string, target: string) => {
    const k = `${resource}\u0000${why}`;
    const n = byKey.get(k) ?? { resource, why, targets: new Set<string>() };
    n.targets.add(target);
    byKey.set(k, n);
  };
  for (const e of list) {
    if (!e.securityGroups.ok) {
      add(e.address, `its security groups are unknown (${e.securityGroups.reason})`, e.address);
      continue;
    }
    for (const g of e.securityGroups.value) {
      if (!g.ingress.ok) add(g.address, `its inbound rules are unknown (${g.ingress.reason})`, e.address);
      else for (const r of g.ingress.value) if (r.unresolved) add(r.resource, r.unresolved, e.address);
    }
  }
  return [...byKey.values()].map((n) => ({ resource: n.resource, message: `${n.why}; paths inside the VPC to ${[...n.targets].toSorted(cmp).join(", ")} from security groups that cannot be resolved are not checked` }));
}

interface PathSpec {
  id: string;
  from: string;
  family?: "ipv6";
  provider?: "gcp" | "azure";
  fromType?: string;
  to: string;
  toType: string;
  candidates: (p: Protocol) => IntervalSet;
  cuts: IntervalSet[];
  before: (p: Protocol, seg: Range) => Outcome;
  after: (p: Protocol, seg: Range) => Outcome;
  risk: () => string[];
}

/** Paths for one source and target: per protocol, port ranges with the same outcome merged. */
function pathsWithin(spec: PathSpec, budget: Budget): Path[] {
  const out: Path[] = [];
  for (const p of PROTOCOLS) {
    let run: { ports: Range; before: Outcome; after: Outcome } | undefined;
    const flush = () => {
      if (!run) return;
      const ports = formatPorts([run.ports]);
      const risk = run.before.verdict === "allowed" && run.after.verdict === "allowed" ? spec.risk() : [];
      out.push({ id: `${spec.id}:${p}:${ports}`, from: spec.from, ...(spec.fromType !== undefined ? { fromType: spec.fromType } : {}), ...(spec.family ? { family: spec.family } : {}), ...(spec.provider ? { provider: spec.provider } : {}), to: spec.to, toType: spec.toType, protocol: p, ports, change: changeOf(run.before, run.after), before: run.before, after: run.after, ...(risk.length ? { outageRisk: risk } : {}) });
      run = undefined;
    };
    for (const seg of segment(spec.candidates(p), spec.cuts)) {
      if (++budget.segments > budget.maxSegments) throw new PlanError(`The plan needs more than ${budget.maxSegments.toLocaleString("en-US")} port checks. A security group or network ACL has far more rules than AWS allows; reduce them.`);
      const ob = spec.before(p, seg);
      const oa = spec.after(p, seg);
      // Merge neighboring port ranges with the same outcome on both sides.
      if (run && run.ports[1] + 1 === seg[0] && JSON.stringify([run.before, run.after]) === JSON.stringify([ob, oa])) run.ports = [run.ports[0], seg[1]];
      else {
        flush();
        run = { ports: seg, before: ob, after: oa };
      }
    }
    flush();
  }
  return out;
}

/** The result as stable JSON text (same input, same bytes). */
export function toJson(result: Result): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
