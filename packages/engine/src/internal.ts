// Paths inside the VPC: from one endpoint in the plan to another, where a security group
// rule of the target references a group of the source. Semantics and AWS sources:
// docs/semantics/internal-paths.md.
import { EPHEMERAL, naclEval, PRIVATE_IPV4, segment } from "./evaluate.js";
import { contains, equals, formatPorts, intersect, isEmpty, subtract, union, EMPTY, type IntervalSet, type Range } from "./intervals.js";
import type { Endpoint, Known, Nacl, NaclRule, RouteTable, SecurityGroup, TgwAttachment, Transit, Vpc } from "./model.js";
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

/** `doubt`: on an allowing step, what it could not decide (reported in the path's reason). */
type Step = { decision: Hop["decision"]; resource: string; rule: string; reason?: string; doubt?: string; doc?: string };

const protoMatches = (rule: string, p: Protocol) => rule === "all" || rule === p;

/**
 * Whether a rule that names a group of the peer can match: always in one VPC or across a
 * peering connection; across a transit gateway only as docs/semantics/transit-gateway.md says.
 */
type GroupRefs = { use: true } | { use: false; why: string } | { use: "unknown"; why: string };
const USE_GROUPS: GroupRefs = { use: true };

/** Keys of an endpoint's security groups, or why they are unknown. */
export function groupKeys(ep: Endpoint): Known<string[]> {
  return ep.securityGroups.ok ? { ok: true, value: ep.securityGroups.value.map((g) => g.key) } : ep.securityGroups;
}

/**
 * One direction of security group rules: does a rule of `groups` allow `p`/`ports` to
 * (egress) or from (ingress) the peer, known by its group keys and its subnet?
 */
function sgStep(groups: SecurityGroup[], dir: "ingress" | "egress", peerKeys: string[], peerCidr: IntervalSet, peer: string, p: Protocol, ports: Range, refs: GroupRefs = USE_GROUPS): Step {
  const names = groups.map((g) => g.address).join(", ") || "no security groups";
  const allowing: string[] = [];
  const doubt: string[] = [];
  const ignored: string[] = [];
  for (const g of groups) {
    const rules = g[dir];
    if (!rules.ok) return { decision: "unknown", resource: g.address, rule: rules.reason, reason: rules.reason };
    for (const rule of rules.value) {
      if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      const byGroup = rule.groups.some((k) => peerKeys.includes(k));
      if (contains(rule.sources, peerCidr) || (byGroup && refs.use === true)) allowing.push(rule.text);
      else if (byGroup && refs.use === "unknown") doubt.push(`${rule.text} names a group of ${peer}: ${refs.why}`);
      else if (byGroup && refs.use === false) {
        // The group cannot match, but the rule's other sources still can.
        ignored.push(`${rule.text} names a group of ${peer}, but ${refs.why}`);
        if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
        else if (rule.unresolved) doubt.push(`${rule.text}: ${rule.unresolved}`);
        else if (rule.listUnresolved) doubt.push(`${rule.text}: ${rule.listUnresolved}`);
      }
      else if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
      else if (rule.unresolved) doubt.push(`${rule.text}: ${rule.unresolved}`);
      else if (rule.listUnresolved) doubt.push(`${rule.text}: ${rule.listUnresolved}`);
    }
  }
  const portText = `${p}/${formatPorts([ports])}`;
  if (allowing.length) return { decision: "allow", resource: names, rule: allowing.join("; ") };
  if (doubt.length) return { decision: "unknown", resource: names, rule: doubt.join("; "), reason: doubt.join("; ") };
  const what = (dir === "egress" ? `no egress rule of ${names} allows ${portText} to ${peer}` : `no ingress rule of ${names} allows ${portText} from ${peer}`) + (ignored.length ? ` (${ignored.join("; ")})` : "");
  return { decision: "deny", resource: names, rule: what, reason: what };
}

/** The route from one subnet to another subnet's CIDR must be the VPC's local route. */
function routeStep(table: Known<RouteTable>, at: string, peerCidr: IntervalSet, peer: string): Step {
  if (!table.ok) return { decision: "unknown", resource: at, rule: table.reason, reason: table.reason };
  const t = table.value;
  if (!t.routes.ok) return { decision: "unknown", resource: t.resource, rule: t.routes.reason, reason: t.routes.reason };
  // Longest prefix match. https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  // A gateway endpoint's list holds the service's public ranges ("the IP address ranges for
  // Amazon S3"), so it cannot match a subnet in private address space.
  // https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html#route-tables-nat
  const listDoubt = routes.filter((r) => r.listUnresolved && !(r.awsService && contains(PRIVATE_IPV4, peerCidr))).map((r) => `${r.text}: ${r.listUnresolved}`);
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
  return { decision: "allow", resource: t.resource, rule: texts.join("; "), ...(listDoubt.length ? { doubt: `traffic to the subnet of ${peer} may match a prefix list route instead: ${listDoubt.join("; ")}` } : {}) };
}

/**
 * The route from a subnet to a subnet in a peered VPC: every address of the peer subnet
 * must use one route to a VPC peering connection that joins the two VPCs and is active.
 * "The owner of each VPC in the VPC peering connection must manually add a route ... that
 * points to the IP address range of the other VPC."
 * https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html
 */
function peeringStep(table: Known<RouteTable>, at: string, peerCidr: IntervalSet, peer: string, own: Vpc, peerVpc: Vpc): Step {
  const fail = (decision: "deny" | "unknown", resource: string, why: string): Step => ({ decision, resource, rule: why, reason: why });
  if (!table.ok) return fail("unknown", at, table.reason);
  const t = table.value;
  if (!t.routes.ok) return fail("unknown", t.resource, t.routes.reason);
  // "You cannot create a VPC peering connection between VPCs that have matching or overlapping IPv4 or IPv6 CIDR blocks."
  if (own.cidrs.ok && peerVpc.cidrs.ok && !isEmpty(intersect(own.cidrs.value, peerVpc.cidrs.value))) return fail("unknown", own.address, `${own.address} and ${peerVpc.address} have overlapping CIDR blocks, so they cannot be peered`);
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const via = new Set<string>();
  const texts: string[] = [];
  for (const [i, route] of routes.entries()) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    if (routes.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return fail("unknown", t.resource, `${t.resource} has more than one route for the same destination`);
    texts.push(route.text);
    const target = route.target;
    if (target.kind === "drop" && target.peering) {
      if (!target.peering.ok) return fail("unknown", t.resource, target.peering.reason);
      via.add(target.peering.value);
    } else if (target.kind === "drop") return fail(equals(m, peerCidr) ? "deny" : "unknown", t.resource, `${route.text}: ${target.why}${equals(m, peerCidr) ? "" : `, for part of the subnet of ${peer}`}`);
    else if (target.kind === "unknown") return fail("unknown", t.resource, target.reason);
    else return fail("unknown", t.resource, `${route.text} sends traffic for the subnet of ${peer} to a ${target.kind === "other" ? target.text : target.kind}, which is not modeled for paths between VPCs`);
    remaining = subtract(remaining, m);
  }
  if (!isEmpty(remaining)) return fail("deny", t.resource, `${t.resource} has no route to the subnet of ${peer} in ${peerVpc.address}`);
  if (via.size !== 1) return fail("unknown", t.resource, `${t.resource} sends the subnet of ${peer} to more than one peering connection`);
  const pcx = [...via][0] as string;
  if (!own.peerings) return fail("unknown", own.address, `${own.address}: peering connections are not known`);
  if (!own.peerings.ok) return fail("unknown", own.address, own.peerings.reason);
  const p = own.peerings.value.find((x) => x.address === pcx);
  if (!p) return fail("unknown", t.resource, `${pcx} is not a peering connection of ${own.address} in this plan`);
  if (!p.peer.ok) return fail("unknown", pcx, p.peer.reason);
  if (p.peer.value !== peerVpc.address) return fail("deny", pcx, `${pcx} joins ${own.address} and ${p.peer.value}, not ${peerVpc.address}`);
  if (!p.active.ok) return fail("unknown", pcx, p.active.reason);
  return { decision: "allow", resource: t.resource, rule: `${texts.join("; ")} (${p.active.value})` };
}

const TGW_DOC = "https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html";

/** The transit gateway that a route table sends a subnet to, when every matching route names the same one. */
function transitOf(table: Known<RouteTable>, peerCidr: IntervalSet): Known<string> | undefined {
  if (!table.ok || !table.value.routes.ok) return undefined;
  const routes = table.value.routes.value.filter((r) => !isEmpty(intersect(r.cidr, peerCidr))).toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const via: Known<string>[] = [];
  for (const r of routes) {
    const m = intersect(remaining, r.cidr);
    if (isEmpty(m)) continue;
    if (r.target.kind !== "other" || !r.target.tgw) return undefined;
    via.push(r.target.tgw);
    remaining = subtract(remaining, m);
  }
  const first = via[0];
  if (!first) return undefined;
  if (!first.ok) return first;
  return via.every((v) => v.ok && v.value === first.value) ? first : undefined;
}

/** The one VPC attachment of `vpc` to `tgw`. */
function attachmentOf(transit: Transit, tgw: string, vpc: string): Known<TgwAttachment> {
  const list = transit.attachments.filter((a) => a.tgw === tgw && a.vpc === vpc);
  if (list.length === 1) return { ok: true, value: list[0] as TgwAttachment };
  return { ok: false, reason: list.length ? `${vpc} has ${list.length} attachments to ${tgw}` : `${vpc} has no attachment to ${tgw} in this plan` };
}

/** Whether a group reference of the target can name a group of the source across `tgw` (inbound rules only). */
function transitGroupRefs(transit: Known<Transit> | undefined, tgw: Known<string>, a: Vpc, t: Vpc): GroupRefs {
  if (!transit?.ok || !tgw.ok) return { use: "unknown", why: "the transit gateway is not known" };
  const gw = transit.value.gateways.get(tgw.value);
  const atA = attachmentOf(transit.value, tgw.value, a.address);
  const atT = attachmentOf(transit.value, tgw.value, t.address);
  if (!gw || !atA.ok || !atT.ok) return { use: "unknown", why: "the transit gateway attachments are not known" };
  const flags: [string, Known<boolean>][] = [[tgw.value, gw.sgRefs], [atA.value.address, atA.value.sgRefs], [atT.value.address, atT.value.sgRefs]];
  const unsure = flags.find(([, f]) => !f.ok);
  if (unsure && !unsure[1].ok) return { use: "unknown", why: unsure[1].reason };
  const off = flags.filter(([, f]) => f.ok && !f.value).map(([n]) => n);
  // "will only work if it has been enabled for both a transit gateway and its VPC attachments"
  return off.length ? { use: false, why: `security group referencing is not enabled on ${off.join(", ")}` } : USE_GROUPS;
}

/**
 * The route from a subnet to a subnet in another VPC through a transit gateway, in six
 * steps (docs/semantics/transit-gateway.md, "Hops"). `ownAz`: the sender's zone.
 * https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html
 * https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html
 */
function transitStep(table: Known<RouteTable>, at: string, peerCidr: IntervalSet, peer: string, own: Vpc, peerVpc: Vpc, ownAz: Known<string> | undefined, transit: Known<Transit> | undefined): Step {
  const fail = (decision: "deny" | "unknown", resource: string, why: string): Step => ({ decision, resource, rule: why, reason: why });
  if (!table.ok) return fail("unknown", at, table.reason);
  const t = table.value;
  if (!t.routes.ok) return fail("unknown", t.resource, t.routes.reason);
  // "A transit gateway doesn't support routing between VPCs with identical CIDRs"
  if (own.cidrs.ok && peerVpc.cidrs.ok && !isEmpty(intersect(own.cidrs.value, peerVpc.cidrs.value))) return fail("unknown", own.address, `${own.address} and ${peerVpc.address} have overlapping CIDR blocks; a transit gateway does not route between them`);

  // 1. The sender's route table sends the whole other subnet to one transit gateway.
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const texts: string[] = [];
  let tgw: string | undefined;
  for (const [i, route] of routes.entries()) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    if (routes.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return fail("unknown", t.resource, `${t.resource} has more than one route for the same destination`);
    texts.push(route.text);
    const target = route.target;
    if (target.kind === "other" && target.tgw) {
      if (!target.tgw.ok) return fail("unknown", t.resource, target.tgw.reason);
      if (tgw && tgw !== target.tgw.value) return fail("unknown", t.resource, `${t.resource} sends the subnet of ${peer} to more than one transit gateway`);
      tgw = target.tgw.value;
    } else if (target.kind === "drop") return fail(equals(m, peerCidr) ? "deny" : "unknown", t.resource, `${route.text}: ${target.why}${equals(m, peerCidr) ? "" : `, for part of the subnet of ${peer}`}`);
    else if (target.kind === "unknown") return fail("unknown", t.resource, target.reason);
    else return fail("unknown", t.resource, `${route.text} sends part of the subnet of ${peer} to a ${target.kind === "other" ? target.text : target.kind}, so the path through the transit gateway is not the only one`);
    remaining = subtract(remaining, m);
  }
  if (!isEmpty(remaining) || !tgw) return fail("deny", t.resource, `${t.resource} has no route to the subnet of ${peer} in ${peerVpc.address}`);

  // 2. The transit gateway and the sender's attachment.
  if (!transit) return fail("unknown", tgw, "transit gateways are not known");
  if (!transit.ok) return fail("unknown", tgw, transit.reason);
  const tr = transit.value;
  if (!tr.gateways.has(tgw)) return fail("unknown", tgw, `${tgw} is not a transit gateway in this plan`);
  const mine = attachmentOf(tr, tgw, own.address);
  if (!mine.ok) return fail("unknown", tgw, mine.reason);
  const att = mine.value;

  // 3. "Only resources that reside in Availability Zones where there is a transit gateway attachment can reach the transit gateway."
  if (!ownAz) return fail("unknown", at, `the Availability Zone of ${at} is not known`);
  if (!ownAz.ok) return fail("unknown", at, ownAz.reason);
  if (!att.subnets.ok) return fail("unknown", att.address, att.subnets.reason);
  const zones = att.subnets.value.map((s) => s.az);
  if (!zones.some((z) => z.ok && z.value === ownAz.value)) {
    const unsure = zones.find((z) => !z.ok);
    if (unsure && !unsure.ok) return fail("unknown", att.address, unsure.reason);
    return fail("deny", att.address, `${at} is in ${ownAz.value}, where ${att.address} has no subnet; only resources in Availability Zones with a transit gateway attachment can reach the transit gateway`);
  }

  // 4. The associated transit gateway route table.
  if (!att.association.ok) return fail("unknown", att.address, att.association.reason);
  const key = att.association.value;
  if (key === null) return fail("deny", att.address, `${att.address} is not associated with a transit gateway route table, so ${tgw} has no route for its traffic`);
  const name = tr.names.get(key) ?? key;
  const tgwRoutes = tr.routes.get(key);
  if (!tgwRoutes) return fail("unknown", name, `${name} is not in this plan`);
  if (!tgwRoutes.ok) return fail("unknown", name, tgwRoutes.reason);

  // 5. Longest prefix match; a static route wins over a propagated one with the same destination.
  const live = tgwRoutes.value.filter((r) => r.static || !tgwRoutes.value.some((o) => o.static && equals(o.cidr, r.cidr)));
  const ordered = live.toSorted((a, b) => b.prefix - a.prefix);
  let rest = peerCidr;
  const tgwTexts: string[] = [];
  let peerAtt: string | undefined;
  for (const [i, route] of ordered.entries()) {
    const m = intersect(rest, route.cidr);
    if (isEmpty(m)) continue;
    if (ordered.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return fail("unknown", name, `${name} has more than one route for the same destination`);
    // "the routes for the newly attached VPC aren't propagated": which one wins depends on the order of attachment.
    const clash = route.from ? ordered.find((o) => o.from && o.from !== route.from && !isEmpty(intersect(intersect(o.cidr, route.cidr), peerCidr))) : undefined;
    if (clash) return fail("unknown", name, `${route.text} overlaps ${clash.text}; a transit gateway propagates only the route of the VPC attached first`);
    tgwTexts.push(route.text);
    const target = route.target;
    const whole = equals(m, peerCidr);
    if (target.kind === "blackhole") return fail(whole ? "deny" : "unknown", name, `${route.text}: the transit gateway drops traffic that matches a blackhole route${whole ? "" : `, for part of the subnet of ${peer}`}`);
    if (target.kind === "unknown") return fail("unknown", name, target.reason);
    const dest = tr.attachments.find((a) => a.address === target.address);
    if (!dest) return fail("unknown", name, `${target.address} is not a VPC attachment in this plan`);
    if (dest.vpc !== peerVpc.address) return fail(whole ? "deny" : "unknown", name, `${route.text} sends the subnet of ${peer} to ${dest.address} of ${dest.vpc}, not to ${peerVpc.address}`);
    if (peerAtt && peerAtt !== dest.address) return fail("unknown", name, `${name} sends the subnet of ${peer} to more than one attachment`);
    peerAtt = dest.address;
    rest = subtract(rest, m);
  }
  if (!isEmpty(rest) || !peerAtt) return fail("deny", name, `${name} has no route to the subnet of ${peer}`);

  // 6. The traffic enters the other VPC at an attachment subnet; there the local route must reach the subnet.
  const entry = tr.attachments.find((a) => a.address === peerAtt) as TgwAttachment;
  if (!entry.subnets.ok) return fail("unknown", entry.address, entry.subnets.reason);
  for (const s of entry.subnets.value) {
    const step = routeStep(s.table, s.address, peerCidr, peer);
    if (step.decision !== "allow") return fail("unknown", entry.address, `traffic from ${tgw} can enter ${peerVpc.address} at ${s.address}, and there: ${step.reason ?? step.rule}`);
  }
  const zone = `${att.address} has a subnet in ${ownAz.value}`;
  return { decision: "allow", resource: t.resource, rule: `${texts.join("; ")}; ${zone}; ${att.address} uses ${name}: ${tgwTexts.join("; ")}` };
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
  const doubts: string[] = [];
  const run = (hop: HopKind, s: Step): Outcome | undefined => {
    if (s.doubt) doubts.push(s.doubt);
    hops.push({ hop, resource: s.resource, decision: s.decision, rule: s.rule, doc: s.doc ?? DOC[hop] ?? SG_DOC });
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

  // Between VPCs through a transit gateway: group references follow other rules (rule 8 of transit-gateway.md).
  const crossVpc = a.vpc.ok && t.vpc.ok && a.vpc.value.address !== t.vpc.value.address;
  const viaTgw = crossVpc ? transitOf(a.routeTable, tCidr) : undefined;

  // 1. Outbound rules of the source's groups (the request starts at the source).
  // "Outbound security rules do not support security group referencing." https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html#vpc-attachment-security
  const egressRefs: GroupRefs = viaTgw ? { use: false, why: "outbound rules cannot reference security groups across a transit gateway" } : USE_GROUPS;
  const out = run("source-security-group", sgStep(a.securityGroups.value, "egress", tKeys, tCidr, t.address, p, ports, egressRefs));
  if (out) return out;

  // 2. Same VPC, and the local route to the target's subnet.
  if (!a.vpc.ok) return fail("source-route", a.address, a.vpc.reason);
  if (!t.vpc.ok) return fail("source-route", t.address, t.vpc.reason);
  const peered = a.vpc.value.address !== t.vpc.value.address;
  const cross = (from: Endpoint, to: Endpoint, cidr: IntervalSet, own: Vpc, other: Vpc): Step =>
    transitOf(from.routeTable, cidr) ? { ...transitStep(from.routeTable, from.subnet.ok ? from.subnet.value : from.address, cidr, to.address, own, other, from.az, from.transit), doc: TGW_DOC } : peeringStep(from.routeTable, from.address, cidr, to.address, own, other);
  const r1 = run("source-route", peered ? cross(a, t, tCidr, a.vpc.value, t.vpc.value) : routeStep(a.routeTable, a.address, tCidr, t.address));
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
  const ingressRefs = viaTgw ? transitGroupRefs(a.transit, viaTgw, a.vpc.value, t.vpc.value) : USE_GROUPS;
  const sg = run("security-group", sgStep(t.securityGroups.value, "ingress", aKeys, aCidr, a.address, p, ports, ingressRefs));
  if (sg) return sg;

  // 6, 7. The response leaves the target subnet and enters the source subnet (NACLs are stateless).
  const n6 = run("target-nacl-outbound", same ? skip(t) : naclStep(t.nacl, at(t), "egress", aCidr, a.address, p, ports, true));
  if (n6) return n6;
  const n7 = run("source-nacl-inbound", same ? skip(a) : naclStep(a.nacl, at(a), "ingress", tCidr, t.address, p, ports, true));
  if (n7) return n7;

  // 8. The local route back to the source's subnet.
  const r8 = run("target-route", peered ? cross(t, a, aCidr, t.vpc.value, a.vpc.value) : routeStep(t.routeTable, t.address, aCidr, a.address));
  if (r8) return r8;

  return { verdict: "allowed", sources: [a.address], hops, reason: doubts.join("; ") };
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
