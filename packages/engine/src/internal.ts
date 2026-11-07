// Paths inside the VPC: from one endpoint in the plan to another, where a security group
// rule of the target references a group of the source. Semantics and AWS sources:
// docs/semantics/internal-paths.md.
import { EPHEMERAL, naclEval, segment } from "./evaluate.js";
import { contains, equals, formatPorts, intersect, isEmpty, subtract, union, EMPTY, type IntervalSet, type Range } from "./intervals.js";
import type { Endpoint, Known, Nacl, NaclRule, RouteTable, SecurityGroup } from "./model.js";
import type { Hop, HopKind, Outcome, Protocol } from "./types.js";

const SG_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html";
const NACL_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html";
const ROUTE_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html";
const DOC: Partial<Record<HopKind, string>> = {
  "source-security-group": SG_DOC,
  "source-route": ROUTE_DOC,
  "source-nacl-outbound": NACL_DOC,
  "target-nacl-inbound": NACL_DOC,
  "security-group": SG_DOC,
  "target-nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  "source-nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  "target-route": ROUTE_DOC,
};

/** "We evaluate the network ACL rules when traffic enters and leaves the subnet, not as it is routed within a subnet." */
const SAME_SUBNET = "same subnet: no network ACL applies";

type Step = { decision: Hop["decision"]; resource: string; rule: string; reason?: string };

const protoMatches = (rule: string, p: Protocol) => rule === "all" || rule === p;

/** Keys of an endpoint's security groups, or why they are unknown. */
export function groupKeys(ep: Endpoint): Known<string[]> {
  return ep.securityGroups.ok ? { ok: true, value: ep.securityGroups.value.map((g) => g.key) } : ep.securityGroups;
}

/**
 * One direction of security group rules: does a rule of `groups` allow `p`/`ports` to
 * (egress) or from (ingress) the peer, known by its group keys and its subnet?
 */
function sgStep(groups: SecurityGroup[], dir: "ingress" | "egress", peerKeys: string[], peerCidr: IntervalSet, peer: string, p: Protocol, ports: Range): Step {
  const names = groups.map((g) => g.address).join(", ") || "no security groups";
  const allowing: string[] = [];
  const doubt: string[] = [];
  for (const g of groups) {
    const rules = g[dir];
    if (!rules.ok) return { decision: "unknown", resource: g.address, rule: rules.reason, reason: rules.reason };
    for (const rule of rules.value) {
      if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      if (rule.groups.some((k) => peerKeys.includes(k)) || contains(rule.sources, peerCidr)) allowing.push(rule.text);
      else if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
      else if (rule.unresolved) doubt.push(`${rule.text}: ${rule.unresolved}`);
    }
  }
  const portText = `${p}/${formatPorts([ports])}`;
  if (allowing.length) return { decision: "allow", resource: names, rule: allowing.join("; ") };
  if (doubt.length) return { decision: "unknown", resource: names, rule: doubt.join("; "), reason: doubt.join("; ") };
  const what = dir === "egress" ? `no egress rule of ${names} allows ${portText} to ${peer}` : `no ingress rule of ${names} allows ${portText} from ${peer}`;
  return { decision: "deny", resource: names, rule: what, reason: what };
}

/** The route from one subnet to another subnet's CIDR must be the VPC's local route. */
function routeStep(table: Known<RouteTable>, at: string, peerCidr: IntervalSet, peer: string): Step {
  if (!table.ok) return { decision: "unknown", resource: at, rule: table.reason, reason: table.reason };
  const t = table.value;
  if (!t.routes.ok) return { decision: "unknown", resource: t.resource, rule: t.routes.reason, reason: t.routes.reason };
  // Longest prefix match. https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  let local: IntervalSet = EMPTY;
  const texts: string[] = [];
  const elsewhere: string[] = [];
  for (const [i, route] of routes.entries()) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    if (routes.some((o, j) => j !== i && equals(o.cidr, route.cidr))) {
      const why = `${t.resource} has more than one route for the same destination`;
      return { decision: "unknown", resource: t.resource, rule: why, reason: why };
    }
    texts.push(route.text);
    if (route.target.kind === "local") local = union(local, m);
    else if (route.target.kind === "drop" && route.target.text === "blackhole") {
      const why = `${route.text}: ${route.target.why}`;
      return { decision: "deny", resource: t.resource, rule: why, reason: why };
    } else elsewhere.push(route.text);
    remaining = subtract(remaining, m);
  }
  if (elsewhere.length) {
    const why = `${elsewhere.join("; ")} sends traffic for the subnet of ${peer} away from the local route; paths through a middlebox are not modeled`;
    return { decision: "unknown", resource: t.resource, rule: why, reason: why };
  }
  if (!isEmpty(remaining) || isEmpty(local)) {
    const why = `${t.resource} has no route to the subnet of ${peer}`;
    return { decision: "deny", resource: t.resource, rule: why, reason: why };
  }
  return { decision: "allow", resource: t.resource, rule: texts.join("; ") };
}

/** One direction of a NACL for the whole peer subnet. `ephemeral`: the response to the client's port. */
function naclStep(nacl: Known<Nacl>, at: string, dir: "ingress" | "egress", peerCidr: IntervalSet, peer: string, p: Protocol, ports: Range, ephemeral: boolean): Step {
  if (!nacl.ok) return { decision: "unknown", resource: at, rule: nacl.reason, reason: nacl.reason };
  const n = nacl.value;
  const rules: Known<NaclRule[]> = n[dir];
  if (!rules.ok) return { decision: "unknown", resource: n.resource, rule: rules.reason, reason: rules.reason };
  const segs = ephemeral ? segment(EPHEMERAL, rules.value.map((r) => r.ports)) : [ports];
  const texts = new Set<string>();
  let full = 0;
  let none = 0;
  for (const seg of segs) {
    const r = naclEval(rules.value, peerCidr, p, seg);
    r.texts.forEach((t) => texts.add(t));
    if (equals(r.allowed, peerCidr)) full++;
    else if (isEmpty(r.allowed)) none++;
  }
  const rule = [...texts].join("; ");
  const what = ephemeral ? "the response" : "the request";
  if (full === segs.length) return { decision: "allow", resource: n.resource, rule };
  if (none === segs.length) return { decision: "deny", resource: n.resource, rule, reason: `${n.resource} denies ${what} ${dir === "ingress" ? "from" : "to"} the subnet of ${peer}` };
  const why = full + none === segs.length ? `${n.resource} allows the response only for some client ephemeral ports in ${formatPorts(EPHEMERAL)}; the result depends on the client's operating system` : `${n.resource} decides ${what} for only part of the subnet of ${peer}, and its address is not known before apply`;
  return { decision: "unknown", resource: n.resource, rule, reason: why };
}

const absent: Outcome = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };

/** The path from endpoint `a` to endpoint `t` for `p` on `ports`, hop by hop. */
export function evaluateInternal(a: Endpoint | undefined, t: Endpoint | undefined, p: Protocol, ports: Range): Outcome {
  if (!a || !t) return absent;
  const hops: Hop[] = [];
  const run = (hop: HopKind, s: Step): Outcome | undefined => {
    hops.push({ hop, resource: s.resource, decision: s.decision, rule: s.rule, doc: DOC[hop] ?? SG_DOC });
    if (s.decision === "deny") return { verdict: "blocked", sources: [], hops, reason: s.reason ?? s.rule };
    if (s.decision === "unknown") return { verdict: "unknown", sources: [], hops, reason: s.reason ?? s.rule };
    return undefined;
  };
  const fail = (hop: HopKind, at: string, reason: string) => run(hop, { decision: "unknown", resource: at, rule: reason, reason }) as Outcome;

  if (!a.securityGroups.ok) return fail("source-security-group", a.address, a.securityGroups.reason);
  if (!t.securityGroups.ok) return fail("source-security-group", t.address, t.securityGroups.reason);
  if (!a.subnetCidr.ok) return fail("source-security-group", a.address, a.subnetCidr.reason);
  if (!t.subnetCidr.ok) return fail("source-security-group", t.address, t.subnetCidr.reason);
  const aKeys = a.securityGroups.value.map((g) => g.key);
  const tKeys = t.securityGroups.value.map((g) => g.key);
  const aCidr = a.subnetCidr.value;
  const tCidr = t.subnetCidr.value;

  // 1. Outbound rules of the source's groups (the request starts at the source).
  const out = run("source-security-group", sgStep(a.securityGroups.value, "egress", tKeys, tCidr, t.address, p, ports));
  if (out) return out;

  // 2. Same VPC, and the local route to the target's subnet.
  if (!a.vpc.ok) return fail("source-route", a.address, a.vpc.reason);
  if (!t.vpc.ok) return fail("source-route", t.address, t.vpc.reason);
  if (a.vpc.value.address !== t.vpc.value.address) return fail("source-route", a.address, `${a.address} and ${t.address} are in different VPCs (${a.vpc.value.address}, ${t.vpc.value.address}); peering and Transit Gateway are not modeled yet`);
  const r1 = run("source-route", routeStep(a.routeTable, a.address, tCidr, t.address));
  if (r1) return r1;

  // 3, 4. The request leaves the source subnet and enters the target subnet.
  const same = a.subnet.ok && t.subnet.ok && a.subnet.value === t.subnet.value;
  const at = (ep: Endpoint) => (ep.subnet.ok ? ep.subnet.value : ep.address);
  const skip = (ep: Endpoint): Step => ({ decision: "allow", resource: at(ep), rule: SAME_SUBNET });
  const n3 = run("source-nacl-outbound", same ? skip(a) : naclStep(a.nacl, at(a), "egress", tCidr, t.address, p, ports, false));
  if (n3) return n3;
  const n4 = run("target-nacl-inbound", same ? skip(t) : naclStep(t.nacl, at(t), "ingress", aCidr, a.address, p, ports, false));
  if (n4) return n4;

  // 5. Inbound rules of the target's groups.
  const sg = run("security-group", sgStep(t.securityGroups.value, "ingress", aKeys, aCidr, a.address, p, ports));
  if (sg) return sg;

  // 6, 7. The response leaves the target subnet and enters the source subnet (NACLs are stateless).
  const n6 = run("target-nacl-outbound", same ? skip(t) : naclStep(t.nacl, at(t), "egress", aCidr, a.address, p, ports, true));
  if (n6) return n6;
  const n7 = run("source-nacl-inbound", same ? skip(a) : naclStep(a.nacl, at(a), "ingress", tCidr, t.address, p, ports, true));
  if (n7) return n7;

  // 8. The local route back to the source's subnet.
  const r8 = run("target-route", routeStep(t.routeTable, t.address, aCidr, a.address));
  if (r8) return r8;

  return { verdict: "allowed", sources: [a.address], hops, reason: "" };
}

/** Ports a target's ingress rules open to a group of the source. */
export function referencedPorts(a: Endpoint, t: Endpoint, p: Protocol): IntervalSet {
  const keys = groupKeys(a);
  if (!keys.ok || !t.securityGroups.ok) return EMPTY;
  let out: IntervalSet = EMPTY;
  for (const g of t.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) if (protoMatches(rule.protocol, p) && rule.groups.some((k) => keys.value.includes(k))) out = union(out, rule.ports);
  }
  return out;
}

/** Port boundaries that can change an internal outcome: both endpoints' SG and NACL rules. */
export function internalCuts(ep: Endpoint): IntervalSet[] {
  const cuts: IntervalSet[] = [];
  if (ep.securityGroups.ok) for (const g of ep.securityGroups.value) for (const dir of [g.ingress, g.egress]) if (dir.ok) cuts.push(...dir.value.map((r) => r.ports));
  if (ep.nacl.ok) for (const dir of [ep.nacl.value.ingress, ep.nacl.value.egress]) if (dir.ok) cuts.push(...dir.value.map((r) => r.ports));
  return cuts;
}
