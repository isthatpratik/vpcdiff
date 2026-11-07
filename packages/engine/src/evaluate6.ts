// IPv6 paths from the internet (issue #33): the same six hops as evaluate.ts, on IPv6
// address sets. Semantics and AWS sources: docs/semantics/ipv6.md.
import { contains, type Range } from "./intervals.js";
import { cidr6ToSet, equals6, intersect6, isEmpty6, set6ToCidrs, subtract6, union6, EMPTY6, type Set6 } from "./intervals6.js";
import { EPHEMERAL, segment } from "./evaluate.js";
import type { Endpoint, NaclRule } from "./model.js";
import type { Hop, Outcome, Protocol } from "./types.js";

const DOC = {
  "public-ip": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html",
  "internet-gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html",
  "security-group": "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
  "nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  route: "https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html",
} as const;

/**
 * Internet IPv6 sources: global unicast (2000::/3), outside the VPC's own block when it
 * is known. Unique local, link-local, and multicast addresses are never internet sources.
 * https://www.iana.org/assignments/ipv6-address-space/
 */
const GLOBAL_UNICAST = cidr6ToSet("2000::/3") as Set6;
export function internet6Of(ep: Endpoint): Set6 {
  const own = ep.vpc.ok && ep.vpc.value.ipv6?.ok ? ep.vpc.value.ipv6.value?.cidrs : undefined;
  return own ? subtract6(GLOBAL_UNICAST, own) : GLOBAL_UNICAST;
}

const protoMatches = (rule: string, p: Protocol) => rule === "all" || rule === p;

/** NACL rules in number order for IPv6 addresses; IPv4 entries never match. */
export function naclEval6(rules: NaclRule[], addrs: Set6, p: Protocol, ports: Range): { allowed: Set6; texts: string[] } {
  let remaining = addrs;
  let allowed: Set6 = EMPTY6;
  const texts: string[] = [];
  for (const rule of rules) {
    if (!rule.cidr6 || !protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    const m = intersect6(remaining, rule.cidr6);
    if (isEmpty6(m)) continue;
    if (rule.allow) allowed = union6(allowed, m);
    texts.push(rule.text);
    remaining = subtract6(remaining, m);
  }
  if (!isEmpty6(remaining)) texts.push("rule *: deny all IPv6 traffic (implicit)");
  return { allowed, texts };
}

const absent: Outcome = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };

export function evaluate6(ep: Endpoint | undefined, p: Protocol, ports: Range): Outcome {
  if (!ep) return absent;
  const hops: Hop[] = [];
  const universe = internet6Of(ep);
  const portText = `${p}/${ports[0] === ports[1] ? ports[0] : `${ports[0]}-${ports[1]}`}`;
  const add = (hop: keyof typeof DOC, resource: string, decision: Hop["decision"], rule: string) => hops.push({ hop, resource, decision, rule, doc: DOC[hop] });
  const stop = (verdict: "blocked" | "unknown", reason: string): Outcome => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop: keyof typeof DOC, resource: string, reason: string) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const undecided: string[] = [];

  // 1. A global IPv6 address.
  const ip = ep.publicIp6 ?? { ok: true as const, value: undefined };
  if (!ip.ok) return unknownAt("public-ip", ep.address, ip.reason);
  if (!ip.value) {
    add("public-ip", ep.address, "deny", `${ep.address} has no IPv6 address`);
    return stop("blocked", `${ep.address} has no IPv6 address`);
  }
  add("public-ip", ep.address, "allow", ip.value);

  // 2. An internet gateway carries IPv6 in both directions; an egress-only one does not take inbound traffic.
  if (!ep.vpc.ok) return unknownAt("internet-gateway", ep.address, ep.vpc.reason);
  const vpc = ep.vpc.value;
  if (!vpc.igw.ok) return unknownAt("internet-gateway", vpc.address, vpc.igw.reason);
  if (!vpc.igw.value) {
    add("internet-gateway", vpc.address, "deny", `no internet gateway is attached to ${vpc.address}`);
    return stop("blocked", `no internet gateway is attached to ${vpc.address}`);
  }
  // Whether the VPC has IPv6 decides the default NACL's IPv6 rule, so it must be known.
  if (vpc.ipv6 && !vpc.ipv6.ok) return unknownAt("internet-gateway", vpc.address, vpc.ipv6.reason);
  const igw = vpc.igw.value;
  add("internet-gateway", igw, "allow", `${igw} is attached to ${vpc.address}`);

  // 3. NACL inbound.
  if (!ep.nacl.ok) return unknownAt("nacl-inbound", ep.address, ep.nacl.reason);
  const nacl = ep.nacl.value;
  if (!nacl.ingress.ok) return unknownAt("nacl-inbound", nacl.resource, nacl.ingress.reason);
  const inbound = naclEval6(nacl.ingress.value, universe, p, ports);
  let sources = inbound.allowed;
  if (isEmpty6(sources)) {
    add("nacl-inbound", nacl.resource, "deny", inbound.texts.join("; "));
    return stop("blocked", `${nacl.resource} denies ${portText} from the IPv6 internet`);
  }
  add("nacl-inbound", nacl.resource, equals6(sources, universe) ? "allow" : "partial", inbound.texts.join("; "));

  // 4. Security groups.
  if (!ep.securityGroups.ok) return unknownAt("security-group", ep.address, ep.securityGroups.reason);
  const groups = ep.securityGroups.value;
  const names = groups.map((g) => g.address).join(", ");
  let allowed: Set6 = EMPTY6;
  const texts: string[] = [];
  // A prefix list that cannot be expanded may hold IPv6 sources: undecided, never allowed.
  const doubt: string[] = [];
  for (const g of groups) {
    if (!g.ingress.ok) return unknownAt("security-group", g.address, g.ingress.reason);
    for (const rule of g.ingress.value) {
      if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      if (rule.listUnresolved) doubt.push(`${rule.text}: ${rule.listUnresolved}`);
      if (!rule.sources6) continue;
      if (isEmpty6(intersect6(rule.sources6, sources))) continue;
      allowed = union6(allowed, rule.sources6);
      texts.push(rule.text);
    }
  }
  const afterSg = intersect6(sources, allowed);
  if (isEmpty6(afterSg) && doubt.length) return unknownAt("security-group", names, doubt.join("; "));
  if (doubt.length && !equals6(afterSg, sources)) undecided.push(`IPv6 sources in ${doubt.join("; ")}`);
  if (isEmpty6(afterSg)) {
    add("security-group", names, "deny", `no ingress rule of ${names} allows ${portText} from the IPv6 internet`);
    return stop("blocked", `no ingress rule of ${names} allows ${portText} from the IPv6 internet`);
  }
  add("security-group", names, equals6(afterSg, sources) ? "allow" : "partial", texts.join("; "));
  sources = afterSg;

  // 5. NACL outbound for the response to the client's ephemeral port.
  if (!nacl.egress.ok) return unknownAt("nacl-outbound", nacl.resource, nacl.egress.reason);
  let full = sources;
  let some: Set6 = EMPTY6;
  const outTexts = new Set<string>();
  for (const seg of segment(EPHEMERAL, nacl.egress.value.map((r) => r.ports))) {
    const r = naclEval6(nacl.egress.value, sources, p, seg);
    full = intersect6(full, r.allowed);
    some = union6(some, r.allowed);
    r.texts.forEach((t) => outTexts.add(t));
  }
  const outText = [...outTexts].join("; ");
  if (isEmpty6(some)) {
    add("nacl-outbound", nacl.resource, "deny", outText);
    return stop("blocked", `${nacl.resource} denies the IPv6 response to the client's ephemeral ports`);
  }
  if (isEmpty6(full)) {
    add("nacl-outbound", nacl.resource, "unknown", outText);
    return stop("unknown", `${nacl.resource} allows the IPv6 response only for some client ephemeral ports; the result depends on the client's operating system`);
  }
  if (!isEmpty6(subtract6(some, full))) undecided.push("some IPv6 responses are allowed only for some client ephemeral ports");
  add("nacl-outbound", nacl.resource, equals6(full, sources) ? "allow" : "partial", outText);
  sources = full;

  // 6. Route for the response: longest prefix match among IPv6 routes.
  if (!ep.routeTable.ok) return unknownAt("route", ep.address, ep.routeTable.reason);
  const table = ep.routeTable.value;
  if (!table.routes.ok) return unknownAt("route", table.resource, table.routes.reason);
  const routes = table.routes.value.filter((r) => r.cidr6).toSorted((a, b) => b.prefix - a.prefix);
  const listDoubt = table.routes.value.filter((r) => r.listUnresolved).map((r) => `${r.text}: ${r.listUnresolved}`);
  let remaining = sources;
  let viaIgw: Set6 = EMPTY6;
  let unresolved: Set6 = EMPTY6;
  const routeTexts: string[] = [];
  const reasons: string[] = [];
  const dropped: string[] = [];
  for (const [i, route] of routes.entries()) {
    const m = intersect6(remaining, route.cidr6 as Set6);
    if (isEmpty6(m)) continue;
    if (routes.some((o, j) => j !== i && equals6(o.cidr6 as Set6, route.cidr6 as Set6))) return unknownAt("route", table.resource, `${table.resource} has more than one IPv6 route for the same destination`);
    routeTexts.push(route.text);
    if (route.target.kind === "igw" && route.target.address === igw) viaIgw = union6(viaIgw, m);
    else if (route.target.kind === "drop") dropped.push(`${route.text}: ${route.target.why}`);
    else if (route.target.kind === "unknown") {
      unresolved = union6(unresolved, m);
      reasons.push(route.target.reason);
    } else if (route.target.kind !== "local") {
      unresolved = union6(unresolved, m);
      reasons.push(`${route.text}: IPv6 responses through a ${route.target.kind === "other" ? route.target.text : route.target.kind} are not modeled yet`);
    }
    remaining = subtract6(remaining, m);
  }
  if (isEmpty6(viaIgw)) {
    if (!isEmpty6(unresolved) || listDoubt.length) return unknownAt("route", table.resource, [...reasons, ...listDoubt].join("; "));
    const why = dropped.length ? dropped.join("; ") : routeTexts.length ? routeTexts.join("; ") : `${table.resource} has no IPv6 route to the internet`;
    add("route", table.resource, "deny", why);
    return stop("blocked", `the IPv6 response cannot return to the internet: ${why}`);
  }
  if (listDoubt.length) undecided.push(`IPv6 responses to addresses in a prefix list may use another route: ${listDoubt.join("; ")}`);
  if (!isEmpty6(unresolved)) undecided.push(`IPv6 responses to ${set6ToCidrs(unresolved).slice(0, 6).join(", ")} cannot be decided: ${reasons.join("; ")}`);
  add("route", table.resource, equals6(viaIgw, sources) ? "allow" : "partial", routeTexts.join("; "));
  return { verdict: "allowed", sources: equals6(viaIgw, universe) ? ["internet"] : set6ToCidrs(viaIgw), hops, reason: undecided.join("; ") };
}

/** Port ranges a side's security groups open to at least one IPv6 internet address. */
export function exposedPorts6(ep: Endpoint | undefined, p: Protocol): { lo: number; hi: number }[] {
  if (!ep || !ep.publicIp6 || (ep.publicIp6.ok && !ep.publicIp6.value)) return [];
  if (!ep.securityGroups.ok) return [{ lo: 0, hi: 65535 }];
  const universe = internet6Of(ep);
  const out: { lo: number; hi: number }[] = [];
  for (const g of ep.securityGroups.value) {
    if (!g.ingress.ok) return [{ lo: 0, hi: 65535 }];
    for (const rule of g.ingress.value) {
      if (protoMatches(rule.protocol, p) && (rule.listUnresolved || (rule.sources6 && !isEmpty6(intersect6(rule.sources6, universe))))) for (const [lo, hi] of rule.ports) out.push({ lo, hi });
    }
  }
  return out;
}
