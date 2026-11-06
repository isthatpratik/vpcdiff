import { evaluate, exposedPorts, portCuts, segment } from "./evaluate.js";
import { formatPorts, union, type IntervalSet, type Range } from "./intervals.js";
import { ModelBuilder, type Endpoint } from "./model.js";
import { cmp, parsePlan, type Snapshot } from "./plan.js";
import { RESULT_FORMAT, type Change, type Note, type Outcome, type Path, type Protocol, type Result } from "./types.js";

export { PlanError } from "./plan.js";
export * from "./types.js";

/** Version of the engine package. */
export const ENGINE_VERSION = "0.0.0";

const PROTOCOLS: Protocol[] = ["tcp", "udp"];

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
  "aws_instance",
  "aws_db_instance",
  "aws_db_subnet_group",
  "aws_lb",
  "aws_lb_listener",
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
  const outcomes = list.map((e) => evaluate(e, p, ports));
  const first = outcomes[0] as Outcome;
  // Placements that agree on the verdict and the sources give the same answer, even when
  // their explanations name different route tables or NACLs. The first placement explains it.
  const same = (o: Outcome) => o.verdict === first.verdict && JSON.stringify(o.sources) === JSON.stringify(first.sources) && o.reason === first.reason;
  if (outcomes.every(same) || (first.verdict === "blocked" && outcomes.every((o) => o.verdict === "blocked"))) return first;
  const detail = list.map((e, i) => `${e.subnet.ok ? e.subnet.value : "unknown subnet"}: ${outcomes[i]?.verdict ?? "unknown"}`).join("; ");
  return { verdict: "unknown", sources: [], hops: [], reason: `${list[0]?.placement ?? "the result differs between placements"} (${detail})` };
}

/**
 * Resources on an endpoint's path that the plan replaces delete-first. Terraform replaces
 * with ["delete", "create"] unless create_before_destroy is set (["create", "delete"]).
 * https://developer.hashicorp.com/terraform/internals/json-format
 * https://developer.hashicorp.com/terraform/language/block/resource
 */
function deleteFirst(list: Endpoint[] | undefined, snap: Snapshot): string[] {
  const out = new Set<string>();
  for (const e of list ?? []) {
    // The objects on the path and every resource that shaped them (rule resources,
    // associations, attachments, Elastic IPs, listeners, DB subnet groups).
    const onPath = [e.address, ...(e.via ?? [])];
    if (e.subnet.ok) onPath.push(e.subnet.value);
    if (e.vpc.ok) {
      onPath.push(e.vpc.value.address, ...(e.vpc.value.via ?? []));
      if (e.vpc.value.igw.ok && e.vpc.value.igw.value) onPath.push(e.vpc.value.igw.value);
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
      if (MODELED.has(r.type) || !NETWORK_TYPE.test(r.type) || seen.has(r.address)) continue;
      seen.set(r.address, { resource: r.address, message: `${r.type} is not modeled yet; paths it can change are reported as unknown or not reported` });
    }
  }
  return [...seen.values()].toSorted((a, b) => cmp(a.resource, b.resource));
}

/**
 * Internet-to-resource reachability before and after a Terraform plan.
 * `plan` is the parsed output of `terraform show -json <planfile>`.
 */
export function analyze(plan: unknown): Result {
  const { before, after } = parsePlan(plan);
  const epBefore = endpointsOf(before);
  const epAfter = endpointsOf(after);
  const addresses = [...new Set([...epBefore.keys(), ...epAfter.keys()])].toSorted(cmp);
  const paths: Path[] = [];

  for (const address of addresses) {
    const b = epBefore.get(address);
    const a = epAfter.get(address);
    for (const p of PROTOCOLS) {
      const candidates = union(unionOf(b, (e) => exposedPorts(e, p)), unionOf(a, (e) => exposedPorts(e, p)));
      let run: { ports: Range; before: Outcome; after: Outcome } | undefined;
      const flush = () => {
        if (!run) return;
        const ports = formatPorts([run.ports]);
        const risk = run.before.verdict === "allowed" && run.after.verdict === "allowed" ? deleteFirst(a, after) : [];
        paths.push({ id: `internet->${address}:${p}:${ports}`, from: "internet", to: address, toType: (a ?? b)?.[0]?.type ?? "", protocol: p, ports, change: changeOf(run.before, run.after), before: run.before, after: run.after, ...(risk.length ? { outageRisk: risk } : {}) });
        run = undefined;
      };
      for (const seg of segment(candidates, [...(b ?? []).flatMap(portCuts), ...(a ?? []).flatMap(portCuts)])) {
        const ob = evaluateAll(b, p, seg);
        const oa = evaluateAll(a, p, seg);
        // Merge neighboring port ranges with the same outcome on both sides.
        if (run && run.ports[1] + 1 === seg[0] && JSON.stringify([run.before, run.after]) === JSON.stringify([ob, oa])) run.ports = [run.ports[0], seg[1]];
        else {
          flush();
          run = { ports: seg, before: ob, after: oa };
        }
      }
      flush();
    }
  }

  const summary: Record<Change, number> = { added: 0, removed: 0, changed: 0, unchanged: 0, unknown: 0 };
  for (const path of paths) summary[path.change]++;
  return { format: RESULT_FORMAT, summary, paths, notes: notesFor(before, after) };
}

/** The result as stable JSON text (same input, same bytes). */
export function toJson(result: Result): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
