import { evaluate, exposedPorts, portCuts, segment } from "./evaluate.js";
import { formatPorts, union, type Range } from "./intervals.js";
import { ModelBuilder, type Endpoint } from "./model.js";
import { cmp, parsePlan, type Snapshot } from "./plan.js";
import { RESULT_FORMAT, type Change, type Note, type Outcome, type Path, type Protocol, type Result } from "./types.js";

export { PlanError } from "./plan.js";
export * from "./types.js";

/** Version of the engine package. */
export const ENGINE_VERSION = "0.0.0";

const PROTOCOLS: Protocol[] = ["tcp", "udp"];

// Endpoint and network types the engine models. Other aws_* types in a plan get a note.
const MODELED = new Set(["aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table", "aws_route_table_association", "aws_security_group", "aws_network_acl", "aws_default_network_acl", "aws_instance"]);
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

function endpointsOf(snap: Snapshot): Map<string, Endpoint> {
  return new Map(new ModelBuilder(snap).endpoints().map((e) => [e.address, e]));
}

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
      const candidates = union(exposedPorts(b, p), exposedPorts(a, p));
      let run: { ports: Range; before: Outcome; after: Outcome } | undefined;
      const flush = () => {
        if (!run) return;
        const ports = formatPorts([run.ports]);
        paths.push({ id: `internet->${address}:${p}:${ports}`, from: "internet", to: address, toType: (a ?? b)?.type ?? "", protocol: p, ports, change: changeOf(run.before, run.after), before: run.before, after: run.after });
        run = undefined;
      };
      for (const seg of segment(candidates, [...portCuts(b), ...portCuts(a)])) {
        const ob = evaluate(b, p, seg);
        const oa = evaluate(a, p, seg);
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
