// Internet to a Compute Engine VM, hop by hop. Rules and sources: docs/semantics/gcp.md.
import { PUBLIC_IPV4 } from "../evaluate.js";
import { ALL_PORTS, contains, equals, formatPorts, intersect, isEmpty, setToCidrs, subtract, union, EMPTY, type IntervalSet, type Range } from "../intervals.js";
import type { Hop, Outcome, Protocol } from "../types.js";
import type { GcpVm } from "./model.js";

const DOC = {
  "public-ip": "https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_instance",
  sql: "https://docs.cloud.google.com/sql/docs/postgres/authorize-networks",
  firewall: "https://docs.cloud.google.com/firewall/docs/firewalls",
  route: "https://docs.cloud.google.com/vpc/docs/routes",
} as const;

const absent: Outcome = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
const protoMatches = (rule: string, p: Protocol) => rule === "all" || rule === p;

export function evaluateGcp(vm: GcpVm | undefined, p: Protocol, ports: Range): Outcome {
  if (!vm) return absent;
  const hops: Hop[] = [];
  const sql = vm.type === "google_sql_database_instance";
  const add = (hop: "public-ip" | "firewall" | "route", resource: string, decision: Hop["decision"], rule: string) => hops.push({ hop, resource, decision, rule, doc: sql && hop !== "route" ? DOC.sql : DOC[hop] });
  const stop = (verdict: "blocked" | "unknown", reason: string): Outcome => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop: "public-ip" | "firewall" | "route", resource: string, reason: string) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const portText = `${p}/${formatPorts([ports])}`;

  // 1. External IP address (rule 1).
  if (!vm.externalIp.ok) return unknownAt("public-ip", vm.address, vm.externalIp.reason);
  if (!vm.externalIp.value) {
    add("public-ip", vm.address, "deny", vm.type === "google_sql_database_instance" ? `${vm.address} has no public IP address (ipv4_enabled = false)` : `${vm.address} has no external IP address (no access_config)`);
    return stop("blocked", `${vm.address} has no external IP address`);
  }
  add("public-ip", vm.address, "allow", vm.externalIp.value);

  // 2. VPC firewall rules: the first matching rule in priority order decides; then the implied deny (rules 3, 4).
  const where = vm.network.ok ? vm.network.value : vm.address;
  if (!vm.firewall.ok) return unknownAt("firewall", where, vm.firewall.reason);
  let remaining = PUBLIC_IPV4;
  let allowed: IntervalSet = EMPTY;
  const texts: string[] = [];
  for (const rule of vm.firewall.value) {
    if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    const m = intersect(remaining, rule.sources);
    if (isEmpty(m)) continue;
    if (rule.allow) allowed = union(allowed, m);
    texts.push(rule.text);
    remaining = subtract(remaining, m);
  }
  if (!isEmpty(remaining)) texts.push(vm.implied);
  if (isEmpty(allowed)) {
    add("firewall", where, "deny", texts.join("; "));
    return stop("blocked", `no firewall rule of ${where} allows ${portText} from the internet to ${vm.address}`);
  }
  add("firewall", where, equals(allowed, PUBLIC_IPV4) ? "allow" : "partial", texts.join("; "));

  // 3. The response leaves through the default internet gateway (rule 9). Firewalls are stateful (rule 8).
  if (!vm.route.ok) return unknownAt("route", where, vm.route.reason);
  if (vm.route.value) add("route", vm.route.value.resource, "allow", vm.route.value.text);

  return { verdict: "allowed", sources: equals(allowed, PUBLIC_IPV4) ? ["internet"] : setToCidrs(allowed), hops, reason: "" };
}

/** Ports some firewall rule allows from an internet address. Every port when the rules are unknown (ADR 0003). */
export function gcpExposed(vm: GcpVm | undefined, p: Protocol): IntervalSet {
  if (!vm) return EMPTY;
  if (!vm.firewall.ok) return ALL_PORTS;
  let out: IntervalSet = EMPTY;
  for (const rule of vm.firewall.value) if (rule.allow && protoMatches(rule.protocol, p) && !isEmpty(intersect(rule.sources, PUBLIC_IPV4))) out = union(out, rule.ports);
  return out;
}

/** Port boundaries that can change an outcome. */
export function gcpCuts(vm: GcpVm | undefined): IntervalSet[] {
  return vm?.firewall.ok ? vm.firewall.value.map((r) => r.ports) : [];
}
