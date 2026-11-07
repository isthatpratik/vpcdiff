// src/index.ts
import { appendFileSync, readFileSync } from "node:fs";

// ../engine/src/intervals.ts
var EMPTY = [];
var IPV4_MAX = 4294967295;
var ALL_IPV4 = [[0, IPV4_MAX]];
var ALL_PORTS = [[0, 65535]];
function fromRanges(ranges) {
  const sorted = ranges.filter(([lo, hi]) => lo <= hi).toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
function union(a, b) {
  return fromRanges([...a, ...b]);
}
function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [alo, ahi] = a[i];
    const [blo, bhi] = b[j];
    const lo = Math.max(alo, blo);
    const hi = Math.min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
    if (ahi < bhi) i++;
    else j++;
  }
  return out;
}
function subtract(a, b) {
  const out = [];
  for (const [lo, hi] of a) {
    let start = lo;
    for (const [blo, bhi] of b) {
      if (bhi < start || blo > hi) continue;
      if (blo > start) out.push([start, blo - 1]);
      start = bhi + 1;
      if (start > hi) break;
    }
    if (start <= hi) out.push([start, hi]);
  }
  return out;
}
function isEmpty(a) {
  return a.length === 0;
}
function equals(a, b) {
  return a.length === b.length && a.every(([lo, hi], i) => lo === b[i]?.[0] && hi === b[i]?.[1]);
}
function contains(outer, inner) {
  return isEmpty(subtract(inner, outer));
}
function parseIpv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return void 0;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return void 0;
    const v = Number(p);
    if (v > 255) return void 0;
    n = n * 256 + v;
  }
  return n;
}
function formatIpv4(n) {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
}
function cidrToSet(cidr) {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return void 0;
  const addr = parseIpv4(m[1]);
  const len = Number(m[2]);
  if (addr === void 0 || len > 32) return void 0;
  const size = 2 ** (32 - len);
  const lo = Math.floor(addr / size) * size;
  return [[lo, lo + size - 1]];
}
function cidrPrefixLength(cidr) {
  return cidrToSet(cidr) ? Number(cidr.split("/")[1]) : void 0;
}
function setToCidrs(set) {
  const out = [];
  for (const [lo, hi] of set) {
    let start = lo;
    while (start <= hi) {
      let size = 1;
      while (start % (size * 2) === 0 && start + size * 2 - 1 <= hi) size *= 2;
      out.push(`${formatIpv4(start)}/${32 - Math.log2(size)}`);
      start += size;
    }
  }
  return out;
}
function formatPorts(set) {
  return set.map(([lo, hi]) => lo === hi ? `${lo}` : `${lo}-${hi}`).join(", ");
}

// ../engine/src/evaluate.ts
var DOC = {
  "public-ip": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "internet-gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html",
  "security-group": "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
  "nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  route: "https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html"
};
var EPHEMERAL = [[1024, 65535]];
var NOT_INTERNET = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4"];
var PUBLIC_IPV4 = NOT_INTERNET.reduce((set, c) => subtract(set, cidrToSet(c) ?? EMPTY), ALL_IPV4);
function internetOf(ep) {
  return ep.vpc.ok && ep.vpc.value.cidrs.ok ? subtract(PUBLIC_IPV4, ep.vpc.value.cidrs.value) : PUBLIC_IPV4;
}
var protoMatches = (rule, p) => rule === "all" || rule === p;
function segment(set, cuts) {
  const points = /* @__PURE__ */ new Set();
  for (const c of cuts) for (const [lo, hi] of c) points.add(lo).add(hi + 1);
  const sorted = [...points].toSorted((a, b) => a - b);
  const out = [];
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
function naclEval(rules, addrs, p, ports) {
  let remaining = addrs;
  let allowed = EMPTY;
  const texts = [];
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
var absent = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
function evaluate(ep, p, ports) {
  if (!ep) return absent;
  const hops = [];
  const universe = internetOf(ep);
  const portText = `${p}/${formatPorts([ports])}`;
  const add = (hop, resource, decision, rule) => hops.push({ hop, resource, decision, rule, doc: DOC[hop] });
  const undecided = [];
  const cidrList = (set) => {
    const list = setToCidrs(set);
    return list.length > 6 ? `${list.slice(0, 6).join(", ")} and ${list.length - 6} more` : list.join(", ");
  };
  const stop = (verdict, reason) => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop, resource, reason) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  if (!ep.publicIp.ok) return unknownAt("public-ip", ep.address, ep.publicIp.reason);
  if (!ep.publicIp.value) {
    add("public-ip", ep.address, "deny", `${ep.address} has no public IPv4 address`);
    return stop("blocked", `${ep.address} has no public IPv4 address`);
  }
  add("public-ip", ep.address, "allow", ep.publicIp.value);
  if (!ep.vpc.ok) return unknownAt("internet-gateway", ep.address, ep.vpc.reason);
  const vpc = ep.vpc.value;
  if (!vpc.igw.ok) return unknownAt("internet-gateway", vpc.address, vpc.igw.reason);
  if (!vpc.igw.value) {
    const table2 = ep.routeTable.ok ? ep.routeTable.value : void 0;
    const external = !table2 || !table2.routes.ok ? table2?.routes.ok === false ? table2.routes.reason : ep.routeTable.ok ? "" : ep.routeTable.reason : table2.routes.value.filter((r) => r.target.kind === "unknown").map((r) => r.text).join("; ");
    if (external) return unknownAt("internet-gateway", vpc.address, `no internet gateway for ${vpc.address} is in this plan, but its route table may use one managed elsewhere: ${external}`);
    add("internet-gateway", vpc.address, "deny", `no internet gateway is attached to ${vpc.address}`);
    return stop("blocked", `no internet gateway is attached to ${vpc.address}`);
  }
  const igw = vpc.igw.value;
  add("internet-gateway", igw, "allow", `${igw} is attached to ${vpc.address}`);
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
  if (!ep.securityGroups.ok) return unknownAt("security-group", ep.address, ep.securityGroups.reason);
  const groups = ep.securityGroups.value;
  const sgNames = groups.map((g) => g.address).join(", ");
  let sgAllowed = EMPTY;
  const sgTexts = [];
  const sgDoubt = [];
  for (const g of groups) {
    if (!g.ingress.ok) return unknownAt("security-group", g.address, g.ingress.reason);
    for (const rule of g.ingress.value) {
      if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      if (rule.listUnresolved) sgDoubt.push(`${rule.text}: ${rule.listUnresolved}`);
      if (isEmpty(intersect(rule.sources, sources))) continue;
      sgAllowed = union(sgAllowed, rule.sources);
      sgTexts.push(rule.text);
    }
  }
  const afterSg = intersect(sources, sgAllowed);
  if (isEmpty(afterSg) && sgDoubt.length) return unknownAt("security-group", sgNames, sgDoubt.join("; "));
  if (sgDoubt.length && !equals(afterSg, sources)) undecided.push(`sources in ${sgDoubt.join("; ")}`);
  if (isEmpty(afterSg)) {
    add("security-group", sgNames, "deny", `no ingress rule of ${sgNames} allows ${portText} from the internet`);
    return stop("blocked", `no ingress rule of ${sgNames} allows ${portText} from the internet`);
  }
  add("security-group", sgNames, equals(afterSg, sources) ? "allow" : "partial", sgTexts.join("; "));
  sources = afterSg;
  if (!nacl.egress.ok) return unknownAt("nacl-outbound", nacl.resource, nacl.egress.reason);
  const egress = nacl.egress.value;
  let full = sources;
  let some = EMPTY;
  const outTexts = /* @__PURE__ */ new Set();
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
  if (!ep.routeTable.ok) return unknownAt("route", ep.subnet.ok ? ep.subnet.value : ep.address, ep.routeTable.reason);
  const table = ep.routeTable.value;
  if (!table.routes.ok) return unknownAt("route", table.resource, table.routes.reason);
  const routes = table.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = sources;
  let viaIgw = EMPTY;
  let unresolved = EMPTY;
  const routeTexts = [];
  const unresolvedReasons = [];
  const dropped = [];
  const listDoubt = routes.filter((r) => r.listUnresolved).map((r) => `${r.text}: ${r.listUnresolved}`);
  for (const [i, route] of routes.entries()) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    if (routes.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return unknownAt("route", table.resource, `${table.resource} has more than one route for the same destination`);
    routeTexts.push(route.text);
    if (route.target.kind === "igw" && route.target.address === igw) viaIgw = union(viaIgw, m);
    else if (route.target.kind === "unknown") {
      unresolved = union(unresolved, m);
      unresolvedReasons.push(route.target.reason);
    } else if (route.target.kind === "drop") {
      dropped.push(`${route.text}: ${route.target.why}`);
    } else if (route.target.kind === "other") {
      unresolved = union(unresolved, m);
      unresolvedReasons.push(`${route.text}: responses through a ${route.target.text} are not modeled yet`);
    }
    remaining = subtract(remaining, m);
  }
  if (isEmpty(viaIgw)) {
    if (!isEmpty(unresolved) || listDoubt.length) return unknownAt("route", table.resource, [...unresolvedReasons, ...listDoubt].join("; "));
    const why = dropped.length ? dropped.join("; ") : routeTexts.length ? routeTexts.join("; ") : `${table.resource} has no route to the internet`;
    add("route", table.resource, "deny", why);
    return stop("blocked", `the response cannot return to the internet: ${why}`);
  }
  if (!isEmpty(unresolved)) undecided.push(`responses to ${cidrList(unresolved)} cannot be decided: ${unresolvedReasons.join("; ")}`);
  if (listDoubt.length) undecided.push(`responses to addresses in a prefix list may use another route: ${listDoubt.join("; ")}`);
  add("route", table.resource, equals(viaIgw, sources) ? "allow" : "partial", routeTexts.join("; "));
  return { verdict: "allowed", sources: equals(viaIgw, universe) ? ["internet"] : setToCidrs(viaIgw), hops, reason: undecided.join("; ") };
}
function exposedPorts(ep, p) {
  if (!ep) return EMPTY;
  if (!ep.securityGroups.ok || ep.securityGroups.value.some((g) => !g.ingress.ok)) return ALL_PORTS;
  const universe = internetOf(ep);
  let out = EMPTY;
  for (const g of ep.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) {
      if (protoMatches(rule.protocol, p) && (rule.listUnresolved || !isEmpty(intersect(rule.sources, universe)))) out = union(out, rule.ports);
    }
  }
  return out;
}
function portCuts(ep) {
  if (!ep) return [];
  const cuts = [];
  if (ep.securityGroups.ok) {
    for (const g of ep.securityGroups.value) if (g.ingress.ok) cuts.push(...g.ingress.value.map((r) => r.ports));
  }
  if (ep.nacl.ok && ep.nacl.value.ingress.ok) cuts.push(...ep.nacl.value.ingress.value.map((r) => r.ports));
  return cuts;
}

// ../engine/src/internal.ts
var SG_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html";
var NACL_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html";
var ROUTE_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html";
var DOC2 = {
  "source-security-group": SG_DOC,
  "source-route": ROUTE_DOC,
  "source-nacl-outbound": NACL_DOC,
  "target-nacl-inbound": NACL_DOC,
  "security-group": SG_DOC,
  "target-nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  "source-nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  "target-route": ROUTE_DOC
};
var SAME_SUBNET = "same subnet: no network ACL applies";
var protoMatches2 = (rule, p) => rule === "all" || rule === p;
function groupKeys(ep) {
  return ep.securityGroups.ok ? { ok: true, value: ep.securityGroups.value.map((g) => g.key) } : ep.securityGroups;
}
function sgStep(groups, dir, peerKeys, peerCidr, peer, p, ports) {
  const names = groups.map((g) => g.address).join(", ") || "no security groups";
  const allowing = [];
  const doubt = [];
  for (const g of groups) {
    const rules = g[dir];
    if (!rules.ok) return { decision: "unknown", resource: g.address, rule: rules.reason, reason: rules.reason };
    for (const rule of rules.value) {
      if (!protoMatches2(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      if (rule.groups.some((k) => peerKeys.includes(k)) || contains(rule.sources, peerCidr)) allowing.push(rule.text);
      else if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
      else if (rule.unresolved) doubt.push(`${rule.text}: ${rule.unresolved}`);
      else if (rule.listUnresolved) doubt.push(`${rule.text}: ${rule.listUnresolved}`);
    }
  }
  const portText = `${p}/${formatPorts([ports])}`;
  if (allowing.length) return { decision: "allow", resource: names, rule: allowing.join("; ") };
  if (doubt.length) return { decision: "unknown", resource: names, rule: doubt.join("; "), reason: doubt.join("; ") };
  const what = dir === "egress" ? `no egress rule of ${names} allows ${portText} to ${peer}` : `no ingress rule of ${names} allows ${portText} from ${peer}`;
  return { decision: "deny", resource: names, rule: what, reason: what };
}
function routeStep(table, at, peerCidr, peer) {
  if (!table.ok) return { decision: "unknown", resource: at, rule: table.reason, reason: table.reason };
  const t = table.value;
  if (!t.routes.ok) return { decision: "unknown", resource: t.resource, rule: t.routes.reason, reason: t.routes.reason };
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  const listDoubt = routes.filter((r) => r.listUnresolved).map((r) => `${r.text}: ${r.listUnresolved}`);
  let remaining = peerCidr;
  let local = EMPTY;
  const texts = [];
  const elsewhere = [];
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
  return { decision: "allow", resource: t.resource, rule: texts.join("; "), ...listDoubt.length ? { doubt: `traffic to the subnet of ${peer} may match a prefix list route instead: ${listDoubt.join("; ")}` } : {} };
}
function naclStep(nacl, at, dir, peerCidr, peer, p, ports, ephemeral) {
  if (!nacl.ok) return { decision: "unknown", resource: at, rule: nacl.reason, reason: nacl.reason };
  const n = nacl.value;
  const rules = n[dir];
  if (!rules.ok) return { decision: "unknown", resource: n.resource, rule: rules.reason, reason: rules.reason };
  const segs = ephemeral ? segment(EPHEMERAL, rules.value.map((r) => r.ports)) : [ports];
  const texts = /* @__PURE__ */ new Set();
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
var absent2 = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
function evaluateInternal(a, t, p, ports) {
  if (!a || !t) return absent2;
  const hops = [];
  const doubts = [];
  const run2 = (hop, s) => {
    if (s.doubt) doubts.push(s.doubt);
    hops.push({ hop, resource: s.resource, decision: s.decision, rule: s.rule, doc: DOC2[hop] ?? SG_DOC });
    if (s.decision === "deny") return { verdict: "blocked", sources: [], hops, reason: s.reason ?? s.rule };
    if (s.decision === "unknown") return { verdict: "unknown", sources: [], hops, reason: s.reason ?? s.rule };
    return void 0;
  };
  const fail = (hop, at2, reason) => run2(hop, { decision: "unknown", resource: at2, rule: reason, reason });
  if (!a.securityGroups.ok) return fail("source-security-group", a.address, a.securityGroups.reason);
  if (!t.securityGroups.ok) return fail("source-security-group", t.address, t.securityGroups.reason);
  if (!a.subnetCidr.ok) return fail("source-security-group", a.address, a.subnetCidr.reason);
  if (!t.subnetCidr.ok) return fail("source-security-group", t.address, t.subnetCidr.reason);
  const aKeys = a.securityGroups.value.map((g) => g.key);
  const tKeys = t.securityGroups.value.map((g) => g.key);
  const aCidr = a.subnetCidr.value;
  const tCidr = t.subnetCidr.value;
  const out = run2("source-security-group", sgStep(a.securityGroups.value, "egress", tKeys, tCidr, t.address, p, ports));
  if (out) return out;
  if (!a.vpc.ok) return fail("source-route", a.address, a.vpc.reason);
  if (!t.vpc.ok) return fail("source-route", t.address, t.vpc.reason);
  if (a.vpc.value.address !== t.vpc.value.address) return fail("source-route", a.address, `${a.address} and ${t.address} are in different VPCs (${a.vpc.value.address}, ${t.vpc.value.address}); peering and Transit Gateway are not modeled yet`);
  const r1 = run2("source-route", routeStep(a.routeTable, a.address, tCidr, t.address));
  if (r1) return r1;
  const same = a.subnet.ok && t.subnet.ok && a.subnet.value === t.subnet.value;
  const at = (ep) => ep.subnet.ok ? ep.subnet.value : ep.address;
  const skip = (ep) => ({ decision: "allow", resource: at(ep), rule: SAME_SUBNET });
  const n3 = run2("source-nacl-outbound", same ? skip(a) : naclStep(a.nacl, at(a), "egress", tCidr, t.address, p, ports, false));
  if (n3) return n3;
  const n4 = run2("target-nacl-inbound", same ? skip(t) : naclStep(t.nacl, at(t), "ingress", aCidr, a.address, p, ports, false));
  if (n4) return n4;
  const sg = run2("security-group", sgStep(t.securityGroups.value, "ingress", aKeys, aCidr, a.address, p, ports));
  if (sg) return sg;
  const n6 = run2("target-nacl-outbound", same ? skip(t) : naclStep(t.nacl, at(t), "egress", aCidr, a.address, p, ports, true));
  if (n6) return n6;
  const n7 = run2("source-nacl-inbound", same ? skip(a) : naclStep(a.nacl, at(a), "ingress", tCidr, t.address, p, ports, true));
  if (n7) return n7;
  const r8 = run2("target-route", routeStep(t.routeTable, t.address, aCidr, a.address));
  if (r8) return r8;
  return { verdict: "allowed", sources: [a.address], hops, reason: doubts.join("; ") };
}
function referencedPorts(a, t, p) {
  const keys = groupKeys(a);
  if (!keys.ok || !t.securityGroups.ok) return EMPTY;
  let out = EMPTY;
  for (const g of t.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) if (protoMatches2(rule.protocol, p) && rule.groups.some((k) => keys.value.includes(k))) out = union(out, rule.ports);
  }
  return out;
}
function internalCuts(ep) {
  const cuts = [];
  if (ep.securityGroups.ok) {
    for (const g of ep.securityGroups.value) for (const dir of [g.ingress, g.egress]) if (dir.ok) cuts.push(...dir.value.map((r) => r.ports));
  }
  if (ep.nacl.ok) {
    for (const dir of [ep.nacl.value.ingress, ep.nacl.value.egress]) if (dir.ok) cuts.push(...dir.value.map((r) => r.ports));
  }
  return cuts;
}

// ../engine/src/plan.ts
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var PlanError = class extends Error {
};
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var stripKeys = (address) => address.replace(/\[[^\]]*\]/g, "");
var RESOURCE_REF = /^aws_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.|$)/;
function configRefs(plan) {
  const out = /* @__PURE__ */ new Map();
  const walkModule = (mod, prefix) => {
    if (!isObj(mod)) return;
    for (const r of Array.isArray(mod.resources) ? mod.resources : []) {
      if (!isObj(r) || r.mode !== "managed") continue;
      const info = { refs: {}, fullRefs: {}, configured: /* @__PURE__ */ new Set(), otherRefs: /* @__PURE__ */ new Set() };
      for (const [attr, expr] of Object.entries(isObj(r.expressions) ? r.expressions : {})) {
        info.configured.add(attr);
        const found = /* @__PURE__ */ new Set();
        const full = /* @__PURE__ */ new Set();
        collect(expr, (ref) => {
          const m = /^(aws_\w+\.[\w-]+(?:\[[^\]]+\])?)$/.exec(ref);
          if (m) found.add(prefix + m[1]);
          if (RESOURCE_REF.test(ref)) full.add(prefix + ref);
          else info.otherRefs.add(attr);
        });
        if (found.size) info.refs[attr] = [...found].sort(cmp);
        if (full.size) info.fullRefs[attr] = [...full].sort(cmp);
      }
      out.set(prefix + String(r.address), info);
    }
    for (const [name, call] of Object.entries(isObj(mod.module_calls) ? mod.module_calls : {})) {
      if (isObj(call)) walkModule(call.module, `${prefix}module.${name}.`);
    }
  };
  walkModule(isObj(plan.configuration) ? plan.configuration.root_module : void 0, "");
  return out;
}
function collect(v, add) {
  if (Array.isArray(v)) v.forEach((x) => collect(x, add));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === "references" && Array.isArray(x)) x.forEach((r) => typeof r === "string" && add(r));
      else collect(x, add);
    }
  }
}
function parsePlan(input2) {
  if (!isObj(input2) || typeof input2.format_version !== "string" || !input2.format_version.startsWith("1.")) {
    throw new PlanError("Not a Terraform plan: expected `terraform show -json` output with format_version 1.x.");
  }
  if (!Array.isArray(input2.resource_changes)) throw new PlanError("Plan has no resource_changes.");
  const refs = configRefs(input2);
  const before = { side: "before", resources: /* @__PURE__ */ new Map(), byId: /* @__PURE__ */ new Map(), instancesOf: /* @__PURE__ */ new Map() };
  const after = { side: "after", resources: /* @__PURE__ */ new Map(), byId: /* @__PURE__ */ new Map(), instancesOf: /* @__PURE__ */ new Map() };
  const changes = input2.resource_changes.filter(isObj).toSorted((a, b) => cmp(String(a.address), String(b.address)));
  for (const rc of changes) {
    if (rc.mode !== "managed" || !isObj(rc.change)) continue;
    const address = String(rc.address);
    const type = String(rc.type);
    const actions = Array.isArray(rc.change.actions) ? rc.change.actions.map(String) : [];
    const base = stripKeys(address);
    const info = refs.get(base) ?? { refs: {}, fullRefs: {}, configured: /* @__PURE__ */ new Set(), otherRefs: /* @__PURE__ */ new Set() };
    const sides = [
      [before, rc.change.before, false],
      [after, rc.change.after, rc.change.after_unknown ?? false]
    ];
    for (const [snap, values, unknown2] of sides) {
      if (!isObj(values)) continue;
      snap.resources.set(address, { address, type, values, unknown: unknown2, refs: info.refs, fullRefs: info.fullRefs, configured: info.configured, otherRefs: info.otherRefs, actions });
      if (typeof values.id === "string") snap.byId.set(values.id, address);
      const list = snap.instancesOf.get(base) ?? [];
      list.push(address);
      snap.instancesOf.set(base, list);
    }
  }
  return { before, after };
}
function isUnknown(r, path) {
  let u = r.unknown;
  for (const step of path) {
    if (u === true) return true;
    if (Array.isArray(u) && typeof step === "number") u = u[step];
    else if (isObj(u) && typeof step === "string") u = u[step];
    else return false;
  }
  return u === true;
}
function hasUnknown(r, path) {
  if (isUnknown(r, path)) return true;
  let u = r.unknown;
  for (const step of path) {
    if (Array.isArray(u) && typeof step === "number") u = u[step];
    else if (isObj(u) && typeof step === "string") u = u[step];
    else return false;
  }
  const any = (v) => v === true || (Array.isArray(v) ? v.some(any) : isObj(v) ? Object.values(v).some(any) : false);
  return any(u);
}
var refOrder = (r) => r.kind === "resource" ? `0${r.address}` : r.kind === "external" ? `1${r.id}` : `2${r.reason}`;
function resolveRefs(snap, r, attr, targetType) {
  const value = r.values[attr];
  const fail = (reason) => [{ kind: "unknown", reason }];
  if (!isUnknown(r, [attr])) {
    if (value === null || value === void 0) return [];
    const items = Array.isArray(value) ? value : [value];
    const known2 = [];
    let unknownCount = 0;
    items.forEach((v, i) => {
      if (typeof v === "string" && !isUnknown(r, Array.isArray(value) ? [attr, i] : [attr])) {
        const address = snap.byId.get(v);
        known2.push(address ? { kind: "resource", address } : { kind: "external", id: v });
      } else unknownCount++;
    });
    if (!unknownCount) return known2.toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
    if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
    const knownAddresses = new Set(known2.flatMap((k) => k.kind === "resource" ? [stripKeys(k.address)] : []));
    const rest = fromConfig(snap, r, attr, targetType).filter((x) => !(x.kind === "resource" && knownAddresses.has(stripKeys(x.address))));
    if (rest.length !== unknownCount || rest.some((x) => x.kind !== "resource")) return fail(`${r.address}: ${attr} has elements that are unknown until apply and cannot be matched to resources`);
    return [...known2, ...rest].toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
  }
  if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
  return fromConfig(snap, r, attr, targetType).toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
}
var ADDRESS = /^(.*?)(aws_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.\w+)?)$/;
function localize(from, ref) {
  const prefix = ADDRESS.exec(from)?.[1] ?? "";
  return prefix + (ADDRESS.exec(ref)?.[2] ?? ref);
}
function instanceOf(snap, t) {
  if (snap.resources.has(t)) return t;
  const instances = [...snap.resources.keys()].filter((a) => a.startsWith(t) && stripKeys(a.slice(t.length)) === "");
  return instances.length === 1 ? instances[0] : void 0;
}
function fromConfig(snap, r, attr, targetType) {
  const types = Array.isArray(targetType) ? targetType : [targetType];
  const targets = (r.refs[attr] ?? []).filter((a) => types.includes(stripKeys(a).split(".").at(-2) ?? ""));
  if (!targets.length) return [{ kind: "unknown", reason: `${r.address}: ${attr} is unknown until apply and has no resource reference` }];
  return targets.map((ref) => {
    const t = localize(r.address, ref);
    if (snap.resources.has(t)) return { kind: "resource", address: t };
    const instances = [...snap.resources.keys()].filter((a) => a.startsWith(t) && stripKeys(a.slice(t.length)) === "");
    if (instances.length === 1) return { kind: "resource", address: instances[0] };
    return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${t}, which has ${instances.length} instances on the ${snap.side} side` };
  });
}
function resolveRef(snap, r, attr, targetType) {
  const refs = resolveRefs(snap, r, attr, targetType);
  if (refs.length === 1) return refs[0];
  if (!refs.length) return { kind: "unknown", reason: `${r.address}: ${attr} is not set` };
  return { kind: "unknown", reason: `${r.address}: ${attr} refers to ${refs.length} resources` };
}

// ../engine/src/model.ts
var known = (value) => ({ ok: true, value });
var unknown = (reason) => ({ ok: false, reason });
var UNMODELED_ROUTES = ["aws_vpn_gateway_route_propagation"];
var UNMODELED_INSTANCE = ["aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
var UNMODELED = /* @__PURE__ */ new Set([...UNMODELED_ROUTES, ...UNMODELED_INSTANCE]);
var VPC_DEFAULTS = [
  ["default_route_table_id", "default-rt"],
  ["main_route_table_id", "main-rt"],
  ["default_network_acl_id", "default-nacl"],
  ["default_security_group_id", "default-sg"]
];
var DROP = {
  nat_gateway_id: { text: "nat gateway", why: "a NAT gateway does not carry traffic for connections that start on the internet" },
  vpc_peering_connection_id: { text: "vpc peering connection", why: "a peered VPC cannot use another VPC's internet gateway (no edge to edge routing)" }
};
var BLACKHOLE = { text: "blackhole", why: "the route's target no longer exists, so AWS drops the traffic (route state blackhole)" };
var dropOf = (key) => {
  const d = DROP[key];
  return d ? { kind: "drop", ...d } : void 0;
};
var NO_LISTS = { set: [], entries: [], names: [] };
var groupLabel = (key) => key.startsWith("default-sg:") ? `default security group of ${key.slice("default-sg:".length)}` : key;
var fullRefsHasAttr = (refs, ref) => refs.some((o) => o.startsWith(`${ref}.`));
function subnetCidrOf(s) {
  const cidr = typeof s.values.cidr_block === "string" ? s.values.cidr_block : void 0;
  const set = cidr && !isUnknown(s, ["cidr_block"]) ? cidrToSet(cidr) : void 0;
  return set ? known(set) : unknown(`${s.address}: cidr_block is unknown until apply`);
}
var typeOf = (address) => address.replace(/\[[^\]]*\]/g, "").split(".").at(-2) ?? "";
var str = (v) => typeof v === "string" && v !== "" ? v : void 0;
var num = (v) => typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : void 0;
var arr = (v) => Array.isArray(v) ? v : [];
var isNull = (r, attr) => isUnknown(r, [attr]) ? !r.configured.has(attr) : r.values[attr] === null || r.values[attr] === void 0 || r.values[attr] === "";
function normalizeProtocol(p) {
  const s = String(p).toLowerCase();
  if (s === "-1" || s === "all") return "all";
  if (s === "tcp" || s === "6") return "tcp";
  if (s === "udp" || s === "17") return "udp";
  return "other";
}
function portSet(protocol, from, to) {
  if (protocol === "all") return ALL_PORTS;
  const lo = num(from);
  const hi = num(to);
  if (lo === void 0 || hi === void 0) return void 0;
  return fromRanges([[Math.max(0, lo), Math.min(65535, hi)]]);
}
var describePorts = (protocol, from, to) => protocol === "all" ? "all traffic" : `${protocol} ${from === to ? String(from) : `${String(from)}-${String(to)}`}`;
var localRoutes = (vpc, table, cidrs) => cidrs.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `${table} local route` }));
var Index = class {
  byKey = /* @__PURE__ */ new Map();
  /** Set when a rule's target cannot be resolved: every target of this kind is then unknown. */
  unresolved;
  from = /* @__PURE__ */ new Map();
  add(key, item, source) {
    if (!key.ok) this.unresolved ??= key.reason;
    else if (key.value !== null) {
      this.byKey.set(key.value, [...this.byKey.get(key.value) ?? [], item]);
      if (source) this.from.set(key.value, [...this.from.get(key.value) ?? [], source]);
    }
  }
  /** Addresses of the resources that added rules to `key`. */
  sources(key) {
    return this.from.get(key) ?? [];
  }
  get(key) {
    if (this.unresolved) return unknown(this.unresolved);
    const out = [];
    for (const item of this.byKey.get(key) ?? []) {
      if (!item.ok) return unknown(item.reason);
      out.push(item.value);
    }
    return known(out);
  }
};
var ModelBuilder = class {
  constructor(snap) {
    this.snap = snap;
    this.indexRuleResources();
    for (const r of snap.resources.values()) {
      if (!UNMODELED.has(r.type)) continue;
      const targets = /* @__PURE__ */ new Set();
      for (const list of Object.values(r.refs)) for (const t of list) for (const a of [instanceOf(snap, localize(r.address, t))]) if (a) targets.add(a);
      for (const v of Object.values(r.values)) {
        const t = typeof v === "string" ? snap.byId.get(v) : void 0;
        if (t) targets.add(t);
      }
      for (const attr of /* @__PURE__ */ new Set([...Object.keys(r.fullRefs), ...Object.keys(r.values).filter((k) => k.endsWith("_id"))])) {
        const key = this.target(r, attr, false);
        if (!key.ok) this.touchesAnything.push(r);
        else if (key.value !== null) targets.add(key.value);
      }
      for (const t of targets) this.touchedBy.set(t, [...this.touchedBy.get(t) ?? [], r]);
    }
  }
  snap;
  /** Target address to the unmodeled resources that point at it. */
  touchedBy = /* @__PURE__ */ new Map();
  sgRules = new Index();
  sgEgress = new Index();
  routes = new Index();
  naclRules = new Index();
  /** Subnet address to the NACL keys associated with it by aws_network_acl_association. */
  naclAssoc = new Index();
  /** VPC address to the route table set as main by aws_main_route_table_association. */
  mainAssoc = new Index();
  /** Instance address to the Elastic IPs associated with it. */
  eips = new Index();
  /** VPC address to internet gateways attached by aws_internet_gateway_attachment. */
  igwAttach = new Index();
  /** Prefix list address to aws_ec2_managed_prefix_list_entry CIDRs. */
  plEntries = new Index();
  /** Unmodeled resources whose target cannot be resolved: they may change anything of their kind. */
  touchesAnything = [];
  /** Reason why `address` is unknown because an unmodeled resource of `types` changes it. */
  touched(address, types) {
    const r = (this.touchedBy.get(address) ?? []).find((x) => types.includes(x.type));
    if (r) return `${r.address} (${r.type}) changes ${address}, and ${r.type} is not modeled yet`;
    const any = this.touchesAnything.find((x) => types.includes(x.type));
    return any ? `${any.address} (${any.type}) may change ${address}, and ${any.type} is not modeled yet` : void 0;
  }
  get(address) {
    return this.snap.resources.get(address);
  }
  ofType(type) {
    return [...this.snap.resources.values()].filter((r) => r.type === type);
  }
  refTo(r, attr, type) {
    const ref = resolveRef(this.snap, r, attr, type);
    if (ref.kind === "resource") return known(ref.address);
    if (ref.kind === "external") return unknown(`${r.address}: ${attr} = ${ref.id} is not managed in this plan`);
    return unknown(ref.reason);
  }
  /** Like refTo, but a known ID outside the plan is `null` (it cannot point at a modeled object). */
  optionalRefTo(r, attr, type) {
    if (isNull(r, attr)) return known(null);
    const ref = resolveRef(this.snap, r, attr, type);
    if (ref.kind === "resource") return known(ref.address);
    if (ref.kind === "external") return known(null);
    return unknown(ref.reason);
  }
  /**
   * The target key of an attribute that holds the ID of a security group, route table,
   * or NACL. Handles VPC default objects (`aws_vpc.x.default_route_table_id`), managed
   * defaults, and plain resources. A known ID outside the plan is `null`.
   */
  target(r, attr, normalize = true) {
    const norm = (key) => normalize ? this.normalizeKey(key) : known(key);
    if (isNull(r, attr)) return known(null);
    const v = r.values[attr];
    if (!isUnknown(r, [attr]) && typeof v === "string") return this.keyOfId(v, normalize);
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: ${attr} uses values that are unknown until apply`);
    const bases = /* @__PURE__ */ new Map();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) continue;
      const base2 = m[1];
      if (m[2] || !bases.has(base2)) bases.set(base2, m[2] ?? bases.get(base2));
    }
    if (bases.size !== 1) return unknown(`${r.address}: ${attr} is unknown until apply and cannot be matched to one resource`);
    const [base, part] = [...bases.entries()][0];
    const address = instanceOf(this.snap, base);
    if (!address) return unknown(`${r.address}: ${attr} refers to ${base}, which is not one resource on the ${this.snap.side} side`);
    if (typeOf(address) === "aws_vpc") {
      const kind = VPC_DEFAULTS.find(([a]) => a === part)?.[1];
      return kind ? norm(`${kind}:${address}`) : unknown(`${r.address}: ${attr} refers to ${address}.${part ?? "id"}`);
    }
    return this.canonical(address);
  }
  /** The key of a known ID: a resource that owns it wins; only an ID no resource owns can be a VPC default. */
  keyOfId(v, normalize = true) {
    const address = this.snap.byId.get(v);
    if (address) return this.canonical(address);
    for (const vpc of this.ofType("aws_vpc")) for (const [a, kind] of VPC_DEFAULTS) if (vpc.values[a] === v) return normalize ? this.normalizeKey(`${kind}:${vpc.address}`) : known(`${kind}:${vpc.address}`);
    return known(null);
  }
  /** `main-rt:vpc` is the default route table unless an association replaces the main table. */
  normalizeKey(key) {
    if (!key.startsWith("main-rt:")) return known(key);
    const vpc = key.slice("main-rt:".length);
    const set = this.mainAssoc.byKey.get(vpc);
    if (this.mainAssoc.unresolved || set?.length) return unknown(`${key}: rules that target the main route table of a VPC with aws_main_route_table_association are not modeled`);
    return known(`default-rt:${vpc}`);
  }
  /** Managed default resources share the key of the default object they adopt. */
  canonical(address) {
    const r = this.get(address);
    if (!r) return known(address);
    if (r.type === "aws_default_route_table") return this.adopted(r, "default_route_table_id", "default-rt");
    if (r.type === "aws_default_network_acl") return this.adopted(r, "default_network_acl_id", "default-nacl");
    if (r.type === "aws_default_security_group") {
      const vpc = this.refTo(r, "vpc_id", "aws_vpc");
      return vpc.ok ? known(`default-sg:${vpc.value}`) : unknown(vpc.reason);
    }
    return known(address);
  }
  adopted(r, attr, kind) {
    const v = r.values[attr];
    if (!isUnknown(r, [attr]) && typeof v === "string") {
      for (const vpc of this.ofType("aws_vpc")) if (VPC_DEFAULTS.some(([a]) => vpc.values[a] === v)) return known(`${kind}:${vpc.address}`);
      return unknown(`${r.address}: ${attr} = ${v} is not the default of a VPC in this plan`);
    }
    const refs = r.otherRefs.has(attr) ? [] : fromConfig(this.snap, r, attr, "aws_vpc");
    const ref = refs.length === 1 ? refs[0] : void 0;
    return ref?.kind === "resource" ? known(`${kind}:${ref.address}`) : unknown(`${r.address}: cannot tell which VPC's default it manages`);
  }
  managedDefault(key, type) {
    let found;
    for (const d of this.ofType(type)) {
      const k = this.canonical(d.address);
      if (!k.ok) return unknown(k.reason);
      if (k.value !== key) continue;
      if (found) return unknown(`${key} is managed by both ${found.address} and ${d.address}`);
      found = d;
    }
    return known(found);
  }
  indexRuleResources() {
    const all = [...this.snap.resources.values()];
    const ordered = [...all.filter((r) => r.type === "aws_main_route_table_association"), ...all.filter((r) => r.type !== "aws_main_route_table_association")];
    for (const r of ordered) {
      switch (r.type) {
        case "aws_security_group_rule": {
          if (isUnknown(r, ["type"])) {
            this.addSgRule(r, unknown(`${r.address}: type is unknown until apply`), false);
            this.addSgRule(r, unknown(`${r.address}: type is unknown until apply`), true);
            break;
          }
          const egress = r.values.type === "egress";
          const groups = this.ruleGroups(r, "source_security_group_id", r.values.self === true);
          const lists = isNull(r, "prefix_list_ids") || !isUnknown(r, ["prefix_list_ids"]) && !arr(r.values.prefix_list_ids).length ? NO_LISTS : this.listsOf(resolveRefs(this.snap, r, "prefix_list_ids", "aws_ec2_managed_prefix_list"));
          this.addSgRule(r, this.sgRuleOf(r, egress, r.values.protocol, r.values.from_port, r.values.to_port, arr(r.values.cidr_blocks).map(String), lists, groups, ["protocol", "from_port", "to_port", "cidr_blocks", "self"]), egress);
          break;
        }
        case "aws_vpc_security_group_ingress_rule": {
          const cidr = str(r.values.cidr_ipv4);
          this.addSgRule(r, this.sgRuleOf(r, false, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], this.ruleList(r), this.ruleGroups(r, "referenced_security_group_id", false), ["ip_protocol", "from_port", "to_port", "cidr_ipv4"]), false);
          break;
        }
        case "aws_vpc_security_group_egress_rule": {
          const cidr = str(r.values.cidr_ipv4);
          this.addSgRule(r, this.sgRuleOf(r, true, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], this.ruleList(r), this.ruleGroups(r, "referenced_security_group_id", false), ["ip_protocol", "from_port", "to_port", "cidr_ipv4"]), true);
          break;
        }
        case "aws_route": {
          const key = this.target(r, "route_table_id");
          const list = this.routeOf(r);
          if (!list.ok) this.routes.add(key, list, r.address);
          else for (const route of list.value) this.routes.add(key, known(route), r.address);
          break;
        }
        case "aws_network_acl_rule": {
          this.naclRules.add(this.target(r, "network_acl_id"), this.naclRuleOf(r), r.address);
          break;
        }
        case "aws_network_acl_association": {
          const subnet = this.optionalRefTo(r, "subnet_id", "aws_subnet");
          const acl = this.target(r, "network_acl_id");
          this.naclAssoc.add(subnet, acl.ok && acl.value !== null ? known(acl.value) : unknown(acl.ok ? `${r.address}: network_acl_id is outside this plan` : acl.reason), r.address);
          break;
        }
        case "aws_main_route_table_association": {
          const vpc = this.optionalRefTo(r, "vpc_id", "aws_vpc");
          const t = this.optionalRefTo(r, "route_table_id", ["aws_route_table", "aws_default_route_table"]);
          const table = t.ok && t.value ? this.canonical(t.value) : unknown(t.ok ? `${r.address}: route_table_id is outside this plan` : t.reason);
          this.mainAssoc.add(vpc, table, r.address);
          break;
        }
        case "aws_eip": {
          if (isNull(r, "instance") && !isNull(r, "network_interface")) this.eips.add(unknown(`${r.address} is associated with a network interface, which is not modeled yet`), known(r.address), r.address);
          else this.eips.add(this.optionalRefTo(r, "instance", "aws_instance"), known(r.address), r.address);
          break;
        }
        case "aws_eip_association": {
          if (isNull(r, "instance_id") && !isNull(r, "network_interface_id")) this.eips.add(unknown(`${r.address} is associated with a network interface, which is not modeled yet`), known(r.address), r.address);
          else this.eips.add(this.optionalRefTo(r, "instance_id", "aws_instance"), known(r.address), r.address);
          break;
        }
        case "aws_ec2_managed_prefix_list_entry": {
          const cidr = str(r.values.cidr);
          this.plEntries.add(this.optionalRefTo(r, "prefix_list_id", "aws_ec2_managed_prefix_list"), isUnknown(r, ["cidr"]) || !cidr ? unknown(`${r.address}: cidr is unknown until apply`) : known(cidr), r.address);
          break;
        }
        case "aws_internet_gateway_attachment": {
          const igw = this.refTo(r, "internet_gateway_id", "aws_internet_gateway");
          this.igwAttach.add(this.optionalRefTo(r, "vpc_id", "aws_vpc"), igw, r.address);
          break;
        }
      }
    }
  }
  addSgRule(r, item, egress) {
    const key = this.target(r, "security_group_id");
    if (item.ok && item.value === null) return;
    (egress ? this.sgEgress : this.sgRules).add(key, item, r.address);
  }
  /** Groups a rule resource references: `attr` (another group) and `self` (its own group). */
  ruleGroups(r, attr, self) {
    const keys = [];
    const reasons = [];
    const take = (k) => {
      if (!k.ok) reasons.push(k.reason);
      else if (k.value !== null) keys.push(k.value);
    };
    if (self) take(this.target(r, "security_group_id"));
    take(this.target(r, attr));
    return { keys: [...new Set(keys)].toSorted(cmp), ...reasons.length ? { unresolved: reasons.join("; ") } : {} };
  }
  /**
   * A customer-managed prefix list in the plan, expanded to its IPv4 CIDRs: inline
   * `entry` blocks and aws_ec2_managed_prefix_list_entry resources. A list of the IPv6
   * family has no IPv4 addresses.
   * https://docs.aws.amazon.com/vpc/latest/userguide/managed-prefix-lists.html
   */
  prefixList(address) {
    const r = this.get(address);
    if (!r || r.type !== "aws_ec2_managed_prefix_list") return unknown(`${address} is not a prefix list in this plan`);
    if (isUnknown(r, ["address_family"])) return unknown(`${address}: address_family is unknown until apply`);
    if (String(r.values.address_family) === "IPv6") return known([]);
    if (isUnknown(r, ["entry"])) {
      if (r.configured.has("entry")) return unknown(`${address}: entry is unknown until apply`);
    } else if (arr(r.values.entry).some((_, i) => hasUnknown(r, ["entry", i, "cidr"]))) return unknown(`${address}: an entry is unknown until apply`);
    const cidrs = isUnknown(r, ["entry"]) ? [] : arr(r.values.entry).map((e) => isObj(e) ? str(e.cidr) : void 0);
    const extra = this.plEntries.get(address);
    if (!extra.ok) return unknown(extra.reason);
    const out = [];
    for (const c of [...cidrs, ...extra.value]) {
      const set = c ? cidrToSet(c) : void 0;
      if (!c || !set) return unknown(`${address} has an entry the engine cannot read`);
      out.push({ cidr: c, set });
    }
    return known(out.toSorted((a, b) => cmp(a.cidr, b.cidr)));
  }
  /** Prefix lists from references: expanded when in the plan, else a reason (AWS-managed lists cannot be expanded offline). */
  listsOf(refs) {
    const out = { set: [], entries: [], names: [] };
    const reasons = [];
    for (const ref of refs) {
      if (ref.kind === "unknown") reasons.push(ref.reason);
      else if (ref.kind === "external") {
        out.names.push(ref.id);
        reasons.push(`prefix list ${ref.id} is not in this plan (for example one that AWS manages), so its addresses cannot be expanded offline`);
      } else {
        out.names.push(ref.address);
        const l = this.prefixList(ref.address);
        if (!l.ok) reasons.push(l.reason);
        else for (const e of l.value) out.entries.push(e);
      }
    }
    out.set = fromRanges(out.entries.flatMap((e) => e.set));
    out.names = [...new Set(out.names)].toSorted(cmp);
    out.entries = out.entries.toSorted((a, b) => cmp(a.cidr, b.cidr));
    return reasons.length ? { ...out, unresolved: reasons.join("; ") } : out;
  }
  /** `prefix_list_id` on aws_vpc_security_group_ingress_rule and _egress_rule. */
  ruleList(r) {
    return isNull(r, "prefix_list_id") ? NO_LISTS : this.listsOf(resolveRefs(this.snap, r, "prefix_list_id", "aws_ec2_managed_prefix_list"));
  }
  /** Prefix list IDs inside a block (`ingress[0].prefix_list_ids`): known IDs only. */
  blockLists(r, path, ids) {
    if (isUnknown(r, path)) return { ...NO_LISTS, unresolved: `${r.address}: ${path.join(".")} is unknown until apply` };
    const refs = arr(ids).map((id, j) => {
      if (isUnknown(r, [...path, j]) || typeof id !== "string") return { kind: "unknown", reason: `${r.address}: a prefix list ID is unknown until apply` };
      const a = this.snap.byId.get(id);
      return a ? { kind: "resource", address: a } : { kind: "external", id };
    });
    return this.listsOf(refs);
  }
  sgRuleOf(r, egress, protocolValue, from, to, cidrs, lists, groups, fields) {
    if (fields.some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    if (!cidrs.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) return known(null);
    const protocol = normalizeProtocol(protocolValue);
    if (protocol === "other") return known(null);
    const ports = portSet(protocol, from, to);
    const sets = cidrs.map((c) => cidrToSet(c));
    if (!ports || sets.some((s) => !s)) return unknown(`${r.address} has a value the engine cannot read`);
    return known(this.rule(r.address, egress, protocol, ports, sets.flat(), cidrs, groups, describePorts(protocol, from, to), lists));
  }
  rule(address, egress, protocol, ports, ranges, cidrs, groups, portText, lists = NO_LISTS) {
    const peers = [...cidrs, ...lists.names.map((n) => `prefix list ${n}`), ...lists.unresolved && !lists.names.length ? ["a prefix list that is unknown until apply"] : [], ...groups.keys.map(groupLabel), ...groups.unresolved ? ["a security group that is unknown until apply"] : []];
    return { protocol, ports, sources: fromRanges([...ranges, ...lists.set]), groups: groups.keys, ...groups.unresolved ? { unresolved: groups.unresolved } : {}, ...lists.unresolved ? { listUnresolved: lists.unresolved } : {}, resource: address, text: `${address} ${egress ? "egress" : "ingress"} ${portText} ${egress ? "to" : "from"} ${peers.join(", ")}` };
  }
  naclRuleOf(r) {
    if (["egress", "rule_number", "protocol", "rule_action", "cidr_block", "from_port", "to_port"].some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    const egress = r.values.egress === true;
    const key = egress ? "egress" : "ingress";
    const cidr = str(r.values.cidr_block);
    if (!cidr) return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol: "other", ports: [], cidr: [], text: `${r.address} (IPv6)` } });
    const protocol = normalizeProtocol(r.values.protocol);
    if (protocol === "other") return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol, ports: [], cidr: [], text: `${r.address} (${String(r.values.protocol)})` } });
    const ports = portSet(protocol, r.values.from_port, r.values.to_port);
    const set = cidrToSet(cidr);
    const ruleNo = num(r.values.rule_number);
    if (!ports || !set || ruleNo === void 0) return unknown(`${r.address} has a value the engine cannot read`);
    const allow = String(r.values.rule_action).toLowerCase() === "allow";
    return known({ egress, rule: { ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, r.values.from_port, r.values.to_port)} ${egress ? "to" : "from"} ${cidr}` } });
  }
  gatewayTarget(r, gw, text) {
    if (!gw.ok) return { kind: "unknown", reason: gw.reason };
    if (gw.value === null) return { kind: "unknown", reason: `${text}: gateway is not in this plan` };
    const t = typeOf(gw.value);
    if (t === "aws_internet_gateway") return { kind: "igw", address: gw.value };
    if (t === "aws_nat_gateway") return dropOf("nat_gateway_id");
    return { kind: "other", text: t.replace(/^aws_/, "").replaceAll("_", " ") };
  }
  /**
   * Routes for a prefix list destination: one per entry, each with its own length, so
   * longest prefix match works per entry. A list that cannot be expanded gives one route
   * with no CIDR and a reason. Static routes win ties over prefix list routes; the engine
   * reports a tie as unknown instead.
   * https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
   */
  listRoutes(lists, target, label) {
    const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
    const out = lists.entries.map((e) => ({ cidr: e.set, prefix: cidrPrefixLength(e.cidr) ?? 0, target, text: `${label} ${e.cidr} (prefix list ${lists.names.join(", ")}) -> ${to}` }));
    if (lists.unresolved) out.push({ cidr: [], prefix: 0, target, text: `${label} prefix list ${lists.names.join(", ") || "(unknown)"} -> ${to}`, listUnresolved: lists.unresolved });
    return out;
  }
  routeOf(r) {
    if (hasUnknown(r, ["destination_cidr_block"])) return unknown(`${r.address}: destination is unknown until apply`);
    const cidr = str(r.values.destination_cidr_block);
    const listed = !cidr && (str(r.values.destination_prefix_list_id) || isUnknown(r, ["destination_prefix_list_id"]) && r.configured.has("destination_prefix_list_id"));
    if (!cidr && !listed) return known([{ cidr: [], prefix: 0, target: { kind: "local" }, text: `${r.address} (IPv6)` }]);
    const set = cidr ? cidrToSet(cidr) : [];
    const prefix = cidr ? cidrPrefixLength(cidr) : 0;
    if (!set || prefix === void 0) return unknown(`${r.address}: destination ${cidr ?? ""} cannot be read`);
    let target;
    if (r.values.gateway_id === "local") target = { kind: "local" };
    else if (!isNull(r, "gateway_id")) {
      const gw = r.values.gateway_id;
      if (!isUnknown(r, ["gateway_id"]) && typeof gw === "string") {
        const a = this.snap.byId.get(gw);
        target = a ? this.gatewayTarget(r, known(a), r.address) : { kind: "unknown", reason: `${r.address}: gateway ${gw} is not in this plan` };
      } else target = this.gatewayTarget(r, this.refTo(r, "gateway_id", ["aws_internet_gateway", "aws_vpn_gateway"]), r.address);
    } else {
      const other = ["nat_gateway_id", "network_interface_id", "transit_gateway_id", "vpc_peering_connection_id", "vpc_endpoint_id", "egress_only_gateway_id", "carrier_gateway_id", "local_gateway_id", "core_network_arn"].find((k) => !isNull(r, k));
      target = other ? dropOf(other) ?? { kind: "other", text: other.replace(/_id$|_arn$/, "").replaceAll("_", " ") } : { kind: "unknown", reason: `${r.address} has no target the engine can read` };
    }
    if (!isUnknown(r, ["state"]) && r.values.state === "blackhole") target = { kind: "drop", ...BLACKHOLE };
    if (listed) return known(this.listRoutes(this.listsOf(resolveRefs(this.snap, r, "destination_prefix_list_id", "aws_ec2_managed_prefix_list")), target, r.address));
    const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
    return known([{ cidr: set, prefix, target, text: `${r.address} ${cidr} -> ${to}` }]);
  }
  vpc(address) {
    const r = this.get(address);
    if (!r || r.type !== "aws_vpc") return unknown(`${address} is not an aws_vpc in this plan`);
    const cidr = str(r.values.cidr_block);
    const set = cidr ? cidrToSet(cidr) : void 0;
    const extra = this.ofType("aws_vpc_ipv4_cidr_block_association").filter((a) => {
      const v = this.refTo(a, "vpc_id", "aws_vpc");
      return !v.ok || v.value === address;
    });
    const cidrs = isUnknown(r, ["cidr_block"]) || !set ? unknown(`${address}: cidr_block is unknown`) : extra.length ? unknown(`${address} has secondary CIDR blocks, which are not modeled yet`) : known(set);
    const igws = /* @__PURE__ */ new Set();
    for (const g of this.ofType("aws_internet_gateway")) {
      const v = this.optionalRefTo(g, "vpc_id", "aws_vpc");
      if (!v.ok) return known({ address, cidrs, igw: unknown(v.reason) });
      if (v.value === address) igws.add(g.address);
    }
    const attached = this.igwAttach.get(address);
    if (!attached.ok) return known({ address, cidrs, igw: unknown(attached.reason) });
    attached.value.forEach((g) => igws.add(g));
    const igw = igws.size > 1 ? unknown(`${address} has ${igws.size} internet gateways in the plan`) : known([...igws][0]);
    return known({ address, cidrs, igw, via: this.igwAttach.sources(address) });
  }
  /** A security group by key, with inline rules and rule resources merged. */
  securityGroup(key) {
    return { ...this.securityGroupOf(key), via: [.../* @__PURE__ */ new Set([...this.sgRules.sources(key), ...this.sgEgress.sources(key)])].toSorted(cmp) };
  }
  securityGroupOf(key) {
    const extraIn = this.sgRules.get(key);
    const extraOut = this.sgEgress.get(key);
    if (key.startsWith("default-sg:")) {
      const address = groupLabel(key);
      const managed = this.managedDefault(key, "aws_default_security_group");
      if (!managed.ok) return { address, key, ingress: unknown(managed.reason), egress: unknown(managed.reason) };
      if (!managed.value) {
        const fromItself = this.rule(address, false, "all", ALL_PORTS, [], [], { keys: [key] }, "all traffic");
        const toAll = this.rule(address, true, "all", ALL_PORTS, ALL_IPV4, ["0.0.0.0/0"], { keys: [] }, "all traffic");
        const def = (r2) => ({ ...r2, text: `${r2.text} (AWS default)` });
        return { address, key, ingress: extraIn.ok ? known([def(fromItself), ...extraIn.value]) : extraIn, egress: extraOut.ok ? known([def(toAll), ...extraOut.value]) : extraOut };
      }
      return this.inlineSg(managed.value, key, extraIn, extraOut);
    }
    const r = this.get(key);
    if (!r) return { address: key, key, ingress: unknown(`${key} is not in this plan`), egress: unknown(`${key} is not in this plan`) };
    return this.inlineSg(r, key, extraIn, extraOut);
  }
  inlineSg(r, key, extraIn, extraOut) {
    return { address: r.address, key, ingress: this.inlineRules(r, "ingress", key, extraIn), egress: this.inlineRules(r, "egress", key, extraOut) };
  }
  /**
   * Inline `ingress` or `egress` blocks merged with rule resources. A group created by
   * Terraform with no `egress` has no outbound rules: Terraform removes the AWS default.
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group
   */
  inlineRules(r, dir, key, extra) {
    const address = r.address;
    if (!extra.ok) return extra;
    if (isUnknown(r, [dir])) {
      if (!r.configured.has(dir)) return extra;
      return unknown(`${address}: ${dir} is unknown until apply`);
    }
    const blocks = arr(r.values[dir]);
    const rules = [];
    for (const [i, raw] of blocks.entries()) {
      if (!isObj(raw)) continue;
      if (["protocol", "from_port", "to_port", "cidr_blocks", "self"].some((f) => hasUnknown(r, [dir, i, f]))) return unknown(`${address}: ${dir} rule ${i} has values that are unknown until apply`);
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue;
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      const lists = arr(raw.prefix_list_ids).length || isUnknown(r, [dir, i, "prefix_list_ids"]) ? this.blockLists(r, [dir, i, "prefix_list_ids"], raw.prefix_list_ids) : NO_LISTS;
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s)) return unknown(`${address}: ${dir} rule ${i} has a value the engine cannot read`);
      const groups = this.inlineGroups(r, dir, i, blocks, key);
      if (!cidrs.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) continue;
      rules.push(this.rule(address, dir === "egress", protocol, ports, sets.flat(), cidrs, groups, describePorts(protocol, raw.from_port, raw.to_port), lists));
    }
    return known([...rules, ...extra.value]);
  }
  /**
   * Groups an inline block references: `self`, and `security_groups` by ID. IDs that are
   * unknown until apply come from the configuration, which merges the references of all
   * blocks; they are matched only when this is the one block that lists groups.
   */
  inlineGroups(r, dir, i, blocks, own) {
    const raw = blocks[i];
    const keys = raw.self === true ? [own] : [];
    const reasons = [];
    const listUnknown = isUnknown(r, [dir, i, "security_groups"]);
    const known_ = [];
    let pending = 0;
    for (const [j, id] of arr(raw.security_groups).entries()) {
      if (listUnknown || isUnknown(r, [dir, i, "security_groups", j]) || typeof id !== "string") {
        pending++;
        continue;
      }
      const k = this.keyOfId(id);
      if (!k.ok) reasons.push(k.reason);
      else if (k.value !== null) known_.push(k.value);
    }
    keys.push(...known_);
    if (listUnknown || pending) {
      const fail = `${r.address}: ${dir} rule ${i} references security groups that are unknown until apply and cannot be matched to resources`;
      const withGroups = blocks.filter((b, n) => isObj(b) && (arr(b.security_groups).length > 0 || isUnknown(r, [dir, n, "security_groups"]))).length;
      const found = withGroups === 1 && !r.otherRefs.has(dir) ? this.configGroups(r, dir) : void 0;
      const extra = found?.filter((k) => !known_.includes(k));
      if (!extra || !listUnknown && extra.length !== pending || listUnknown && !extra.length) reasons.push(fail);
      else keys.push(...extra);
    }
    return { keys: [...new Set(keys)].toSorted(cmp), ...reasons.length ? { unresolved: reasons.join("; ") } : {} };
  }
  /**
   * Security groups that the configuration of `attr` names: group resources, managed
   * default groups, and `aws_vpc.<name>.default_security_group_id`. Undefined when a
   * reference is something else, except a subnet or VPC CIDR used by `cidr_blocks`.
   */
  configGroups(r, attr) {
    const out = /* @__PURE__ */ new Set();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) return void 0;
      const base = instanceOf(this.snap, m[1]);
      if (!base) return void 0;
      const type = typeOf(base);
      const part = m[2];
      if ((type === "aws_security_group" || type === "aws_default_security_group") && (part === void 0 || part === "id")) {
        const k = this.canonical(base);
        if (!k.ok) return void 0;
        out.add(k.value);
      } else if (type === "aws_vpc" && part === "default_security_group_id") out.add(`default-sg:${base}`);
      else if (type === "aws_vpc" && part === void 0) continue;
      else if ((type === "aws_subnet" || type === "aws_vpc") && part === "cidr_block") continue;
      else if (part === void 0 && fullRefsHasAttr(r.fullRefs[attr] ?? [], ref)) continue;
      else return void 0;
    }
    return [...out].toSorted(cmp);
  }
  inlineNaclRules(r, key) {
    if (isUnknown(r, [key])) return r.configured.has(key) ? unknown(`${r.address}: ${key} is unknown until apply`) : known([]);
    const rules = [];
    for (const [i, raw] of arr(r.values[key]).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, [key, i])) return unknown(`${r.address}: ${key} rule ${i} has values that are unknown until apply`);
      if (str(raw.ipv6_cidr_block)) continue;
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue;
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidr = str(raw.cidr_block);
      const set = cidr ? cidrToSet(cidr) : void 0;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === void 0) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
    }
    return known(rules);
  }
  /** A NACL by key, with the rule resources that shaped it. */
  nacl(key) {
    return { ...this.naclOf(key), via: this.naclRules.sources(key) };
  }
  /** A NACL by key: inline rules (or the AWS default) merged with aws_network_acl_rule resources. */
  naclOf(key) {
    let resource = key;
    let base;
    if (key.startsWith("default-nacl:")) {
      const vpc = key.slice("default-nacl:".length);
      const managed = this.managedDefault(key, "aws_default_network_acl");
      resource = managed.ok && managed.value ? managed.value.address : `default NACL of ${vpc}`;
      if (!managed.ok) return { resource, ingress: unknown(managed.reason), egress: unknown(managed.reason) };
      if (managed.value) base = { ingress: this.inlineNaclRules(managed.value, "ingress"), egress: this.inlineNaclRules(managed.value, "egress") };
      else {
        const all = (dir) => [{ ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${dir} rule 100: allow all traffic (AWS default)` }];
        base = { ingress: known(all("ingress")), egress: known(all("egress")) };
      }
    } else {
      const r = this.get(key);
      if (!r) return { resource, ingress: unknown(`${key} is not in this plan`), egress: unknown(`${key} is not in this plan`) };
      base = { ingress: this.inlineNaclRules(r, "ingress"), egress: this.inlineNaclRules(r, "egress") };
    }
    const extra = this.naclRules.get(key);
    const merge = (dir, egress) => {
      if (!dir.ok) return dir;
      if (!extra.ok) return extra;
      const rules = [...dir.value, ...extra.value.filter((x) => x.egress === egress && x.rule.protocol !== "other").map((x) => x.rule)];
      const numbers = rules.map((x) => x.ruleNo);
      if (new Set(numbers).size !== numbers.length) return unknown(`${resource} has two ${egress ? "egress" : "ingress"} rules with the same number`);
      return known(rules.toSorted((a, b) => a.ruleNo - b.ruleNo));
    };
    return { resource, ingress: merge(base.ingress, false), egress: merge(base.egress, true) };
  }
  /**
   * The NACL of a subnet: an explicit association, else the VPC's default NACL.
   * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
   */
  subnetNacl(subnet, vpc) {
    const claims = /* @__PURE__ */ new Set();
    for (const type of ["aws_network_acl", "aws_default_network_acl"]) {
      for (const a of this.ofType(type)) {
        if (isNull(a, "subnet_ids")) continue;
        const subs = resolveRefs(this.snap, a, "subnet_ids", "aws_subnet");
        if (subs.some((s) => s.kind === "unknown")) return unknown(`${a.address}: subnet_ids is unknown until apply`);
        if (!subs.some((s) => s.kind === "resource" && s.address === subnet)) continue;
        const key = this.canonical(a.address);
        if (!key.ok) return unknown(key.reason);
        claims.add(key.value);
      }
    }
    const assoc = this.naclAssoc.get(subnet);
    if (!assoc.ok) return unknown(assoc.reason);
    assoc.value.forEach((k) => claims.add(k));
    if (claims.size > 1) return unknown(`${subnet} is associated with ${claims.size} network ACLs`);
    const nacl = this.nacl([...claims][0] ?? `default-nacl:${vpc}`);
    return known({ ...nacl, via: [...nacl.via ?? [], ...this.naclAssoc.sources(subnet)] });
  }
  routeTarget(r, raw, path, unknownGateways, knownGateways) {
    const gwUnknown = isUnknown(r, [...path, "gateway_id"]);
    const gw = str(raw.gateway_id);
    if (gw === "local") return { kind: "local" };
    if (gw || gwUnknown) {
      if (!gwUnknown && gw) {
        const a = this.snap.byId.get(gw);
        if (a) return this.gatewayTarget(r, known(a), r.address);
        return { kind: "unknown", reason: `${r.address}: gateway_id ${gw} is not in this plan` };
      }
      if (unknownGateways !== 1 || knownGateways > 0 || r.otherRefs.has(String(path[0]))) {
        return { kind: "unknown", reason: `${r.address}: gateway_id of a route is unknown until apply and cannot be matched to one resource` };
      }
      const gateways = (r.refs[String(path[0])] ?? []).filter((a) => ["aws_internet_gateway", "aws_vpn_gateway"].includes(typeOf(a)));
      const ref = gateways.length === 1 && typeOf(gateways[0]) === "aws_internet_gateway" ? fromConfig(this.snap, r, String(path[0]), "aws_internet_gateway") : [];
      if (ref.length === 1 && ref[0]?.kind === "resource") return { kind: "igw", address: ref[0].address };
      return { kind: "unknown", reason: `${r.address}: gateway_id is unknown until apply and its reference is ambiguous` };
    }
    for (const key of ["nat_gateway_id", "network_interface_id", "transit_gateway_id", "vpc_peering_connection_id", "vpc_endpoint_id", "egress_only_gateway_id", "carrier_gateway_id", "local_gateway_id", "core_network_arn"]) {
      if (str(raw[key]) || isUnknown(r, [...path, key])) return dropOf(key) ?? { kind: "other", text: key.replace(/_id$|_arn$/, "").replaceAll("_", " ") };
    }
    return { kind: "unknown", reason: `${r.address}: route has no target the engine can read` };
  }
  inlineRoutes(r) {
    const vgws = r.values.propagating_vgws;
    if (Array.isArray(vgws) && vgws.length || isUnknown(r, ["propagating_vgws"]) && r.configured.has("propagating_vgws")) {
      return unknown(`${r.address}: route propagation from a virtual private gateway is not modeled yet`);
    }
    if (isUnknown(r, ["route"])) return r.configured.has("route") ? unknown(`${r.address}: route is unknown until apply`) : known([]);
    const blocks = arr(r.values.route);
    const unknownGateways = blocks.filter((_, i) => isUnknown(r, ["route", i, "gateway_id"])).length;
    const knownGateways = blocks.filter((b, i) => isObj(b) && !isUnknown(r, ["route", i, "gateway_id"]) && str(b.gateway_id) && b.gateway_id !== "local").length;
    const routes = [];
    for (const [i, raw] of blocks.entries()) {
      if (!isObj(raw)) continue;
      if (isUnknown(r, ["route", i, "cidr_block"])) return unknown(`${r.address}: route ${i} destination is unknown until apply`);
      const cidr = str(raw.cidr_block);
      if (!cidr) {
        const pl = isUnknown(r, ["route", i, "destination_prefix_list_id"]) || str(raw.destination_prefix_list_id);
        if (pl) routes.push(...this.listRoutes(this.blockLists(r, ["route", i, "destination_prefix_list_id"], [raw.destination_prefix_list_id]), this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways), `${r.address} route`));
        continue;
      }
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === void 0) return unknown(`${r.address}: route ${i} has destination ${cidr}, which the engine cannot read`);
      const target = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
      const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
      routes.push({ cidr: set, prefix, target, text: `${r.address} route ${cidr} -> ${to}` });
    }
    return known(routes);
  }
  /** A route table by key, with the route and main-association resources that shaped it. */
  routeTable(key, vpc, isMain) {
    return { ...this.routeTableOf(key, vpc, isMain), via: [...this.routes.sources(key), ...isMain ? this.mainAssoc.sources(vpc.address) : []] };
  }
  /** A route table by key: local routes, inline routes, and aws_route resources. */
  routeTableOf(key, vpc, isMain) {
    let resource = key;
    let base = known([]);
    if (key.startsWith("default-rt:")) {
      const managed = this.managedDefault(key, "aws_default_route_table");
      resource = managed.ok && managed.value ? managed.value.address : `${isMain ? "main" : "default"} route table of ${vpc.address}`;
      if (!managed.ok) return { resource, routes: unknown(managed.reason) };
      if (managed.value) base = this.inlineRoutes(managed.value);
    } else {
      const r = this.get(key);
      if (!r) return { resource, routes: unknown(`${key} is not in this plan`) };
      base = this.inlineRoutes(r);
    }
    const touched = this.touched(key, UNMODELED_ROUTES) ?? (isMain ? this.touched(`main-rt:${vpc.address}`, UNMODELED_ROUTES) : void 0);
    if (touched) return { resource, routes: unknown(touched) };
    if (!base.ok) return { resource, routes: base };
    const extra = this.routes.get(key);
    if (!extra.ok) return { resource, routes: extra };
    if (!vpc.cidrs.ok) return { resource, routes: unknown(vpc.cidrs.reason) };
    return { resource, routes: known([...localRoutes(vpc, resource, vpc.cidrs.value), ...base.value, ...extra.value.filter((x) => x.cidr.length || x.listUnresolved)]) };
  }
  /**
   * The route table of a subnet: an explicit association, else the VPC's main route table.
   * https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
   */
  subnetRouteTable(subnet, vpc) {
    const assoc = /* @__PURE__ */ new Set();
    const assocVia = [];
    for (const a of this.ofType("aws_route_table_association")) {
      const s = this.optionalRefTo(a, "subnet_id", "aws_subnet");
      if (!s.ok) return unknown(s.reason);
      if (s.value !== subnet) continue;
      const t = this.target(a, "route_table_id");
      if (!t.ok) return unknown(t.reason);
      if (t.value === null) return unknown(`${a.address}: route table is not in this plan`);
      assoc.add(t.value);
      assocVia.push(a.address);
    }
    if (assoc.size > 1) return unknown(`${subnet} has ${assoc.size} route table associations`);
    const explicit = [...assoc][0];
    if (explicit) {
      const table = this.routeTable(explicit, vpc, false);
      return known({ ...table, via: [...table.via ?? [], ...assocVia] });
    }
    const main = this.mainAssoc.get(vpc.address);
    if (!main.ok) return unknown(main.reason);
    if (main.value.length > 1) return unknown(`${vpc.address} has ${main.value.length} main route table associations`);
    return known(this.routeTable(main.value[0] ?? `default-rt:${vpc.address}`, vpc, true));
  }
  /**
   * Endpoints, one entry per possible placement. An EC2 instance has one subnet. RDS and
   * load balancers have several; the analysis compares the results of all placements.
   */
  endpoints() {
    return [
      ...this.ofType("aws_instance").map((r) => this.instance(r)),
      ...this.ofType("aws_db_instance").flatMap((r) => this.dbInstance(r)),
      ...this.ofType("aws_lb").flatMap((r) => this.loadBalancer(r)),
      ...this.ofType("aws_rds_cluster_instance").flatMap((r) => this.auroraInstance(r)),
      ...this.ofType("aws_ecs_service").flatMap((r) => this.ecsService(r)),
      ...this.ofType("aws_elb").flatMap((r) => this.classicLoadBalancer(r))
    ];
  }
  fail(r, reason) {
    return { address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), subnetCidr: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) };
  }
  /** An endpoint for `r` placed in `subnet`. */
  place(r, subnet, publicIp, groups, placement, via = []) {
    const s = this.get(subnet);
    if (!s) return this.fail(r, `${subnet} is not in this plan`);
    const vpcRef = this.refTo(s, "vpc_id", "aws_vpc");
    if (!vpcRef.ok) return this.fail(r, vpcRef.reason);
    const vpc = this.vpc(vpcRef.value);
    if (!vpc.ok) return this.fail(r, vpc.reason);
    return {
      address: r.address,
      type: r.type,
      vpc,
      subnet: known(subnet),
      subnetCidr: subnetCidrOf(s),
      publicIp: publicIp(s),
      securityGroups: groups(vpcRef.value),
      nacl: this.subnetNacl(subnet, vpcRef.value),
      routeTable: this.subnetRouteTable(subnet, vpc.value),
      ...placement ? { placement } : {},
      via
    };
  }
  /**
   * Security groups listed in `attr`. An empty list means the VPC's default group.
   * https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
   */
  groups(r, attr, vpc, emptyMeansDefault = true) {
    const v = r.values[attr];
    if (isNull(r, attr) || Array.isArray(v) && !v.length && !isUnknown(r, [attr])) {
      return emptyMeansDefault ? known([this.securityGroup(`default-sg:${vpc}`)]) : "empty";
    }
    return this.groupsOf(r, resolveRefs(this.snap, r, attr, ["aws_security_group", "aws_default_security_group"]), vpc);
  }
  /** Security groups from resolved references; a known ID outside the plan is unknown, except the VPC's default group. */
  groupsOf(r, refs, vpc) {
    const keys = [];
    for (const ref of refs) {
      if (ref.kind === "unknown") return unknown(ref.reason);
      if (ref.kind === "external") {
        if (this.get(vpc)?.values.default_security_group_id !== ref.id) return unknown(`${r.address}: security group ${ref.id} is not managed in this plan`);
        keys.push(`default-sg:${vpc}`);
      } else {
        const k = this.canonical(ref.address);
        if (!k.ok) return unknown(k.reason);
        keys.push(k.value);
      }
    }
    return known([...new Set(keys)].toSorted(cmp).map((k) => this.securityGroup(k)));
  }
  instance(r) {
    const touched = this.touched(r.address, UNMODELED_INSTANCE);
    if (touched) return this.fail(r, touched);
    if (arr(r.values.network_interface).length) return this.fail(r, `${r.address}: network_interface blocks are not modeled yet`);
    const subnet = this.refTo(r, "subnet_id", "aws_subnet");
    if (!subnet.ok) return this.fail(r, subnet.reason);
    const publicIp = (s) => {
      let out;
      const eips = this.eips.get(r.address);
      const assoc = r.values.associate_public_ip_address;
      if (eips.ok && eips.value.length) out = known(`${eips.value.toSorted(cmp).join(", ")} is associated with ${r.address}`);
      else if (isUnknown(r, ["associate_public_ip_address"]) && r.configured.has("associate_public_ip_address")) {
        out = unknown(`${r.address}: associate_public_ip_address is set to a value that is unknown until apply`);
      } else if (!isUnknown(r, ["associate_public_ip_address"]) && typeof assoc === "boolean") {
        out = known(assoc ? `${r.address} associate_public_ip_address = true` : void 0);
      } else if (!isUnknown(s, ["map_public_ip_on_launch"]) && typeof s.values.map_public_ip_on_launch === "boolean") {
        out = known(s.values.map_public_ip_on_launch ? `${s.address} map_public_ip_on_launch = true` : void 0);
      } else {
        out = unknown(`${r.address}: whether it gets a public IPv4 address is unknown until apply`);
      }
      if (!eips.ok && !(out.ok && out.value)) out = unknown(eips.reason);
      return out;
    };
    return this.place(r, subnet.value, publicIp, (vpc) => {
      const g = this.groups(r, "vpc_security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    }, void 0, this.eips.sources(r.address));
  }
  /**
   * RDS: the DB instance gets a public address only when publicly_accessible is true, and
   * "Amazon RDS chooses a subnet and an IP address within that subnet group".
   * https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
   */
  dbInstance(r) {
    return this.rds(r, r, r);
  }
  /**
   * Aurora: each cluster instance is an endpoint. "In an Aurora DB cluster, the VPC
   * security group associated with the DB cluster is also associated with all of the DB
   * instances in the DB cluster." The subnet group is the instance's, else the cluster's;
   * publicly_accessible is set per instance.
   * https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Overview.RDSSecurityGroups.html
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/rds_cluster_instance
   */
  auroraInstance(r) {
    const cluster = this.clusterOf(r);
    if (!cluster.ok) {
      const private_ = !isUnknown(r, ["publicly_accessible"]) && r.values.publicly_accessible !== true;
      return [private_ ? { ...this.fail(r, cluster.reason), publicIp: known(void 0) } : this.fail(r, cluster.reason)];
    }
    const c = cluster.value;
    return this.rds(r, isNull(r, "db_subnet_group_name") ? c : r, c, [c.address]);
  }
  /** The aws_rds_cluster a cluster instance belongs to, by identifier or configuration reference. */
  clusterOf(r) {
    const id = r.values.cluster_identifier;
    if (!isUnknown(r, ["cluster_identifier"]) && typeof id === "string") {
      const found = this.ofType("aws_rds_cluster").filter((c) => !isUnknown(c, ["cluster_identifier"]) && c.values.cluster_identifier === id);
      if (found.length === 1) return known(found[0]);
      return unknown(`${r.address}: cluster ${id} is not in this plan`);
    }
    const refs = r.otherRefs.has("cluster_identifier") ? [] : fromConfig(this.snap, r, "cluster_identifier", "aws_rds_cluster");
    if (refs.length === 1 && refs[0]?.kind === "resource") {
      const c = this.get(refs[0].address);
      if (c) return known(c);
    }
    return unknown(`${r.address}: its aws_rds_cluster is not in this plan`);
  }
  /**
   * An RDS endpoint: `r` sets publicly_accessible, `subnetsOf` the DB subnet group, and
   * `groupsOf` vpc_security_group_ids (the cluster, for Aurora).
   */
  rds(r, subnetsOf, groupsOf, extraVia = []) {
    let subnets;
    let groupVia = [...extraVia];
    const groupName = subnetsOf.values.db_subnet_group_name;
    if (isNull(subnetsOf, "db_subnet_group_name")) subnets = unknown(`${subnetsOf.address} uses the default DB subnet group, which is not in this plan`);
    else {
      let group;
      if (!isUnknown(subnetsOf, ["db_subnet_group_name"]) && typeof groupName === "string") group = this.ofType("aws_db_subnet_group").find((g) => g.values.name === groupName);
      else if (!subnetsOf.otherRefs.has("db_subnet_group_name")) {
        const refs = fromConfig(this.snap, subnetsOf, "db_subnet_group_name", "aws_db_subnet_group");
        if (refs.length === 1 && refs[0]?.kind === "resource") group = this.get(refs[0].address);
      }
      if (!group) subnets = unknown(`${subnetsOf.address}: its DB subnet group is not in this plan`);
      else {
        groupVia = [...groupVia, group.address];
        const refs = resolveRefs(this.snap, group, "subnet_ids", "aws_subnet");
        const bad = refs.find((x) => x.kind !== "resource");
        subnets = bad ? unknown(bad.kind === "unknown" ? bad.reason : `${group.address}: a subnet is not managed in this plan`) : known(refs.map((x) => x.address));
      }
    }
    const pa = r.values.publicly_accessible;
    const publicIp = () => isUnknown(r, ["publicly_accessible"]) ? unknown(`${r.address}: publicly_accessible is unknown until apply`) : known(pa === true ? `${r.address} publicly_accessible = true` : void 0);
    if (!subnets.ok || !subnets.value.length) {
      const reason = subnets.ok ? `${r.address}: its DB subnet group has no subnets` : subnets.reason;
      const ip = publicIp();
      return [ip.ok && !ip.value ? { ...this.fail(r, reason), publicIp: ip } : this.fail(r, reason)];
    }
    return subnets.value.map(
      (sub) => this.place(r, sub, publicIp, (vpc) => {
        const g = this.groups(groupsOf, "vpc_security_group_ids", vpc);
        return g === "empty" ? known([]) : g;
      }, "the result depends on the subnet that RDS chooses from the DB subnet group", groupVia)
    );
  }
  /**
   * References in one attribute of a block (`network_configuration[0].subnets`). Known IDs
   * resolve by value. Unknown ones come from the configuration of the block, which merges
   * all its attributes, so only references of `types` count, and only for a single block.
   */
  blockRefs(r, block, key, types) {
    const blocks = arr(r.values[block]);
    const raw = blocks[0];
    if (blocks.length !== 1 || !isObj(raw)) return [{ kind: "unknown", reason: `${r.address}: ${block} is not one block` }];
    const listUnknown = isUnknown(r, [block, 0, key]);
    const items = listUnknown ? [] : arr(raw[key]);
    const out = [];
    let pending = listUnknown;
    for (const [i, v] of items.entries()) {
      if (isUnknown(r, [block, 0, key, i]) || typeof v !== "string") pending = true;
      else {
        const a = this.snap.byId.get(v);
        out.push(a ? { kind: "resource", address: a } : { kind: "external", id: v });
      }
    }
    if (!pending) return out.toSorted((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
    if (r.otherRefs.has(block)) return [{ kind: "unknown", reason: `${r.address}: ${block}.${key} uses values that are unknown until apply` }];
    const fromCfg = fromConfig(this.snap, r, block, types);
    const known_ = new Set(out.flatMap((x) => x.kind === "resource" ? [x.address] : []));
    const rest = fromCfg.filter((x) => !(x.kind === "resource" && known_.has(x.address)));
    if (!rest.length || rest.some((x) => x.kind !== "resource") || !listUnknown && rest.length !== items.length - out.length) {
      return [{ kind: "unknown", reason: `${r.address}: ${block}.${key} is unknown until apply and cannot be matched to resources` }];
    }
    return [...out, ...rest].toSorted((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  }
  /**
   * ECS service with awsvpc networking: each task gets its own network interface in one
   * of `network_configuration.subnets`, with its security groups. A public IPv4 address
   * needs `assign_public_ip = true`, and only Fargate gives one: "When hosting tasks that
   * use the awsvpc network mode on Amazon EC2 Linux instances, your task ENIs aren't given
   * public IP addresses." Without security groups, the VPC's default group is used.
   * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html
   * https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_AwsVpcConfiguration.html
   */
  ecsService(r) {
    if (!r.configured.has("network_configuration") && !arr(r.values.network_configuration).length) return [];
    if (isUnknown(r, ["network_configuration"])) return [this.fail(r, `${r.address}: network_configuration is unknown until apply`)];
    const subnetRefs = this.blockRefs(r, "network_configuration", "subnets", ["aws_subnet"]);
    const bad = subnetRefs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    if (!subnetRefs.length) return [this.fail(r, `${r.address} has no subnets`)];
    const net = arr(r.values.network_configuration)[0];
    const publicIp = () => {
      if (isUnknown(r, ["network_configuration", 0, "assign_public_ip"])) return unknown(`${r.address}: assign_public_ip is unknown until apply`);
      if (net.assign_public_ip !== true) return known(void 0);
      if (isUnknown(r, ["capacity_provider_strategy"]) && r.configured.has("capacity_provider_strategy")) return unknown(`${r.address}: capacity_provider_strategy is unknown until apply`);
      const providers = arr(r.values.capacity_provider_strategy).map((x) => isObj(x) ? String(x.capacity_provider) : "");
      if (!providers.length && isUnknown(r, ["launch_type"]) && r.configured.has("launch_type")) return unknown(`${r.address}: launch_type is unknown until apply`);
      if (!providers.length && isUnknown(r, ["launch_type"])) return unknown(`${r.address}: neither launch_type nor capacity providers are set, so the cluster's default capacity provider decides`);
      const fargate = providers.length ? providers.every((x) => x === "FARGATE" || x === "FARGATE_SPOT") : r.values.launch_type === "FARGATE";
      if (fargate) return known(`${r.address} runs on Fargate with assign_public_ip = true`);
      if (!providers.length && (r.values.launch_type === "EC2" || r.values.launch_type === "EXTERNAL")) return known(void 0);
      return unknown(`${r.address}: capacity providers ${providers.join(", ") || "(none)"} may not be Fargate`);
    };
    const groups = (vpc) => {
      if (isUnknown(r, ["network_configuration", 0, "security_groups"]) || arr(net.security_groups).length) {
        return this.groupsOf(r, this.blockRefs(r, "network_configuration", "security_groups", ["aws_security_group", "aws_default_security_group"]), vpc);
      }
      return known([this.securityGroup(`default-sg:${vpc}`)]);
    };
    return subnetRefs.map((x) => this.place(r, x.address, publicIp, groups, "the result depends on the subnet ECS places a task in"));
  }
  /**
   * Classic Load Balancer in a VPC: a node in each of `subnets`, internet-facing unless
   * `internal`. "If you use the AWS CLI or API create a load balancer in a nondefault
   * VPC, but you don't specify a security group, your load balancer is automatically
   * associated with the default security group for the VPC."
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/elb-vpc-security-groups.html
   */
  classicLoadBalancer(r) {
    if (!arr(r.values.subnets).length && !isUnknown(r, ["subnets"])) return [this.fail(r, `${r.address} uses availability_zones, not subnets: a load balancer outside a VPC in this plan is not modeled`)];
    const refs = resolveRefs(this.snap, r, "subnets", "aws_subnet");
    const bad = refs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    const publicIp = () => {
      if (isUnknown(r, ["internal"]) && r.configured.has("internal")) return unknown(`${r.address}: internal is unknown until apply`);
      if (!isUnknown(r, ["internal"]) && r.values.internal === true) return known(void 0);
      return known(isUnknown(r, ["internal"]) ? `${r.address} is internet-facing (internal is not set; the AWS default)` : `${r.address} is internet-facing (internal = false)`);
    };
    const groups = (vpc) => {
      const g = this.groups(r, "security_groups", vpc);
      return g === "empty" ? known([]) : g;
    };
    return refs.map((x) => this.place(r, x.address, publicIp, groups, "the result differs between the load balancer's subnets"));
  }
  /**
   * Load balancers: internet-facing when internal = false, with a node in each subnet.
   * A Network Load Balancer without security groups lets "all client traffic reach the
   * Network Load Balancer listeners", so its listener ports act as the allow rules.
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-security-groups.html
   */
  loadBalancer(r) {
    const fromSubnets = () => {
      const refs = resolveRefs(this.snap, r, "subnets", "aws_subnet");
      const bad = refs.find((x) => x.kind !== "resource");
      return bad ? unknown(bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`) : known(refs.map((x) => x.address).toSorted(cmp));
    };
    const mappings = arr(r.values.subnet_mapping);
    let subnets;
    if (mappings.length) {
      const ids = mappings.map((m) => isObj(m) ? m.subnet_id : void 0);
      const all = ids.every((id) => typeof id === "string") ? ids.map((id) => this.snap.byId.get(id)) : [];
      subnets = all.length === ids.length && all.every(Boolean) ? known(all.toSorted(cmp)) : unknown(`${r.address}: subnet_mapping is unknown until apply or outside this plan`);
      const listed = arr(r.values.subnets).length || isUnknown(r, ["subnets"]) ? fromSubnets() : void 0;
      if (subnets.ok && listed && (!listed.ok || listed.value.join() !== subnets.value.join())) subnets = unknown(`${r.address}: subnets and subnet_mapping disagree`);
    } else subnets = fromSubnets();
    if (!subnets.ok) return [this.fail(r, subnets.reason)];
    if (!subnets.value.length) return [this.fail(r, `${r.address} has no subnets in this plan`)];
    if (isUnknown(r, ["load_balancer_type"]) && r.configured.has("load_balancer_type")) return [this.fail(r, `${r.address}: load_balancer_type is unknown until apply`)];
    const type = isUnknown(r, ["load_balancer_type"]) ? "application" : String(r.values.load_balancer_type ?? "application");
    const publicIp = () => {
      if (isUnknown(r, ["internal"])) return unknown(`${r.address}: internal is unknown until apply`);
      if (r.values.internal === true) return known(void 0);
      if (isUnknown(r, ["ip_address_type"]) && r.configured.has("ip_address_type")) return unknown(`${r.address}: ip_address_type is unknown until apply`);
      const ipType = isUnknown(r, ["ip_address_type"]) ? "ipv4" : String(r.values.ip_address_type ?? "ipv4");
      if (ipType === "dualstack-without-public-ipv4") return known(void 0);
      if (ipType !== "ipv4" && ipType !== "dualstack") return unknown(`${r.address}: ip_address_type ${ipType} is not modeled`);
      return known(`${r.address} is internet-facing (internal = false)`);
    };
    const network = type === "network" || type === "gateway";
    const groups = (vpc) => {
      const g = this.groups(r, "security_groups", vpc, !network);
      return g === "empty" ? this.listenerGroup(r) : g;
    };
    return subnets.value.map((sub) => this.place(r, sub, publicIp, groups, "the result differs between the load balancer's subnets"));
  }
  /** Listener ports of a load balancer without security groups, as allow rules from anywhere. */
  listenerGroup(lb) {
    if (lb.values.load_balancer_type === "gateway") return unknown(`${lb.address}: Gateway Load Balancers are not modeled yet`);
    const rules = [];
    const via = [];
    for (const l of this.ofType("aws_lb_listener")) {
      const target = this.optionalRefTo(l, "load_balancer_arn", "aws_lb");
      if (!target.ok) return unknown(target.reason);
      if (target.value !== lb.address) continue;
      const port = num(l.values.port);
      const proto = String(l.values.protocol ?? "").toUpperCase();
      if (port === void 0 || isUnknown(l, ["port"]) || isUnknown(l, ["protocol"])) return unknown(`${l.address}: port or protocol is unknown until apply`);
      const protocols = proto === "UDP" ? ["udp"] : proto === "TCP_UDP" ? ["tcp", "udp"] : ["tcp"];
      via.push(l.address);
      for (const protocol of protocols) rules.push({ protocol, ports: [[port, port]], sources: ALL_IPV4, groups: [], resource: l.address, text: `${l.address} listens on ${protocol} ${port} (${lb.address} has no security groups)` });
    }
    return known([{ address: `listeners of ${lb.address}`, key: `listeners:${lb.address}`, ingress: known(rules), egress: unknown(`${lb.address} has no security groups`), via }]);
  }
};

// ../engine/src/types.ts
var RESULT_FORMAT = "0.2";

// ../engine/src/index.ts
var PROTOCOLS = ["tcp", "udp"];
var arr2 = (v) => Array.isArray(v) ? v : [];
var MODELED = /* @__PURE__ */ new Set([
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
  "aws_nat_gateway",
  "aws_ec2_managed_prefix_list",
  "aws_ec2_managed_prefix_list_entry",
  "aws_rds_cluster",
  "aws_rds_cluster_instance",
  "aws_ecs_service",
  "aws_elb"
]);
var NETWORK_TYPE = /^aws_(vpc\w*|vpn_gateway\w*|subnet|route\w*|internet_gateway\w*|nat_gateway|egress_only_internet_gateway|network_acl\w*|default_\w+|security_group\w*|vpc_security_group_\w+|eip\w*|network_interface\w*|lb|alb|elb|db_instance|rds_cluster\w*|ecs_service|ec2_transit_gateway\w*|vpc_peering_connection\w*|vpc_endpoint\w*|instance)$/;
function changeOf(before, after) {
  const b = before.verdict;
  const a = after.verdict;
  if (a === "unknown" || b === "unknown") return "unknown";
  if (JSON.stringify(before) === JSON.stringify(after)) return "unchanged";
  if (a === "allowed" && (b === "blocked" || b === "absent")) return "added";
  if (b === "allowed" && (a === "blocked" || a === "absent")) return "removed";
  if (a === "allowed" && b === "allowed") return "changed";
  return "unchanged";
}
function endpointsOf(snap) {
  const out = /* @__PURE__ */ new Map();
  for (const e of new ModelBuilder(snap).endpoints()) out.set(e.address, [...out.get(e.address) ?? [], e]);
  return out;
}
function evaluateAll(list, p, ports) {
  if (!list?.length) return evaluate(void 0, p, ports);
  return combine(list.map((e) => evaluate(e, p, ports)), list.map((e) => e.subnet.ok ? e.subnet.value : "unknown subnet"), list[0]?.placement);
}
function evaluatePairs(from, to, p, ports) {
  if (!from?.length || !to?.length) return evaluateInternal(void 0, void 0, p, ports);
  const pairs = from.flatMap((a) => to.map((t) => [a, t]));
  const where = (e) => e.subnet.ok ? e.subnet.value : "unknown subnet";
  const placement = [from[0]?.placement, to[0]?.placement].filter(Boolean).join("; ") || void 0;
  return combine(pairs.map(([a, t]) => evaluateInternal(a, t, p, ports)), pairs.map(([a, t]) => `${where(a)} to ${where(t)}`), placement);
}
function combine(outcomes, labels, placement) {
  const first = outcomes[0];
  const same = (o) => o.verdict === first.verdict && JSON.stringify(o.sources) === JSON.stringify(first.sources) && o.reason === first.reason;
  if (outcomes.every(same) || first.verdict === "blocked" && outcomes.every((o) => o.verdict === "blocked")) return first;
  const detail = labels.map((l, i) => `${l}: ${outcomes[i]?.verdict ?? "unknown"}`).join("; ");
  return { verdict: "unknown", sources: [], hops: [], reason: `${placement ?? "the result differs between placements"} (${detail})` };
}
function deleteFirst(list, snap, internet = true) {
  const out = /* @__PURE__ */ new Set();
  for (const e of list ?? []) {
    const onPath = [e.address, ...e.via ?? []];
    if (e.subnet.ok) onPath.push(e.subnet.value);
    if (e.vpc.ok) {
      onPath.push(e.vpc.value.address, ...e.vpc.value.via ?? []);
      if (internet && e.vpc.value.igw.ok && e.vpc.value.igw.value) onPath.push(e.vpc.value.igw.value);
    }
    if (e.securityGroups.ok) for (const g of e.securityGroups.value) onPath.push(g.address, ...g.via ?? []);
    if (e.nacl.ok) onPath.push(e.nacl.value.resource, ...e.nacl.value.via ?? []);
    if (e.routeTable.ok) onPath.push(e.routeTable.value.resource, ...e.routeTable.value.via ?? []);
    for (const a of onPath) {
      const r = snap.resources.get(a);
      if (!r || r.type.startsWith("aws_default_")) continue;
      if (r.actions[0] === "delete" && r.actions.includes("create")) out.add(a);
    }
  }
  return [...out].toSorted(cmp);
}
var unionOf = (list, f) => (list ?? []).reduce((acc, e) => union(acc, f(e)), []);
function notesFor(before, after) {
  const seen = /* @__PURE__ */ new Map();
  for (const snap of [before, after]) {
    for (const r of snap.resources.values()) {
      if (seen.has(r.address)) continue;
      if (r.type === "aws_ecs_service" && !arr2(r.values.network_configuration).length && !r.configured.has("network_configuration")) {
        seen.set(r.address, { resource: r.address, message: "aws_ecs_service without awsvpc networking (bridge or host mode) shares the container instance's network interface, which is not modeled yet; paths to its tasks are not reported" });
        continue;
      }
      if (MODELED.has(r.type) || !NETWORK_TYPE.test(r.type)) continue;
      seen.set(r.address, { resource: r.address, message: `${r.type} is not modeled yet; paths it can change are reported as unknown or not reported` });
    }
  }
  return [...seen.values()].toSorted((a, b) => cmp(a.resource, b.resource));
}
function analyze(plan) {
  const { before, after } = parsePlan(plan);
  const epBefore = endpointsOf(before);
  const epAfter = endpointsOf(after);
  const addresses = [.../* @__PURE__ */ new Set([...epBefore.keys(), ...epAfter.keys()])].toSorted(cmp);
  const paths = [];
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
        risk: () => deleteFirst(a, after)
      })
    );
  }
  for (const from of addresses) {
    for (const to of addresses) {
      if (from === to) continue;
      const fb = epBefore.get(from);
      const fa = epAfter.get(from);
      const tb = epBefore.get(to);
      const ta = epAfter.get(to);
      const refs = (p) => union(pairPorts(fb, tb, p), pairPorts(fa, ta, p));
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
          risk: () => [.../* @__PURE__ */ new Set([...deleteFirst(fa, after, false), ...deleteFirst(ta, after, false)])].toSorted(cmp)
        })
      );
    }
  }
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0, unknown: 0 };
  for (const path of paths) summary[path.change]++;
  const notes = [...notesFor(before, after), ...unresolvedNotes([...epBefore.values(), ...epAfter.values()].flat())];
  const merged = /* @__PURE__ */ new Map();
  for (const n of notes) merged.set(n.resource, [.../* @__PURE__ */ new Set([...merged.get(n.resource) ?? [], n.message])]);
  const unique = [...merged.entries()].map(([resource, messages]) => ({ resource, message: messages.toSorted(cmp).join("; ") })).toSorted((x, y) => cmp(x.resource, y.resource));
  return { format: RESULT_FORMAT, summary, paths, notes: unique };
}
function pairPorts(a, t, p) {
  let out = [];
  for (const x of a ?? []) for (const y of t ?? []) out = union(out, referencedPorts(x, y, p));
  return out;
}
function unresolvedNotes(list) {
  const byKey = /* @__PURE__ */ new Map();
  const add = (resource, why, target) => {
    const k = `${resource}\0${why}`;
    const n = byKey.get(k) ?? { resource, why, targets: /* @__PURE__ */ new Set() };
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
function pathsOf(spec) {
  const out = [];
  for (const p of PROTOCOLS) {
    let run2;
    const flush = () => {
      if (!run2) return;
      const ports = formatPorts([run2.ports]);
      const risk = run2.before.verdict === "allowed" && run2.after.verdict === "allowed" ? spec.risk() : [];
      out.push({ id: `${spec.id}:${p}:${ports}`, from: spec.from, ...spec.fromType !== void 0 ? { fromType: spec.fromType } : {}, to: spec.to, toType: spec.toType, protocol: p, ports, change: changeOf(run2.before, run2.after), before: run2.before, after: run2.after, ...risk.length ? { outageRisk: risk } : {} });
      run2 = void 0;
    };
    for (const seg of segment(spec.candidates(p), spec.cuts)) {
      const ob = spec.before(p, seg);
      const oa = spec.after(p, seg);
      if (run2 && run2.ports[1] + 1 === seg[0] && JSON.stringify([run2.before, run2.after]) === JSON.stringify([ob, oa])) run2.ports = [run2.ports[0], seg[1]];
      else {
        flush();
        run2 = { ports: seg, before: ob, after: oa };
      }
    }
    flush();
  }
  return out;
}

// ../cli/src/render.ts
var ORDER = ["added", "removed", "changed", "unknown", "unchanged"];
var ICON = { added: "\u{1F534}", removed: "\u{1F7E2}", changed: "\u{1F7E0}", unknown: "\u26AA", unchanged: "\xB7" };
function visiblePaths(result, opts) {
  return result.paths.filter((p) => opts.all || p.change !== "unchanged" || p.outageRisk).toSorted((a, b) => ORDER.indexOf(a.change) - ORDER.indexOf(b.change) || a.id.localeCompare(b.id));
}
function summaryLine(result) {
  const s = result.summary;
  const risk = result.paths.filter((p) => p.outageRisk).length;
  return `${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unknown} unknown, ${s.unchanged} unchanged${risk ? `; ${risk} with outage risk` : ""}`;
}
var riskLine = (p) => `outage risk: the plan replaces ${(p.outageRisk ?? []).join(", ")} by deleting before creating; traffic on this path can drop during apply (consider create_before_destroy)`;
function outcomeLine(o) {
  switch (o.verdict) {
    case "allowed":
      return `allowed from ${o.sources.join(", ")}${o.reason ? ` (also undecided: ${o.reason})` : ""}`;
    case "absent":
      return "resource does not exist";
    default: {
      const last = o.hops.at(-1);
      return `${o.verdict}${last ? ` at ${last.hop}` : ""}: ${o.reason}`;
    }
  }
}
var md = (text) => text.replace(/[|\\`*_<>]/g, (c) => `\\${c}`);
function renderMarkdown(result, opts) {
  const lines = ["### vpcdiff: reachability", "", summaryLine(result), ""];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("No reachability changes.", "");
  else {
    lines.push("| | Path | Port | Before | After |", "|---|---|---|---|---|");
    for (const p of paths) lines.push(`| ${ICON[p.change]} ${p.change}${p.outageRisk ? " \u26A0\uFE0F" : ""} | ${p.from === "internet" ? "internet" : `\`${p.from}\``} \u2192 \`${p.to}\` | ${p.protocol}/${p.ports} | ${md(outcomeLine(p.before))} | ${md(outcomeLine(p.after))} |`);
    lines.push("");
    for (const p of paths.filter((x) => x.outageRisk)) lines.push(`> \u26A0\uFE0F ${p.from === "internet" ? "" : `\`${p.from}\` \u2192 `}\`${p.to}\` ${p.protocol}/${p.ports}: ${md(riskLine(p))}`, "");
    for (const p of paths) {
      const explain = p.after.verdict === "absent" ? p.before : p.after;
      if (!explain.hops.length) continue;
      lines.push(`<details><summary>${p.from === "internet" ? "" : `${md(p.from)} \u2192 `}${md(p.to)} ${p.protocol}/${p.ports}: hops (${p.after.verdict === "absent" ? "before" : "after"})</summary>`, "", "| Hop | Decision | Rule |", "|---|---|---|");
      for (const h of explain.hops) lines.push(`| [${h.hop}](${h.doc}) | ${h.decision} | ${md(h.rule)} |`);
      lines.push("", "</details>", "");
    }
  }
  if (result.notes.length) {
    lines.push("<details><summary>Notes</summary>", "");
    for (const n of result.notes) lines.push(`- \`${n.resource}\`: ${md(n.message)}`);
    lines.push("", "</details>", "");
  }
  return `${lines.join("\n")}
`;
}
function shouldFail(result, failOn) {
  const count = (f) => result.paths.filter(f).length;
  const internet = (p) => p.from === "internet";
  if (failOn === "never") return false;
  const added = count((p) => internet(p) && p.change === "added");
  if (failOn === "added") return added > 0;
  const changed = count((p) => p.change === "changed" || !internet(p) && (p.change === "added" || p.change === "removed"));
  if (failOn === "changed") return added + changed > 0;
  return added + changed + result.summary.unknown > 0;
}

// src/main.ts
var MARKER = "<!-- vpcdiff-action -->";
var FAIL_ON = ["added", "changed", "unknown", "never"];
var input = (env, name, fallback = "") => (env.vars[`INPUT_${name.toUpperCase()}`] ?? "").trim() || fallback;
var escape = (s) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
function setOutputs(env, result) {
  const file = env.vars.GITHUB_OUTPUT;
  if (!file) return;
  env.appendFile(file, Object.entries(result.summary).map(([k, v]) => `${k}=${v}
`).join(""));
}
async function comment(env, body) {
  const eventPath = env.vars.GITHUB_EVENT_PATH;
  const repo = env.vars.GITHUB_REPOSITORY;
  const token = input(env, "github-token");
  if (!eventPath || !repo) return;
  const event = JSON.parse(env.readFile(eventPath));
  const number = event.pull_request?.number;
  if (!number) {
    env.log("vpcdiff: not a pull_request event; skipping the comment.");
    return;
  }
  if (!token) {
    env.log(`::warning::${escape("vpcdiff: no github-token; skipping the pull request comment.")}`);
    return;
  }
  const api = env.vars.GITHUB_API_URL ?? "https://api.github.com";
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  const text = `${MARKER}
${body}`;
  let existing;
  for (let page = 1; page <= 10 && existing === void 0; page++) {
    const res2 = await env.fetch(`${api}/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, { headers });
    if (!res2.ok) throw new Error(`listing comments failed: HTTP ${res2.status}`);
    const list = await res2.json();
    existing = list.find((c) => c.body?.startsWith(MARKER))?.id;
    if (list.length < 100) break;
  }
  const res = existing === void 0 ? await env.fetch(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body: text }) }) : await env.fetch(`${api}/repos/${repo}/issues/comments/${existing}`, { method: "PATCH", headers, body: JSON.stringify({ body: text }) });
  if (res.status === 403 || res.status === 404) {
    env.log(`::warning::${escape(`vpcdiff: the token cannot write pull request comments (HTTP ${res.status}). Pull requests from forks get a read-only token; the report is in the job summary.`)}`);
    return;
  }
  if (!res.ok) throw new Error(`writing the comment failed: HTTP ${res.status}`);
  env.log(`vpcdiff: ${existing === void 0 ? "created" : "updated"} the pull request comment.`);
}
async function run(env) {
  const planPath = input(env, "plan");
  const failOn = input(env, "fail-on", "added");
  if (!planPath) {
    env.log(`::error::${escape("vpcdiff: the `plan` input is required (path to `terraform show -json` output).")}`);
    return 2;
  }
  if (!FAIL_ON.includes(failOn)) {
    env.log(`::error::${escape(`vpcdiff: fail-on must be one of ${FAIL_ON.join(", ")}.`)}`);
    return 2;
  }
  let result;
  try {
    result = analyze(JSON.parse(env.readFile(planPath)));
  } catch (e) {
    const why = e instanceof SyntaxError ? "the file is not valid JSON" : e instanceof PlanError ? e.message : e.message;
    env.log(`::error::${escape(`vpcdiff: ${planPath}: ${why}`)}`);
    return 2;
  }
  const markdown = renderMarkdown(result, { all: input(env, "all", "false") === "true" });
  if (env.vars.GITHUB_STEP_SUMMARY) env.appendFile(env.vars.GITHUB_STEP_SUMMARY, markdown);
  setOutputs(env, result);
  if (input(env, "comment", "true") === "true") {
    try {
      await comment(env, markdown);
    } catch (e) {
      env.log(`::warning::${escape(`vpcdiff: could not write the pull request comment: ${e.message}`)}`);
    }
  }
  const s = result.summary;
  env.log(`vpcdiff: ${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unknown} unknown, ${s.unchanged} unchanged`);
  if (shouldFail(result, failOn)) {
    env.log(`::error::${escape(`vpcdiff: the plan has reachability changes at or above fail-on=${failOn}. See the job summary.`)}`);
    return 1;
  }
  return 0;
}

// src/index.ts
process.exitCode = await run({
  vars: process.env,
  readFile: (p) => readFileSync(p, "utf8"),
  appendFile: (p, t) => appendFileSync(p, t),
  fetch: globalThis.fetch,
  log: (line) => process.stdout.write(`${line}
`)
});
