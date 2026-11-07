import { ALL_IPV4, ALL_PORTS, cidrToSet, contains, equals, formatPorts, fromRanges, intersect, isEmpty, setToCidrs, subtract, union, EMPTY, type IntervalSet, type Range } from "./intervals.js";
import type { Endpoint, NaclRule, RuleProtocol } from "./model.js";
import type { Hop, Outcome, Protocol } from "./types.js";

const DOC: Record<"public-ip" | "internet-gateway" | "nacl-inbound" | "security-group" | "nacl-outbound" | "route", string> = {
  "public-ip": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "internet-gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html",
  "security-group": "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
  "nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  route: "https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html",
};

// The client's ephemeral port is unknown. AWS recommends 1024-65535 to cover all clients.
// https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports
export const EPHEMERAL: IntervalSet = [[1024, 65535]];

// Addresses that are never internet sources: "this network", private-use (RFC 1918),
// shared address space, loopback, link-local, multicast, and reserved. Documentation
// ranges (TEST-NET) stay in, so examples such as 203.0.113.0/24 work.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
const NOT_INTERNET = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4"];
const PUBLIC_IPV4: IntervalSet = NOT_INTERNET.reduce<IntervalSet>((set, c) => subtract(set, cidrToSet(c) ?? EMPTY), ALL_IPV4);

/** Internet source addresses for an endpoint: public IPv4 addresses outside its VPC. */
export function internetOf(ep: Endpoint): IntervalSet {
  return ep.vpc.ok && ep.vpc.value.cidrs.ok ? subtract(PUBLIC_IPV4, ep.vpc.value.cidrs.value) : PUBLIC_IPV4;
}

const protoMatches = (rule: RuleProtocol, p: Protocol) => rule === "all" || rule === p;

/** Splits `set` so that no range crosses a boundary of any of `cuts`. */
export function segment(set: IntervalSet, cuts: IntervalSet[]): Range[] {
  const points = new Set<number>();
  for (const c of cuts) for (const [lo, hi] of c) points.add(lo).add(hi + 1);
  const sorted = [...points].toSorted((a, b) => a - b);
  const out: Range[] = [];
  for (const [lo, hi] of set) {
    let start = lo;
    for (const p of sorted) {
      if (p <= start || p > hi) continue;
      out.push([start, p - 1]);
      start = p;
    }
    out.push([start, hi]);
  }
  return out;
}

/**
 * NACL rules are evaluated from the lowest number; the first match decides. A packet
 * that matches no rule is denied by the `*` rule.
 * https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html
 */
export function naclEval(rules: NaclRule[], addrs: IntervalSet, p: Protocol, ports: Range): { allowed: IntervalSet; texts: string[] } {
  let remaining = addrs;
  let allowed: IntervalSet = EMPTY;
  const texts: string[] = [];
  for (const rule of rules) {
    if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    const m = intersect(remaining, rule.cidr);
    if (isEmpty(m)) continue;
    if (rule.allow) allowed = union(allowed, m);
    texts.push(rule.text);
    remaining = subtract(remaining, m);
  }
  if (!isEmpty(remaining)) texts.push("rule *: deny all traffic (implicit)");
  return { allowed, texts };
}

const absent: Outcome = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };

export function evaluate(ep: Endpoint | undefined, p: Protocol, ports: Range): Outcome {
  if (!ep) return absent;
  const hops: Hop[] = [];
  const universe = internetOf(ep);
  const portText = `${p}/${formatPorts([ports])}`;
  const add = (hop: keyof typeof DOC, resource: string, decision: Hop["decision"], rule: string) => hops.push({ hop, resource, decision, rule, doc: DOC[hop] });
  // Sources dropped because a hop could not decide them. They are reported, never hidden.
  const undecided: string[] = [];
  const cidrList = (set: IntervalSet) => {
    const list = setToCidrs(set);
    return list.length > 6 ? `${list.slice(0, 6).join(", ")} and ${list.length - 6} more` : list.join(", ");
  };
  const stop = (verdict: "blocked" | "unknown", reason: string): Outcome => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop: keyof typeof DOC, resource: string, reason: string) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };

  // 1. Public IPv4 address. https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  if (!ep.publicIp.ok) return unknownAt("public-ip", ep.address, ep.publicIp.reason);
  if (!ep.publicIp.value) {
    add("public-ip", ep.address, "deny", `${ep.address} has no public IPv4 address`);
    return stop("blocked", `${ep.address} has no public IPv4 address`);
  }
  add("public-ip", ep.address, "allow", ep.publicIp.value);

  // 2. Internet gateway attached to the VPC.
  if (!ep.vpc.ok) return unknownAt("internet-gateway", ep.address, ep.vpc.reason);
  const vpc = ep.vpc.value;
  if (!vpc.igw.ok) return unknownAt("internet-gateway", vpc.address, vpc.igw.reason);
  if (!vpc.igw.value) {
    // A route to a gateway that is not in this plan may point at an attached internet
    // gateway managed elsewhere, so the plan alone cannot show that none is attached.
    const table = ep.routeTable.ok ? ep.routeTable.value : undefined;
    const external = !table || !table.routes.ok ? (table?.routes.ok === false ? table.routes.reason : ep.routeTable.ok ? "" : ep.routeTable.reason) : table.routes.value.filter((r) => r.target.kind === "unknown").map((r) => r.text).join("; ");
    if (external) return unknownAt("internet-gateway", vpc.address, `no internet gateway for ${vpc.address} is in this plan, but its route table may use one managed elsewhere: ${external}`);
    add("internet-gateway", vpc.address, "deny", `no internet gateway is attached to ${vpc.address}`);
    return stop("blocked", `no internet gateway is attached to ${vpc.address}`);
  }
  const igw = vpc.igw.value;
  add("internet-gateway", igw, "allow", `${igw} is attached to ${vpc.address}`);

  // 3. NACL inbound for the request.
  if (!ep.nacl.ok) return unknownAt("nacl-inbound", ep.subnet.ok ? ep.subnet.value : ep.address, ep.nacl.reason);
  const nacl = ep.nacl.value;
  if (!nacl.ingress.ok) return unknownAt("nacl-inbound", nacl.resource, nacl.ingress.reason);
  const inbound = naclEval(nacl.ingress.value, universe, p, ports);
  let sources = inbound.allowed;
  if (isEmpty(sources)) {
    add("nacl-inbound", nacl.resource, "deny", inbound.texts.join("; "));
    return stop("blocked", `${nacl.resource} denies ${portText} from the internet`);
  }
  add("nacl-inbound", nacl.resource, equals(sources, universe) ? "allow" : "partial", inbound.texts.join("; "));

  // 4. Security groups: allow rules only, combined across groups.
  // https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  if (!ep.securityGroups.ok) return unknownAt("security-group", ep.address, ep.securityGroups.reason);
  const groups = ep.securityGroups.value;
  const sgNames = groups.map((g) => g.address).join(", ");
  let sgAllowed: IntervalSet = EMPTY;
  const sgTexts: string[] = [];
  for (const g of groups) {
    if (!g.ingress.ok) return unknownAt("security-group", g.address, g.ingress.reason);
    for (const rule of g.ingress.value) {
      if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      if (isEmpty(intersect(rule.sources, sources))) continue;
      sgAllowed = union(sgAllowed, rule.sources);
      sgTexts.push(rule.text);
    }
  }
  const afterSg = intersect(sources, sgAllowed);
  if (isEmpty(afterSg)) {
    add("security-group", sgNames, "deny", `no ingress rule of ${sgNames} allows ${portText} from the internet`);
    return stop("blocked", `no ingress rule of ${sgNames} allows ${portText} from the internet`);
  }
  add("security-group", sgNames, equals(afterSg, sources) ? "allow" : "partial", sgTexts.join("; "));
  sources = afterSg;

  // 5. NACL outbound for the response to the client's ephemeral port (NACLs are stateless).
  // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
  if (!nacl.egress.ok) return unknownAt("nacl-outbound", nacl.resource, nacl.egress.reason);
  const egress = nacl.egress.value;
  let full = sources;
  let some: IntervalSet = EMPTY;
  const outTexts = new Set<string>();
  for (const seg of segment(EPHEMERAL, egress.map((r) => r.ports))) {
    const r = naclEval(egress, sources, p, seg);
    full = intersect(full, r.allowed);
    some = union(some, r.allowed);
    r.texts.forEach((t) => outTexts.add(t));
  }
  const outText = [...outTexts].join("; ");
  if (isEmpty(some)) {
    add("nacl-outbound", nacl.resource, "deny", outText);
    return stop("blocked", `${nacl.resource} denies the response to the client's ephemeral ports`);
  }
  if (isEmpty(full)) {
    const reason = `${nacl.resource} allows the response only for some client ephemeral ports in ${formatPorts(EPHEMERAL)}; the result depends on the client's operating system`;
    add("nacl-outbound", nacl.resource, "unknown", outText);
    return stop("unknown", reason);
  }
  const someOnly = subtract(intersect(some, sources), full);
  if (!isEmpty(someOnly)) undecided.push(`responses to ${cidrList(someOnly)} are allowed only for some client ephemeral ports, so they depend on the client's operating system`);
  add("nacl-outbound", nacl.resource, equals(full, sources) ? "allow" : "partial", outText);
  sources = full;

  // 6. Route for the response: longest prefix match must reach this VPC's internet gateway.
  // https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  if (!ep.routeTable.ok) return unknownAt("route", ep.subnet.ok ? ep.subnet.value : ep.address, ep.routeTable.reason);
  const table = ep.routeTable.value;
  if (!table.routes.ok) return unknownAt("route", table.resource, table.routes.reason);
  const routes = table.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = sources;
  let viaIgw: IntervalSet = EMPTY;
  let unresolved: IntervalSet = EMPTY;
  const routeTexts: string[] = [];
  const unresolvedReasons: string[] = [];
  for (const [i, route] of routes.entries()) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    if (routes.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return unknownAt("route", table.resource, `${table.resource} has more than one route for the same destination`);
    routeTexts.push(route.text);
    if (route.target.kind === "igw" && route.target.address === igw) viaIgw = union(viaIgw, m);
    else if (route.target.kind === "unknown") {
      unresolved = union(unresolved, m);
      unresolvedReasons.push(route.target.reason);
    } else if (route.target.kind === "other") {
      unresolved = union(unresolved, m);
      unresolvedReasons.push(`${route.text}: responses through a ${route.target.text} are not modeled yet`);
    }
    remaining = subtract(remaining, m);
  }
  if (isEmpty(viaIgw)) {
    if (!isEmpty(unresolved)) return unknownAt("route", table.resource, unresolvedReasons.join("; "));
    const why = routeTexts.length ? routeTexts.join("; ") : `${table.resource} has no route to the internet`;
    add("route", table.resource, "deny", why);
    return stop("blocked", `the response cannot return to the internet: ${why}`);
  }
  if (!isEmpty(unresolved)) undecided.push(`responses to ${cidrList(unresolved)} cannot be decided: ${unresolvedReasons.join("; ")}`);
  add("route", table.resource, equals(viaIgw, sources) ? "allow" : "partial", routeTexts.join("; "));

  return { verdict: "allowed", sources: equals(viaIgw, universe) ? ["internet"] : setToCidrs(viaIgw), hops, reason: undecided.join("; ") };
}

/**
 * Port ranges a side's security groups open to at least one internet address. When a
 * group is unknown, every port is a candidate, so the path is reported as unknown
 * instead of being left out (ADR 0003).
 */
export function exposedPorts(ep: Endpoint | undefined, p: Protocol): IntervalSet {
  if (!ep) return EMPTY;
  if (!ep.securityGroups.ok || ep.securityGroups.value.some((g) => !g.ingress.ok)) return ALL_PORTS;
  const universe = internetOf(ep);
  let out: IntervalSet = EMPTY;
  for (const g of ep.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) {
      if (protoMatches(rule.protocol, p) && !isEmpty(intersect(rule.sources, universe))) out = union(out, rule.ports);
    }
  }
  return out;
}

/** Port boundaries that can change an outcome: SG and NACL inbound rules. */
export function portCuts(ep: Endpoint | undefined): IntervalSet[] {
  if (!ep) return [];
  const cuts: IntervalSet[] = [];
  if (ep.securityGroups.ok) for (const g of ep.securityGroups.value) if (g.ingress.ok) cuts.push(...g.ingress.value.map((r) => r.ports));
  if (ep.nacl.ok && ep.nacl.value.ingress.ok) cuts.push(...ep.nacl.value.ingress.value.map((r) => r.ports));
  return cuts;
}

export const toRange = (set: IntervalSet): Range[] => fromRanges(set).map(([lo, hi]) => [lo, hi]);
