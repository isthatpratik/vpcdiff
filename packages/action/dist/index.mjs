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
var PRIVATE_IPV4 = ["10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16"].reduce((set, c) => union(set, cidrToSet(c) ?? EMPTY), EMPTY);
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

// ../engine/src/intervals6.ts
var EMPTY6 = [];
var IPV6_MAX = (1n << 128n) - 1n;
var max = (a, b) => a > b ? a : b;
var min = (a, b) => a < b ? a : b;
function fromRanges6(ranges) {
  const sorted = ranges.filter(([lo, hi]) => lo <= hi).toSorted((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const out = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1n) last[1] = max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
var union6 = (a, b) => fromRanges6([...a, ...b]);
function intersect6(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [alo, ahi] = a[i];
    const [blo, bhi] = b[j];
    const lo = max(alo, blo);
    const hi = min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
    if (ahi < bhi) i++;
    else j++;
  }
  return out;
}
function subtract6(a, b) {
  const out = [];
  for (const [lo, hi] of a) {
    let start = lo;
    for (const [blo, bhi] of b) {
      if (bhi < start || blo > hi) continue;
      if (blo > start) out.push([start, blo - 1n]);
      start = bhi + 1n;
      if (start > hi) break;
    }
    if (start <= hi) out.push([start, hi]);
  }
  return out;
}
var isEmpty6 = (a) => a.length === 0;
var equals6 = (a, b) => a.length === b.length && a.every(([lo, hi], i) => lo === b[i]?.[0] && hi === b[i]?.[1]);
function parseIpv6(text) {
  const t = text.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(t) || t.split("::").length > 2) return void 0;
  const [head = "", tail] = t.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === void 0 ? 0 : 8 - left.length - right.length;
  if (fill < 0 || tail === void 0 && left.length !== 8) return void 0;
  const groups = [...left, ...Array(fill).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return void 0;
  return groups.reduce((n, g) => n << 16n | BigInt(Number.parseInt(g, 16)), 0n);
}
function formatIpv6(n) {
  const groups = Array.from({ length: 8 }, (_, i) => Number(n >> BigInt(112 - i * 16) & 0xffffn));
  let best = [-1, 0];
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best[1] && j - i > 1) best = [i, j - i];
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  const [at, len] = best;
  if (at < 0) return hex.join(":");
  return `${hex.slice(0, at).join(":")}::${hex.slice(at + len).join(":")}`;
}
function cidr6ToSet(cidr) {
  const m = /^([0-9a-fA-F:]+)\/(\d{1,3})$/.exec(cidr.trim());
  if (!m) return void 0;
  const addr = parseIpv6(m[1]);
  const len = Number(m[2]);
  if (addr === void 0 || len > 128) return void 0;
  const size = 1n << BigInt(128 - len);
  const lo = addr / size * size;
  return [[lo, lo + size - 1n]];
}
var prefixLength6 = (cidr) => cidr6ToSet(cidr) ? Number(cidr.split("/")[1]) : void 0;
function set6ToCidrs(set) {
  const out = [];
  for (const [lo, hi] of set) {
    let start = lo;
    while (start <= hi) {
      let bits = 0;
      while (bits < 128 && start % (1n << BigInt(bits + 1)) === 0n && start + (1n << BigInt(bits + 1)) - 1n <= hi) bits++;
      out.push(`${formatIpv6(start)}/${128 - bits}`);
      start += 1n << BigInt(bits);
    }
  }
  return out;
}

// ../engine/src/evaluate6.ts
var DOC2 = {
  "public-ip": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html",
  "internet-gateway": "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
  "nacl-inbound": "https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html",
  "security-group": "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
  "nacl-outbound": "https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports",
  route: "https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html"
};
var GLOBAL_UNICAST = cidr6ToSet("2000::/3");
function internet6Of(ep) {
  const own = ep.vpc.ok && ep.vpc.value.ipv6?.ok ? ep.vpc.value.ipv6.value?.cidrs : void 0;
  return own ? subtract6(GLOBAL_UNICAST, own) : GLOBAL_UNICAST;
}
var protoMatches2 = (rule, p) => rule === "all" || rule === p;
function naclEval6(rules, addrs, p, ports) {
  let remaining = addrs;
  let allowed = EMPTY6;
  const texts = [];
  for (const rule of rules) {
    if (!rule.cidr6 || !protoMatches2(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    const m = intersect6(remaining, rule.cidr6);
    if (isEmpty6(m)) continue;
    if (rule.allow) allowed = union6(allowed, m);
    texts.push(rule.text);
    remaining = subtract6(remaining, m);
  }
  if (!isEmpty6(remaining)) texts.push("rule *: deny all IPv6 traffic (implicit)");
  return { allowed, texts };
}
var absent2 = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
function evaluate6(ep, p, ports) {
  if (!ep) return absent2;
  const hops = [];
  const universe = internet6Of(ep);
  const portText = `${p}/${ports[0] === ports[1] ? ports[0] : `${ports[0]}-${ports[1]}`}`;
  const add = (hop, resource, decision, rule) => hops.push({ hop, resource, decision, rule, doc: DOC2[hop] });
  const stop = (verdict, reason) => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop, resource, reason) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const undecided = [];
  const ip = ep.publicIp6 ?? { ok: true, value: void 0 };
  if (!ip.ok) return unknownAt("public-ip", ep.address, ip.reason);
  if (!ip.value) {
    add("public-ip", ep.address, "deny", `${ep.address} has no IPv6 address`);
    return stop("blocked", `${ep.address} has no IPv6 address`);
  }
  add("public-ip", ep.address, "allow", ip.value);
  if (!ep.vpc.ok) return unknownAt("internet-gateway", ep.address, ep.vpc.reason);
  const vpc = ep.vpc.value;
  if (!vpc.igw.ok) return unknownAt("internet-gateway", vpc.address, vpc.igw.reason);
  if (!vpc.igw.value) {
    add("internet-gateway", vpc.address, "deny", `no internet gateway is attached to ${vpc.address}`);
    return stop("blocked", `no internet gateway is attached to ${vpc.address}`);
  }
  if (vpc.ipv6 && !vpc.ipv6.ok) return unknownAt("internet-gateway", vpc.address, vpc.ipv6.reason);
  const igw = vpc.igw.value;
  add("internet-gateway", igw, "allow", `${igw} is attached to ${vpc.address}`);
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
  if (!ep.securityGroups.ok) return unknownAt("security-group", ep.address, ep.securityGroups.reason);
  const groups = ep.securityGroups.value;
  const names = groups.map((g) => g.address).join(", ");
  let allowed = EMPTY6;
  const texts = [];
  const doubt = [];
  for (const g of groups) {
    if (!g.ingress.ok) return unknownAt("security-group", g.address, g.ingress.reason);
    for (const rule of g.ingress.value) {
      if (!protoMatches2(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
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
  if (!nacl.egress.ok) return unknownAt("nacl-outbound", nacl.resource, nacl.egress.reason);
  let full = sources;
  let some = EMPTY6;
  const outTexts = /* @__PURE__ */ new Set();
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
  if (!ep.routeTable.ok) return unknownAt("route", ep.address, ep.routeTable.reason);
  const table = ep.routeTable.value;
  if (!table.routes.ok) return unknownAt("route", table.resource, table.routes.reason);
  const routes = table.routes.value.filter((r) => r.cidr6).toSorted((a, b) => b.prefix - a.prefix);
  const listDoubt = table.routes.value.filter((r) => r.listUnresolved).map((r) => `${r.text}: ${r.listUnresolved}`);
  let remaining = sources;
  let viaIgw = EMPTY6;
  let unresolved = EMPTY6;
  const routeTexts = [];
  const reasons = [];
  const dropped = [];
  for (const [i, route] of routes.entries()) {
    const m = intersect6(remaining, route.cidr6);
    if (isEmpty6(m)) continue;
    if (routes.some((o, j) => j !== i && equals6(o.cidr6, route.cidr6))) return unknownAt("route", table.resource, `${table.resource} has more than one IPv6 route for the same destination`);
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
function exposedPorts6(ep, p) {
  if (!ep || !ep.publicIp6 || ep.publicIp6.ok && !ep.publicIp6.value) return [];
  if (!ep.securityGroups.ok) return [{ lo: 0, hi: 65535 }];
  const universe = internet6Of(ep);
  const out = [];
  for (const g of ep.securityGroups.value) {
    if (!g.ingress.ok) return [{ lo: 0, hi: 65535 }];
    for (const rule of g.ingress.value) {
      if (protoMatches2(rule.protocol, p) && (rule.listUnresolved || rule.sources6 && !isEmpty6(intersect6(rule.sources6, universe)))) for (const [lo, hi] of rule.ports) out.push({ lo, hi });
    }
  }
  return out;
}

// ../engine/src/internal.ts
var SG_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html";
var NACL_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html";
var ROUTE_DOC = "https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html";
var DOC3 = {
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
var protoMatches3 = (rule, p) => rule === "all" || rule === p;
var USE_GROUPS = { use: true };
function groupKeys(ep) {
  return ep.securityGroups.ok ? { ok: true, value: ep.securityGroups.value.map((g) => g.key) } : ep.securityGroups;
}
function sgStep(groups, dir, peerKeys, peerCidr, peer, p, ports, refs = USE_GROUPS) {
  const names = groups.map((g) => g.address).join(", ") || "no security groups";
  const allowing = [];
  const doubt = [];
  const ignored = [];
  for (const g of groups) {
    const rules = g[dir];
    if (!rules.ok) return { decision: "unknown", resource: g.address, rule: rules.reason, reason: rules.reason };
    for (const rule of rules.value) {
      if (!protoMatches3(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
      const byGroup = rule.groups.some((k) => peerKeys.includes(k));
      if (contains(rule.sources, peerCidr) || byGroup && refs.use === true) allowing.push(rule.text);
      else if (byGroup && refs.use === "unknown") doubt.push(`${rule.text} names a group of ${peer}: ${refs.why}`);
      else if (byGroup && refs.use === false) {
        ignored.push(`${rule.text} names a group of ${peer}, but ${refs.why}`);
        if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
        else if (rule.unresolved) doubt.push(`${rule.text}: ${rule.unresolved}`);
        else if (rule.listUnresolved) doubt.push(`${rule.text}: ${rule.listUnresolved}`);
      } else if (!isEmpty(intersect(rule.sources, peerCidr))) doubt.push(`${rule.text} covers only part of the subnet of ${peer}, and its address is not known before apply`);
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
function routeStep(table, at, peerCidr, peer) {
  if (!table.ok) return { decision: "unknown", resource: at, rule: table.reason, reason: table.reason };
  const t = table.value;
  if (!t.routes.ok) return { decision: "unknown", resource: t.resource, rule: t.routes.reason, reason: t.routes.reason };
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  const listDoubt = routes.filter((r) => r.listUnresolved && !(r.awsService && contains(PRIVATE_IPV4, peerCidr))).map((r) => `${r.text}: ${r.listUnresolved}`);
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
function peeringStep(table, at, peerCidr, peer, own, peerVpc) {
  const fail = (decision, resource, why) => ({ decision, resource, rule: why, reason: why });
  if (!table.ok) return fail("unknown", at, table.reason);
  const t = table.value;
  if (!t.routes.ok) return fail("unknown", t.resource, t.routes.reason);
  if (own.cidrs.ok && peerVpc.cidrs.ok && !isEmpty(intersect(own.cidrs.value, peerVpc.cidrs.value))) return fail("unknown", own.address, `${own.address} and ${peerVpc.address} have overlapping CIDR blocks, so they cannot be peered`);
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const via = /* @__PURE__ */ new Set();
  const texts = [];
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
  const pcx = [...via][0];
  if (!own.peerings) return fail("unknown", own.address, `${own.address}: peering connections are not known`);
  if (!own.peerings.ok) return fail("unknown", own.address, own.peerings.reason);
  const p = own.peerings.value.find((x) => x.address === pcx);
  if (!p) return fail("unknown", t.resource, `${pcx} is not a peering connection of ${own.address} in this plan`);
  if (!p.peer.ok) return fail("unknown", pcx, p.peer.reason);
  if (p.peer.value !== peerVpc.address) return fail("deny", pcx, `${pcx} joins ${own.address} and ${p.peer.value}, not ${peerVpc.address}`);
  if (!p.active.ok) return fail("unknown", pcx, p.active.reason);
  return { decision: "allow", resource: t.resource, rule: `${texts.join("; ")} (${p.active.value})` };
}
var TGW_DOC = "https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html";
function transitOf(table, peerCidr) {
  if (!table.ok || !table.value.routes.ok) return void 0;
  const routes = table.value.routes.value.filter((r) => !isEmpty(intersect(r.cidr, peerCidr))).toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const via = [];
  for (const r of routes) {
    const m = intersect(remaining, r.cidr);
    if (isEmpty(m)) continue;
    if (r.target.kind !== "other" || !r.target.tgw) return void 0;
    via.push(r.target.tgw);
    remaining = subtract(remaining, m);
  }
  const first = via[0];
  if (!first) return void 0;
  if (!first.ok) return first;
  return via.every((v) => v.ok && v.value === first.value) ? first : void 0;
}
function attachmentOf(transit, tgw, vpc) {
  const list = transit.attachments.filter((a) => a.tgw === tgw && a.vpc === vpc);
  if (list.length === 1) return { ok: true, value: list[0] };
  return { ok: false, reason: list.length ? `${vpc} has ${list.length} attachments to ${tgw}` : `${vpc} has no attachment to ${tgw} in this plan` };
}
function transitGroupRefs(transit, tgw, a, t) {
  if (!transit?.ok || !tgw.ok) return { use: "unknown", why: "the transit gateway is not known" };
  const gw = transit.value.gateways.get(tgw.value);
  const atA = attachmentOf(transit.value, tgw.value, a.address);
  const atT = attachmentOf(transit.value, tgw.value, t.address);
  if (!gw || !atA.ok || !atT.ok) return { use: "unknown", why: "the transit gateway attachments are not known" };
  const flags = [[tgw.value, gw.sgRefs], [atA.value.address, atA.value.sgRefs], [atT.value.address, atT.value.sgRefs]];
  const unsure = flags.find(([, f]) => !f.ok);
  if (unsure && !unsure[1].ok) return { use: "unknown", why: unsure[1].reason };
  const off = flags.filter(([, f]) => f.ok && !f.value).map(([n]) => n);
  return off.length ? { use: false, why: `security group referencing is not enabled on ${off.join(", ")}` } : USE_GROUPS;
}
function transitStep(table, at, peerCidr, peer, own, peerVpc, ownAz, transit) {
  const fail = (decision, resource, why) => ({ decision, resource, rule: why, reason: why });
  if (!table.ok) return fail("unknown", at, table.reason);
  const t = table.value;
  if (!t.routes.ok) return fail("unknown", t.resource, t.routes.reason);
  if (own.cidrs.ok && peerVpc.cidrs.ok && !isEmpty(intersect(own.cidrs.value, peerVpc.cidrs.value))) return fail("unknown", own.address, `${own.address} and ${peerVpc.address} have overlapping CIDR blocks; a transit gateway does not route between them`);
  const routes = t.routes.value.toSorted((a, b) => b.prefix - a.prefix);
  let remaining = peerCidr;
  const texts = [];
  let tgw;
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
  if (!transit) return fail("unknown", tgw, "transit gateways are not known");
  if (!transit.ok) return fail("unknown", tgw, transit.reason);
  const tr = transit.value;
  if (!tr.gateways.has(tgw)) return fail("unknown", tgw, `${tgw} is not a transit gateway in this plan`);
  const mine = attachmentOf(tr, tgw, own.address);
  if (!mine.ok) return fail("unknown", tgw, mine.reason);
  const att = mine.value;
  if (!ownAz) return fail("unknown", at, `the Availability Zone of ${at} is not known`);
  if (!ownAz.ok) return fail("unknown", at, ownAz.reason);
  if (!att.subnets.ok) return fail("unknown", att.address, att.subnets.reason);
  const zones = att.subnets.value.map((s) => s.az);
  if (!zones.some((z) => z.ok && z.value === ownAz.value)) {
    const unsure = zones.find((z) => !z.ok);
    if (unsure && !unsure.ok) return fail("unknown", att.address, unsure.reason);
    return fail("deny", att.address, `${at} is in ${ownAz.value}, where ${att.address} has no subnet; only resources in Availability Zones with a transit gateway attachment can reach the transit gateway`);
  }
  if (!att.association.ok) return fail("unknown", att.address, att.association.reason);
  const key = att.association.value;
  if (key === null) return fail("deny", att.address, `${att.address} is not associated with a transit gateway route table, so ${tgw} has no route for its traffic`);
  const name = tr.names.get(key) ?? key;
  const tgwRoutes = tr.routes.get(key);
  if (!tgwRoutes) return fail("unknown", name, `${name} is not in this plan`);
  if (!tgwRoutes.ok) return fail("unknown", name, tgwRoutes.reason);
  const live = tgwRoutes.value.filter((r) => r.static || !tgwRoutes.value.some((o) => o.static && equals(o.cidr, r.cidr)));
  const ordered = live.toSorted((a, b) => b.prefix - a.prefix);
  let rest = peerCidr;
  const tgwTexts = [];
  let peerAtt;
  for (const [i, route] of ordered.entries()) {
    const m = intersect(rest, route.cidr);
    if (isEmpty(m)) continue;
    if (ordered.some((o, j) => j !== i && equals(o.cidr, route.cidr))) return fail("unknown", name, `${name} has more than one route for the same destination`);
    const clash = route.from ? ordered.find((o) => o.from && o.from !== route.from && !isEmpty(intersect(intersect(o.cidr, route.cidr), peerCidr))) : void 0;
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
  const entry = tr.attachments.find((a) => a.address === peerAtt);
  if (!entry.subnets.ok) return fail("unknown", entry.address, entry.subnets.reason);
  for (const s of entry.subnets.value) {
    const step = routeStep(s.table, s.address, peerCidr, peer);
    if (step.decision !== "allow") return fail("unknown", entry.address, `traffic from ${tgw} can enter ${peerVpc.address} at ${s.address}, and there: ${step.reason ?? step.rule}`);
  }
  const zone = `${att.address} has a subnet in ${ownAz.value}`;
  return { decision: "allow", resource: t.resource, rule: `${texts.join("; ")}; ${zone}; ${att.address} uses ${name}: ${tgwTexts.join("; ")}` };
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
var absent3 = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
function evaluateInternal(a, t, p, ports) {
  if (!a || !t) return absent3;
  const hops = [];
  const doubts = [];
  const run2 = (hop, s) => {
    if (s.doubt) doubts.push(s.doubt);
    hops.push({ hop, resource: s.resource, decision: s.decision, rule: s.rule, doc: s.doc ?? DOC3[hop] ?? SG_DOC });
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
  const crossVpc = a.vpc.ok && t.vpc.ok && a.vpc.value.address !== t.vpc.value.address;
  const viaTgw = crossVpc ? transitOf(a.routeTable, tCidr) : void 0;
  const egressRefs = viaTgw ? { use: false, why: "outbound rules cannot reference security groups across a transit gateway" } : USE_GROUPS;
  const out = run2("source-security-group", sgStep(a.securityGroups.value, "egress", tKeys, tCidr, t.address, p, ports, egressRefs));
  if (out) return out;
  if (!a.vpc.ok) return fail("source-route", a.address, a.vpc.reason);
  if (!t.vpc.ok) return fail("source-route", t.address, t.vpc.reason);
  const peered = a.vpc.value.address !== t.vpc.value.address;
  const cross = (from, to, cidr, own, other) => transitOf(from.routeTable, cidr) ? { ...transitStep(from.routeTable, from.subnet.ok ? from.subnet.value : from.address, cidr, to.address, own, other, from.az, from.transit), doc: TGW_DOC } : peeringStep(from.routeTable, from.address, cidr, to.address, own, other);
  const r1 = run2("source-route", peered ? cross(a, t, tCidr, a.vpc.value, t.vpc.value) : routeStep(a.routeTable, a.address, tCidr, t.address));
  if (r1) return r1;
  const same = a.subnet.ok && t.subnet.ok && a.subnet.value === t.subnet.value;
  const at = (ep) => ep.subnet.ok ? ep.subnet.value : ep.address;
  const skip = (ep) => ({ decision: "allow", resource: at(ep), rule: SAME_SUBNET });
  const n3 = run2("source-nacl-outbound", same ? skip(a) : naclStep(a.nacl, at(a), "egress", tCidr, t.address, p, ports, false));
  if (n3) return n3;
  const n4 = run2("target-nacl-inbound", same ? skip(t) : naclStep(t.nacl, at(t), "ingress", aCidr, a.address, p, ports, false));
  if (n4) return n4;
  const ingressRefs = viaTgw ? transitGroupRefs(a.transit, viaTgw, a.vpc.value, t.vpc.value) : USE_GROUPS;
  const sg = run2("security-group", sgStep(t.securityGroups.value, "ingress", aKeys, aCidr, a.address, p, ports, ingressRefs));
  if (sg) return sg;
  const n6 = run2("target-nacl-outbound", same ? skip(t) : naclStep(t.nacl, at(t), "egress", aCidr, a.address, p, ports, true));
  if (n6) return n6;
  const n7 = run2("source-nacl-inbound", same ? skip(a) : naclStep(a.nacl, at(a), "ingress", tCidr, t.address, p, ports, true));
  if (n7) return n7;
  const r8 = run2("target-route", peered ? cross(t, a, aCidr, t.vpc.value, a.vpc.value) : routeStep(t.routeTable, t.address, aCidr, a.address));
  if (r8) return r8;
  return { verdict: "allowed", sources: [a.address], hops, reason: doubts.join("; ") };
}
function referencedPorts(a, t, p) {
  const keys = groupKeys(a);
  if (!keys.ok || !t.securityGroups.ok) return EMPTY;
  let out = EMPTY;
  for (const g of t.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) if (protoMatches3(rule.protocol, p) && rule.groups.some((k) => keys.value.includes(k))) out = union(out, rule.ports);
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

// ../engine/src/gcp/evaluate.ts
var DOC4 = {
  "public-ip": "https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_instance",
  sql: "https://docs.cloud.google.com/sql/docs/postgres/authorize-networks",
  firewall: "https://docs.cloud.google.com/firewall/docs/firewalls",
  route: "https://docs.cloud.google.com/vpc/docs/routes"
};
var absent4 = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
var protoMatches4 = (rule, p) => rule === "all" || rule === p;
function evaluateGcp(vm, p, ports) {
  if (!vm) return absent4;
  const hops = [];
  const sql = vm.type === "google_sql_database_instance";
  const add = (hop, resource, decision, rule) => hops.push({ hop, resource, decision, rule, doc: sql && hop !== "route" ? DOC4.sql : DOC4[hop] });
  const stop = (verdict, reason) => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop, resource, reason) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const portText = `${p}/${formatPorts([ports])}`;
  if (!vm.externalIp.ok) return unknownAt("public-ip", vm.address, vm.externalIp.reason);
  if (!vm.externalIp.value) {
    add("public-ip", vm.address, "deny", vm.type === "google_sql_database_instance" ? `${vm.address} has no public IP address (ipv4_enabled = false)` : `${vm.address} has no external IP address (no access_config)`);
    return stop("blocked", `${vm.address} has no external IP address`);
  }
  add("public-ip", vm.address, "allow", vm.externalIp.value);
  const where = vm.network.ok ? vm.network.value : vm.address;
  if (!vm.firewall.ok) return unknownAt("firewall", where, vm.firewall.reason);
  let remaining = PUBLIC_IPV4;
  let allowed = EMPTY;
  const texts = [];
  for (const rule of vm.firewall.value) {
    if (!protoMatches4(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
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
  if (!vm.route.ok) return unknownAt("route", where, vm.route.reason);
  if (vm.route.value) add("route", vm.route.value.resource, "allow", vm.route.value.text);
  return { verdict: "allowed", sources: equals(allowed, PUBLIC_IPV4) ? ["internet"] : setToCidrs(allowed), hops, reason: "" };
}
function gcpExposed(vm, p) {
  if (!vm) return EMPTY;
  if (!vm.firewall.ok) return ALL_PORTS;
  let out = EMPTY;
  for (const rule of vm.firewall.value) if (rule.allow && protoMatches4(rule.protocol, p) && !isEmpty(intersect(rule.sources, PUBLIC_IPV4))) out = union(out, rule.ports);
  return out;
}
function gcpCuts(vm) {
  return vm?.firewall.ok ? vm.firewall.value.map((r) => r.ports) : [];
}

// ../engine/src/plan.ts
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var PlanError = class extends Error {
};
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var stripKeys = (address) => address.replace(/\[[^\]]*\]/g, "");
var RESOURCE_REF = /^(?:aws|google|azurerm)_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.|$)/;
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
          const m = /^((?:aws|google|azurerm)_\w+\.[\w-]+(?:\[[^\]]+\])?)$/.exec(ref);
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
    for (const [snap, values, unknown4] of sides) {
      if (!isObj(values)) continue;
      snap.resources.set(address, { address, type, values, unknown: unknown4, refs: info.refs, fullRefs: info.fullRefs, configured: info.configured, otherRefs: info.otherRefs, actions });
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
    const known4 = [];
    let unknownCount = 0;
    items.forEach((v, i) => {
      if (typeof v === "string" && !isUnknown(r, Array.isArray(value) ? [attr, i] : [attr])) {
        const address = snap.byId.get(v);
        known4.push(address ? { kind: "resource", address } : { kind: "external", id: v });
      } else unknownCount++;
    });
    if (!unknownCount) return known4.toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
    if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
    const knownAddresses = new Set(known4.flatMap((k) => k.kind === "resource" ? [stripKeys(k.address)] : []));
    const rest = fromConfig(snap, r, attr, targetType).filter((x) => !(x.kind === "resource" && knownAddresses.has(stripKeys(x.address))));
    if (rest.length !== unknownCount || rest.some((x) => x.kind !== "resource")) return fail(`${r.address}: ${attr} has elements that are unknown until apply and cannot be matched to resources`);
    return [...known4, ...rest].toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
  }
  if (r.otherRefs.has(attr)) return fail(`${r.address}: ${attr} uses values that are unknown until apply`);
  return fromConfig(snap, r, attr, targetType).toSorted((a, b) => cmp(refOrder(a), refOrder(b)));
}
var ADDRESS = /^((?:module\.[\w-]+(?:\[[^\]]+\])?\.)*)((?:aws|google|azurerm)_\w+\.[\w-]+(?:\[[^\]]+\])?(?:\.\w+)?)$/;
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
var IPV6_ALL = [[0n, IPV6_MAX]];
var known = (value) => ({ ok: true, value });
var unknown = (reason) => ({ ok: false, reason });
var UNMODELED_ROUTES = ["aws_vpn_gateway_route_propagation"];
var UNMODELED_INSTANCE = ["aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
var UNMODELED = /* @__PURE__ */ new Set([...UNMODELED_ROUTES, ...UNMODELED_INSTANCE]);
var UNMODELED_TGW = ["aws_ec2_transit_gateway_default_route_table_association", "aws_ec2_transit_gateway_default_route_table_propagation", "aws_ec2_transit_gateway_prefix_list_reference", "aws_ec2_transit_gateway_vpc_attachment_accepter"];
var TGW_DEFAULTS = ["association_default_route_table_id", "propagation_default_route_table_id"];
var VPC_DEFAULTS = [
  ["default_route_table_id", "default-rt"],
  ["main_route_table_id", "main-rt"],
  ["default_network_acl_id", "default-nacl"],
  ["default_security_group_id", "default-sg"]
];
var DROP = {
  nat_gateway_id: { text: "nat gateway", why: "a NAT gateway does not carry traffic for connections that start on the internet" },
  vpc_peering_connection_id: { text: "vpc peering connection", why: "a peered VPC cannot use another VPC's internet gateway (no edge to edge routing)" },
  // "prevent the internet from initiating connections with the instances"
  // https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html
  egress_only_gateway_id: { text: "egress-only internet gateway", why: "an egress-only internet gateway does not carry traffic for connections that start on the internet" }
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
function azOf(s) {
  const az = typeof s.values.availability_zone === "string" ? s.values.availability_zone : void 0;
  return az && !isUnknown(s, ["availability_zone"]) ? known(az) : unknown(`${s.address}: availability_zone is unknown until apply`);
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
var localRoutes = (vpc, table, cidrs) => vpc.blocks ? vpc.blocks.flatMap((b) => {
  const set = cidrToSet(b);
  const prefix = cidrPrefixLength(b);
  return set && prefix !== void 0 ? [{ cidr: set, prefix, target: { kind: "local" }, text: vpc.blocks && vpc.blocks.length > 1 ? `${table} local route (${b})` : `${table} local route` }] : [];
}) : cidrs.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `${table} local route` }));
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
  /** Route table key to the gateway VPC endpoints associated with it. */
  gatewayEndpoints = new Index();
  /** Network interface address to the Elastic IPs associated with it. */
  eniEips = new Index();
  /** Network interface address to security group keys added by aws_network_interface_sg_attachment. */
  eniGroups = new Index();
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
          this.addSgRule(r, this.sgRuleOf(r, egress, r.values.protocol, r.values.from_port, r.values.to_port, arr(r.values.cidr_blocks).map(String), lists, groups, ["protocol", "from_port", "to_port", "cidr_blocks", "ipv6_cidr_blocks", "self"], arr(r.values.ipv6_cidr_blocks).map(String)), egress);
          break;
        }
        case "aws_vpc_security_group_ingress_rule": {
          const cidr = str(r.values.cidr_ipv4);
          const cidr6 = str(r.values.cidr_ipv6);
          this.addSgRule(r, this.sgRuleOf(r, false, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], this.ruleList(r), this.ruleGroups(r, "referenced_security_group_id", false), ["ip_protocol", "from_port", "to_port", "cidr_ipv4", "cidr_ipv6"], cidr6 ? [cidr6] : []), false);
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
          if (isNull(r, "instance") && !isNull(r, "network_interface")) this.eniEip(r, "network_interface");
          else this.eips.add(this.optionalRefTo(r, "instance", "aws_instance"), known(r.address), r.address);
          break;
        }
        case "aws_eip_association": {
          if (isNull(r, "instance_id") && !isNull(r, "network_interface_id")) this.eniEip(r, "network_interface_id");
          else this.eips.add(this.optionalRefTo(r, "instance_id", "aws_instance"), known(r.address), r.address);
          break;
        }
        case "aws_network_interface_sg_attachment": {
          const eni = this.refTo(r, "network_interface_id", "aws_network_interface");
          if (!eni.ok) break;
          const g = this.target(r, "security_group_id");
          this.eniGroups.add(known(eni.value), g.ok && g.value !== null ? known(g.value) : unknown(g.ok ? `${r.address}: security_group_id is outside this plan` : g.reason), r.address);
          break;
        }
        case "aws_vpc_endpoint": {
          if (isNull(r, "route_table_ids") || !isUnknown(r, ["route_table_ids"]) && !arr(r.values.route_table_ids).length) break;
          if (isUnknown(r, ["vpc_endpoint_type"])) {
            this.gatewayEndpoints.add(unknown(`${r.address}: vpc_endpoint_type is unknown until apply, so it may add routes to its route tables`), known(r.address), r.address);
            break;
          }
          if (String(r.values.vpc_endpoint_type ?? "Gateway") !== "Gateway") break;
          const ids = arr(r.values.route_table_ids);
          if (!isUnknown(r, ["route_table_ids"]) && ids.every((v, i) => typeof v === "string" && !isUnknown(r, ["route_table_ids", i]))) {
            for (const id of ids) {
              const k = this.keyOfId(id);
              this.gatewayEndpoints.add(k.ok && k.value === null ? unknown(`${r.address}: route table ${id} is not in this plan`) : k, known(r.address), r.address);
            }
            break;
          }
          for (const ref of resolveRefs(this.snap, r, "route_table_ids", ["aws_route_table", "aws_default_route_table"])) {
            if (ref.kind === "unknown") this.gatewayEndpoints.add(unknown(ref.reason), known(r.address), r.address);
            else if (ref.kind === "external") this.gatewayEndpoints.add(unknown(`${r.address}: route table ${ref.id} is not in this plan`), known(r.address), r.address);
            else this.gatewayEndpoints.add(this.canonical(ref.address), known(r.address), r.address);
          }
          break;
        }
        case "aws_vpc_endpoint_route_table_association": {
          const ep = this.refTo(r, "vpc_endpoint_id", "aws_vpc_endpoint");
          this.gatewayEndpoints.add(this.target(r, "route_table_id"), known(ep.ok ? ep.value : `the endpoint of ${r.address}`), r.address);
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
  /**
   * An Elastic IP on a network interface in the plan. One on an interface that is not
   * an `aws_network_interface` here (an instance's own interface, by
   * `primary_network_interface_id`) cannot be matched to an instance, so every instance
   * is unknown.
   */
  eniEip(r, attr) {
    const eni = this.refTo(r, attr, "aws_network_interface");
    if (eni.ok) this.eniEips.add(known(eni.value), known(r.address), r.address);
    else this.eips.add(unknown(`${r.address} is associated with a network interface that is not an aws_network_interface in this plan (${eni.reason})`), known(r.address), r.address);
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
  sgRuleOf(r, egress, protocolValue, from, to, cidrs, lists, groups, fields, cidrs6 = []) {
    if (fields.some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    if (!cidrs.length && !cidrs6.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) return known(null);
    const protocol = normalizeProtocol(protocolValue);
    if (protocol === "other") return known(null);
    const ports = portSet(protocol, from, to);
    const sets = cidrs.map((c) => cidrToSet(c));
    const sets6 = cidrs6.map((c) => cidr6ToSet(c));
    if (!ports || sets.some((s) => !s) || sets6.some((s) => !s)) return unknown(`${r.address} has a value the engine cannot read`);
    return known(this.rule(r.address, egress, protocol, ports, sets.flat(), cidrs, groups, describePorts(protocol, from, to), lists, cidrs6));
  }
  rule(address, egress, protocol, ports, ranges, cidrs, groups, portText, lists = NO_LISTS, cidrs6 = []) {
    const sources6 = fromRanges6(cidrs6.flatMap((c) => cidr6ToSet(c) ?? []));
    const peers = [...cidrs, ...cidrs6, ...lists.names.map((n) => `prefix list ${n}`), ...lists.unresolved && !lists.names.length ? ["a prefix list that is unknown until apply"] : [], ...groups.keys.map(groupLabel), ...groups.unresolved ? ["a security group that is unknown until apply"] : []];
    return { protocol, ports, sources: fromRanges([...ranges, ...lists.set]), ...sources6.length ? { sources6 } : {}, groups: groups.keys, ...groups.unresolved ? { unresolved: groups.unresolved } : {}, ...lists.unresolved ? { listUnresolved: lists.unresolved } : {}, resource: address, text: `${address} ${egress ? "egress" : "ingress"} ${portText} ${egress ? "to" : "from"} ${peers.join(", ")}` };
  }
  naclRuleOf(r) {
    if (["egress", "rule_number", "protocol", "rule_action", "cidr_block", "ipv6_cidr_block", "from_port", "to_port"].some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    const egress = r.values.egress === true;
    const key = egress ? "egress" : "ingress";
    const cidr6 = str(r.values.ipv6_cidr_block);
    const cidr = str(r.values.cidr_block) ?? cidr6;
    const protocol = normalizeProtocol(r.values.protocol);
    if (protocol === "other") return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol, ports: [], cidr: [], text: `${r.address} (${String(r.values.protocol)})` } });
    const ports = portSet(protocol, r.values.from_port, r.values.to_port);
    const set6 = cidr6 ? cidr6ToSet(cidr6) : void 0;
    const set = cidr6 ? set6 ? [] : void 0 : cidr ? cidrToSet(cidr) : void 0;
    const ruleNo = num(r.values.rule_number);
    if (!cidr || !ports || !set || ruleNo === void 0) return unknown(`${r.address} has a value the engine cannot read`);
    const allow = String(r.values.rule_action).toLowerCase() === "allow";
    return known({ egress, rule: { ruleNo, allow, protocol, ports, cidr: set, ...set6 ? { cidr6: set6 } : {}, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, r.values.from_port, r.values.to_port)} ${egress ? "to" : "from"} ${cidr}` } });
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
    const c6 = str(r.values.destination_ipv6_cidr_block);
    if (!cidr && !listed && !c6) {
      if (isUnknown(r, ["destination_ipv6_cidr_block"]) && r.configured.has("destination_ipv6_cidr_block")) return unknown(`${r.address}: the IPv6 destination is unknown until apply`);
      return known([]);
    }
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
      if (other === "vpc_peering_connection_id" && target.kind === "drop") {
        const id = r.values.vpc_peering_connection_id;
        target = { ...target, peering: !isUnknown(r, ["vpc_peering_connection_id"]) && typeof id === "string" ? this.peeringById(r, id) : this.refTo(r, "vpc_peering_connection_id", "aws_vpc_peering_connection") };
      }
      if (other === "transit_gateway_id" && target.kind === "other") {
        const id = r.values.transit_gateway_id;
        target = { ...target, tgw: !isUnknown(r, ["transit_gateway_id"]) && typeof id === "string" ? this.tgwById(r, id) : this.refTo(r, "transit_gateway_id", "aws_ec2_transit_gateway") };
      }
    }
    if (!isUnknown(r, ["state"]) && r.values.state === "blackhole") target = { kind: "drop", ...BLACKHOLE };
    if (listed) return known(this.listRoutes(this.listsOf(resolveRefs(this.snap, r, "destination_prefix_list_id", "aws_ec2_managed_prefix_list")), target, r.address));
    if (!cidr && c6) {
      const set6 = cidr6ToSet(c6);
      if (!set6) return unknown(`${r.address}: destination ${c6} cannot be read`);
      const to6 = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
      return known([{ cidr: [], cidr6: set6, prefix: prefixLength6(c6) ?? 0, target, text: `${r.address} ${c6} -> ${to6}` }]);
    }
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
    const blocks = cidr ? [cidr] : [];
    let cidrs = isUnknown(r, ["cidr_block"]) || !set ? unknown(`${address}: cidr_block is unknown`) : known(set);
    for (const a of extra) {
      const c = str(a.values.cidr_block);
      const s2 = c && !isUnknown(a, ["cidr_block"]) ? cidrToSet(c) : void 0;
      if (!c || !s2) {
        cidrs = unknown(`${a.address}: cidr_block is unknown until apply (an IPAM pool or a computed value), so the VPC range is not known`);
        break;
      }
      blocks.push(c);
      if (cidrs.ok) cidrs = known(fromRanges([...cidrs.value, ...s2]));
    }
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
    return known({ address, cidrs, ...blocks.length && cidrs.ok ? { blocks } : {}, igw, peerings: this.peeringsOf(address), ipv6: this.vpcIpv6(r), via: [...this.igwAttach.sources(address), ...extra.map((a) => a.address)].toSorted(cmp) });
  }
  /**
   * A VPC's IPv6 block: `ipv6_cidr_block`, an Amazon-provided block
   * (`assign_generated_ipv6_cidr_block`), or an IPAM pool. The provided block is known only
   * after apply.
   * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
   */
  vpcIpv6(r) {
    if (this.ofType("aws_vpc_ipv6_cidr_block_association").length) return unknown(`${r.address} may have IPv6 blocks from aws_vpc_ipv6_cidr_block_association, which is not modeled yet`);
    const cidr = str(r.values.ipv6_cidr_block);
    if (!isUnknown(r, ["ipv6_cidr_block"]) && cidr) {
      const set = cidr6ToSet(cidr);
      return set ? known({ cidrs: set }) : unknown(`${r.address}: ipv6_cidr_block ${cidr} cannot be read`);
    }
    for (const k of ["assign_generated_ipv6_cidr_block", "ipv6_ipam_pool_id"]) {
      if (isUnknown(r, [k]) && r.configured.has(k)) return unknown(`${r.address}: ${k} is unknown until apply`);
    }
    if (r.values.assign_generated_ipv6_cidr_block === true || !isNull(r, "ipv6_ipam_pool_id") || isUnknown(r, ["ipv6_cidr_block"]) && r.configured.has("ipv6_cidr_block")) return known({});
    return known(void 0);
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
      if (["protocol", "from_port", "to_port", "cidr_blocks", "ipv6_cidr_blocks", "self"].some((f) => hasUnknown(r, [dir, i, f]))) return unknown(`${address}: ${dir} rule ${i} has values that are unknown until apply`);
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue;
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      const lists = arr(raw.prefix_list_ids).length || isUnknown(r, [dir, i, "prefix_list_ids"]) ? this.blockLists(r, [dir, i, "prefix_list_ids"], raw.prefix_list_ids) : NO_LISTS;
      const cidrs6 = arr(raw.ipv6_cidr_blocks).map(String);
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s) || cidrs6.some((c) => !cidr6ToSet(c))) return unknown(`${address}: ${dir} rule ${i} has a value the engine cannot read`);
      const groups = this.inlineGroups(r, dir, i, blocks, key);
      if (!cidrs.length && !cidrs6.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) continue;
      rules.push(this.rule(address, dir === "egress", protocol, ports, sets.flat(), cidrs, groups, describePorts(protocol, raw.from_port, raw.to_port), lists, cidrs6));
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
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue;
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidr6 = str(raw.ipv6_cidr_block);
      const set6 = cidr6 ? cidr6ToSet(cidr6) : void 0;
      const cidr = cidr6 ?? str(raw.cidr_block);
      const set = cidr6 ? set6 ? [] : void 0 : cidr ? cidrToSet(cidr) : void 0;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === void 0) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, ...set6 ? { cidr6: set6 } : {}, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
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
        const v = this.vpc(vpc);
        const ipv6 = v.ok && v.value.ipv6?.ok ? v.value.ipv6.value !== void 0 : false;
        const all = (dir) => [
          { ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${dir} rule 100: allow all traffic (AWS default)` },
          ...ipv6 ? [{ ruleNo: 101, allow: true, protocol: "all", ports: ALL_PORTS, cidr: [], cidr6: IPV6_ALL, text: `default NACL of ${vpc} ${dir} rule 101: allow all IPv6 traffic (AWS default)` }] : []
        ];
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
      if (str(raw[key]) || isUnknown(r, [...path, key])) {
        const d = dropOf(key);
        if (d?.kind === "drop" && key === "vpc_peering_connection_id") return { ...d, peering: this.inlinePeering(r, raw, path) };
        if (key === "transit_gateway_id") {
          const id = raw.transit_gateway_id;
          const refs = r.otherRefs.has("route") ? [] : fromConfig(this.snap, r, "route", "aws_ec2_transit_gateway");
          const tgw = !isUnknown(r, [...path, "transit_gateway_id"]) && typeof id === "string" ? this.tgwById(r, id) : refs.length === 1 && refs[0]?.kind === "resource" ? known(refs[0].address) : unknown(`${r.address}: the transit gateway of a route is unknown until apply`);
          return { kind: "other", text: "transit gateway", tgw };
        }
        return d ?? { kind: "other", text: key.replace(/_id$|_arn$/, "").replaceAll("_", " ") };
      }
    }
    return { kind: "unknown", reason: `${r.address}: route has no target the engine can read` };
  }
  /** The peering connection of an inline route: by known ID, else the one the `route` blocks reference. */
  inlinePeering(r, raw, path) {
    const id = raw.vpc_peering_connection_id;
    if (!isUnknown(r, [...path, "vpc_peering_connection_id"]) && typeof id === "string") return this.peeringById(r, id);
    const refs = r.otherRefs.has("route") ? [] : fromConfig(this.snap, r, "route", "aws_vpc_peering_connection");
    return refs.length === 1 && refs[0]?.kind === "resource" ? known(refs[0].address) : unknown(`${r.address}: the peering connection of a route is unknown until apply`);
  }
  /** The aws_vpc_peering_connection with this ID. Its accepter resource has the same ID, so `byId` may name the accepter. */
  peeringById(r, id) {
    const found = this.ofType("aws_vpc_peering_connection").filter((p) => p.values.id === id && !isUnknown(p, ["id"]));
    return found.length === 1 ? known(found[0].address) : unknown(`${r.address}: peering connection ${id} is not in this plan`);
  }
  /**
   * Peering connections of a VPC. A connection carries traffic once active: the accepter
   * accepts it (`auto_accept`, or aws_vpc_peering_connection_accepter), or its state shows
   * `active`.
   * https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html
   */
  peeringsOf(vpc) {
    const out = [];
    for (const p of this.ofType("aws_vpc_peering_connection")) {
      const a = this.optionalRefTo(p, "vpc_id", "aws_vpc");
      const b = this.optionalRefTo(p, "peer_vpc_id", "aws_vpc");
      if (!a.ok) return unknown(a.reason);
      if (!b.ok) return unknown(b.reason);
      if (a.value !== vpc && b.value !== vpc) continue;
      const other = a.value === vpc ? b.value : a.value;
      out.push({ address: p.address, peer: other ? known(other) : unknown(`${p.address}: the peer VPC is not in this plan`), active: this.peeringActive(p) });
    }
    return known(out.toSorted((x, y) => cmp(x.address, y.address)));
  }
  peeringActive(p) {
    const crossing = ["peer_region", "peer_owner_id"].some((k) => !isNull(p, k));
    if (!crossing && !isUnknown(p, ["auto_accept"]) && p.values.auto_accept === true) return known(`${p.address} auto_accept = true`);
    if (!isUnknown(p, ["accept_status"]) && p.values.accept_status === "active") return known(`${p.address} accept_status = active`);
    for (const acc of this.ofType("aws_vpc_peering_connection_accepter")) {
      const id = acc.values.vpc_peering_connection_id;
      const ref = !isUnknown(acc, ["vpc_peering_connection_id"]) && typeof id === "string" ? this.peeringById(acc, id) : this.optionalRefTo(acc, "vpc_peering_connection_id", "aws_vpc_peering_connection");
      if (ref.ok && ref.value === p.address && !isUnknown(acc, ["auto_accept"]) && acc.values.auto_accept === true) return known(`${acc.address} accepts ${p.address}`);
    }
    return unknown(`${p.address} is not accepted in this plan, so it may not be active`);
  }
  /** The aws_ec2_transit_gateway with this ID. */
  tgwById(r, id) {
    const found = this.ofType("aws_ec2_transit_gateway").filter((g) => g.values.id === id && !isUnknown(g, ["id"]));
    return found.length === 1 ? known(found[0].address) : unknown(`${r.address}: transit gateway ${id} is not in this plan`);
  }
  /**
   * An `enable`/`disable` option. A value the provider computes (unknown and not in the
   * configuration) is AWS's default.
   */
  option(r, attr, dflt) {
    if (isUnknown(r, [attr])) return r.configured.has(attr) ? unknown(`${r.address}: ${attr} is unknown until apply`) : known(dflt);
    const v = r.values[attr];
    if (v === null || v === void 0 || v === "") return known(dflt);
    if (v === "enable" || v === true) return known(true);
    if (v === "disable" || v === false) return known(false);
    return unknown(`${r.address}: ${attr} = ${String(v)} cannot be read`);
  }
  /** The key of a transit gateway route table: its address, or `tgw-default-rt:<gateway>`. */
  tgwTableKey(r, attr) {
    const v = r.values[attr];
    const gateways = this.ofType("aws_ec2_transit_gateway");
    if (!isUnknown(r, [attr]) && typeof v === "string" && v) {
      const a = this.snap.byId.get(v);
      if (a && typeOf(a) === "aws_ec2_transit_gateway_route_table") return known(a);
      const g = gateways.find((x) => TGW_DEFAULTS.some((k) => !isUnknown(x, [k]) && x.values[k] === v));
      return g ? known(`tgw-default-rt:${g.address}`) : unknown(`${r.address}: transit gateway route table ${v} is not in this plan`);
    }
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: ${attr} uses values that are unknown until apply`);
    const bases = /* @__PURE__ */ new Map();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) continue;
      const base = m[1];
      if (m[2] || !bases.has(base)) bases.set(base, m[2] ?? bases.get(base));
    }
    const [entry] = [...bases.entries()];
    const address = bases.size === 1 && entry ? instanceOf(this.snap, entry[0]) : void 0;
    if (address && typeOf(address) === "aws_ec2_transit_gateway_route_table") return known(address);
    if (address && typeOf(address) === "aws_ec2_transit_gateway" && entry && TGW_DEFAULTS.includes(entry[1] ?? "")) return known(`tgw-default-rt:${address}`);
    return unknown(`${r.address}: ${attr} is unknown until apply and cannot be matched to one transit gateway route table`);
  }
  transitCache;
  /** Transit gateways in the plan, built once. */
  transit() {
    this.transitCache ??= this.buildTransit();
    return this.transitCache;
  }
  /**
   * Transit gateways, their VPC attachments, associations, and route tables.
   * Rules and sources: docs/semantics/transit-gateway.md.
   * https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html
   */
  buildTransit() {
    for (const type of UNMODELED_TGW) {
      const r = this.ofType(type)[0];
      if (r) return unknown(`${r.address} (${type}) changes transit gateway routing, and ${type} is not modeled yet`);
    }
    const gateways = /* @__PURE__ */ new Map();
    for (const g of this.ofType("aws_ec2_transit_gateway").toSorted((a, b) => cmp(a.address, b.address))) {
      gateways.set(g.address, { sgRefs: this.option(g, "security_group_referencing_support", false), assoc: this.option(g, "default_route_table_association", true), prop: this.option(g, "default_route_table_propagation", true) });
    }
    const hasDefault = (gw) => {
      if (gw.assoc.ok && gw.assoc.value) return known(true);
      if (gw.prop.ok && gw.prop.value) return known(true);
      if (!gw.assoc.ok) return gw.assoc;
      if (!gw.prop.ok) return gw.prop;
      return known(false);
    };
    const names = /* @__PURE__ */ new Map();
    for (const g of gateways.keys()) names.set(`tgw-default-rt:${g}`, `default route table of ${g}`);
    for (const t of this.ofType("aws_ec2_transit_gateway_route_table")) names.set(t.address, t.address);
    const attachRef = (r) => {
      const v = r.values.transit_gateway_attachment_id;
      if (!isUnknown(r, ["transit_gateway_attachment_id"]) && typeof v === "string") {
        const a = this.snap.byId.get(v);
        return a && typeOf(a) === "aws_ec2_transit_gateway_vpc_attachment" ? known(a) : unknown(`${r.address}: attachment ${v} is not a VPC attachment in this plan`);
      }
      return this.refTo(r, "transit_gateway_attachment_id", "aws_ec2_transit_gateway_vpc_attachment");
    };
    const assocOf = /* @__PURE__ */ new Map();
    const propsOf = /* @__PURE__ */ new Map();
    for (const r of this.ofType("aws_ec2_transit_gateway_route_table_association")) {
      const att = attachRef(r);
      const table = this.tgwTableKey(r, "transit_gateway_route_table_id");
      if (!att.ok) return unknown(att.reason);
      if (!table.ok) return unknown(table.reason);
      assocOf.set(att.value, [...assocOf.get(att.value) ?? [], { table: table.value, replace: r.values.replace_existing_association === true, address: r.address }]);
    }
    for (const r of this.ofType("aws_ec2_transit_gateway_route_table_propagation")) {
      const att = attachRef(r);
      const table = this.tgwTableKey(r, "transit_gateway_route_table_id");
      if (!att.ok) return unknown(att.reason);
      if (!table.ok) return unknown(table.reason);
      propsOf.set(table.value, [...propsOf.get(table.value) ?? [], att.value]);
    }
    const attachments = [];
    for (const a of this.ofType("aws_ec2_transit_gateway_vpc_attachment").toSorted((x, y) => cmp(x.address, y.address))) {
      const tgw = this.refTo(a, "transit_gateway_id", "aws_ec2_transit_gateway");
      if (!tgw.ok) return unknown(tgw.reason);
      const vpcRef = this.refTo(a, "vpc_id", "aws_vpc");
      if (!vpcRef.ok) return unknown(vpcRef.reason);
      const gw = gateways.get(tgw.value);
      if (!gw) return unknown(`${a.address}: ${tgw.value} is not an aws_ec2_transit_gateway in this plan`);
      const vpc = this.vpc(vpcRef.value);
      let subnets;
      if (!vpc.ok) subnets = unknown(vpc.reason);
      else {
        const list = [];
        let why;
        for (const ref of resolveRefs(this.snap, a, "subnet_ids", "aws_subnet")) {
          const s = ref.kind === "resource" ? this.get(ref.address) : void 0;
          if (!s) {
            why = ref.kind === "unknown" ? ref.reason : `${a.address}: subnet ${ref.kind === "external" ? ref.id : ""} is not in this plan`;
            break;
          }
          list.push({ address: s.address, az: azOf(s), table: this.subnetRouteTable(s.address, vpc.value) });
        }
        subnets = why ? unknown(why) : known(list.toSorted((x, y) => cmp(x.address, y.address)));
      }
      const explicit = assocOf.get(a.address) ?? [];
      const table = hasDefault(gw);
      const byDefault = !table.ok ? table : table.value ? this.option(a, "transit_gateway_default_route_table_association", true) : known(false);
      let association;
      if (explicit.length > 1) association = unknown(`${a.address} has ${explicit.length} route table associations`);
      else if (explicit[0] && (explicit[0].replace || byDefault.ok && !byDefault.value)) association = known(explicit[0].table);
      else if (explicit[0]) association = unknown(byDefault.ok ? `${a.address} has the default association and ${explicit[0].address} without replace_existing_association` : byDefault.reason);
      else association = byDefault.ok ? known(byDefault.value ? `tgw-default-rt:${tgw.value}` : null) : unknown(byDefault.reason);
      attachments.push({ address: a.address, tgw: tgw.value, vpc: vpcRef.value, subnets, association, sgRefs: this.option(a, "security_group_referencing_support", true) });
    }
    for (const att of attachments) {
      const gw = gateways.get(att.tgw);
      const r = this.get(att.address);
      const has = gw ? hasDefault(gw) : known(false);
      const prop = !has.ok ? has : !has.value ? known(false) : this.option(r, "transit_gateway_default_route_table_propagation", true);
      const key = `tgw-default-rt:${att.tgw}`;
      if (prop && !prop.ok) propsOf.set(key, [...propsOf.get(key) ?? [], `unknown:${prop.reason}`]);
      else if (prop?.value) propsOf.set(key, [...propsOf.get(key) ?? [], att.address]);
    }
    const routes = /* @__PURE__ */ new Map();
    const add = (key, item) => {
      const cur = routes.get(key) ?? known([]);
      if (!cur.ok) return;
      routes.set(key, item.ok ? known([...cur.value, item.value]) : unknown(item.reason));
    };
    for (const key of names.keys()) routes.set(key, known([]));
    for (const r of this.ofType("aws_ec2_transit_gateway_route").toSorted((a, b) => cmp(a.address, b.address))) {
      const key = this.tgwTableKey(r, "transit_gateway_route_table_id");
      if (!key.ok) return unknown(key.reason);
      const name = names.get(key.value) ?? key.value;
      if (hasUnknown(r, ["destination_cidr_block"])) {
        add(key.value, unknown(`${r.address}: destination is unknown until apply`));
        continue;
      }
      const cidr = str(r.values.destination_cidr_block) ?? "";
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === void 0) continue;
      if (!isUnknown(r, ["blackhole"]) && r.values.blackhole === true) {
        add(key.value, known({ cidr: set, prefix, static: true, target: { kind: "blackhole" }, text: `${r.address} ${cidr} -> blackhole (in ${name})` }));
        continue;
      }
      const att = attachRef(r);
      add(key.value, known({ cidr: set, prefix, static: true, target: att.ok ? { kind: "attachment", address: att.value } : { kind: "unknown", reason: att.reason }, text: `${r.address} ${cidr} -> ${att.ok ? att.value : "an attachment outside the plan"} (in ${name})` }));
    }
    for (const [key, list] of [...propsOf.entries()].toSorted(([a], [b]) => cmp(a, b))) {
      const name = names.get(key) ?? key;
      for (const att of [...new Set(list)].toSorted(cmp)) {
        if (att.startsWith("unknown:")) {
          add(key, unknown(att.slice("unknown:".length)));
          continue;
        }
        const a = attachments.find((x) => x.address === att);
        if (!a) {
          add(key, unknown(`${att} is not a VPC attachment in this plan, so the routes it propagates are not known`));
          continue;
        }
        const vpc = this.vpc(a.vpc);
        if (!vpc.ok || !vpc.value.cidrs.ok) {
          add(key, unknown(!vpc.ok ? vpc.reason : vpc.value.cidrs.ok ? "" : vpc.value.cidrs.reason));
          continue;
        }
        const blocks = vpc.value.blocks ?? [];
        for (const b of blocks) {
          const set = cidrToSet(b);
          const prefix = cidrPrefixLength(b);
          if (set && prefix !== void 0) add(key, known({ cidr: set, prefix, static: false, target: { kind: "attachment", address: att }, from: att, text: `${name} ${b} propagated from ${att}` }));
        }
      }
    }
    return known({ gateways: new Map([...gateways].map(([k, v]) => [k, { sgRefs: v.sgRefs }])), attachments, routes, names });
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
        const c6 = str(raw.ipv6_cidr_block);
        if (c6 || isUnknown(r, ["route", i, "ipv6_cidr_block"])) {
          const set6 = c6 ? cidr6ToSet(c6) : void 0;
          if (!set6 || !c6) return unknown(`${r.address}: route ${i} has an IPv6 destination the engine cannot read`);
          const target2 = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
          const to2 = target2.kind === "igw" ? target2.address : target2.kind === "other" || target2.kind === "drop" ? target2.text : target2.kind;
          routes.push({ cidr: [], cidr6: set6, prefix: prefixLength6(c6) ?? 0, target: target2, text: `${r.address} route ${c6} -> ${to2}` });
        }
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
    return { ...this.routeTableOf(key, vpc, isMain), via: [...this.routes.sources(key), ...this.gatewayEndpoints.sources(key), ...isMain ? this.mainAssoc.sources(vpc.address) : []] };
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
    const gw = this.gatewayEndpoints.get(key);
    if (!gw.ok) return { resource, routes: unknown(gw.reason) };
    const endpointRoutes = [...new Set(gw.value)].toSorted(cmp).map((e) => ({ cidr: [], prefix: 0, target: { kind: "other", text: "vpc endpoint" }, text: `${resource} route to the prefix list of gateway endpoint ${e} -> vpc endpoint`, listUnresolved: `the service prefix list of ${e} is managed by AWS and cannot be expanded offline`, awsService: true }));
    const local6 = vpc.ipv6?.ok && vpc.ipv6.value?.cidrs ? vpc.ipv6.value.cidrs.map((r) => ({ cidr: [], cidr6: [r], prefix: 128 - (r[1] - r[0] + 1n).toString(2).length + 1, target: { kind: "local" }, text: `${resource} local route (IPv6)` })) : [];
    return { resource, routes: known([...localRoutes(vpc, resource, vpc.cidrs.value), ...local6, ...base.value, ...extra.value.filter((x) => x.cidr.length || x.cidr6 || x.listUnresolved), ...endpointRoutes]) };
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
      ...this.ofType("aws_elb").flatMap((r) => this.classicLoadBalancer(r)),
      ...this.ofType("aws_vpc_endpoint").flatMap((r) => this.interfaceEndpoint(r))
    ];
  }
  fail(r, reason) {
    return { address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), subnetCidr: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) };
  }
  /** An endpoint for `r` placed in `subnet`. */
  place(r, subnet, publicIp, groups, placement, via = [], publicIp6 = () => known(void 0)) {
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
      publicIp6: publicIp6(s),
      securityGroups: groups(vpcRef.value),
      nacl: this.subnetNacl(subnet, vpcRef.value),
      routeTable: this.subnetRouteTable(subnet, vpc.value),
      az: azOf(s),
      transit: this.transit(),
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
    const nics = arr(r.values.network_interface);
    if (nics.length) return this.instanceWithInterface(r, nics);
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
    const publicIp6 = (s) => {
      const count = r.values.ipv6_address_count;
      if (isUnknown(r, ["ipv6_address_count"]) && r.configured.has("ipv6_address_count")) return unknown(`${r.address}: ipv6_address_count is unknown until apply`);
      if (isUnknown(r, ["ipv6_addresses"]) && r.configured.has("ipv6_addresses")) return unknown(`${r.address}: ipv6_addresses is unknown until apply`);
      if (typeof count === "number" && count > 0) return known(`${r.address} ipv6_address_count = ${count}`);
      if (arr(r.values.ipv6_addresses).length) return known(`${r.address} has ipv6_addresses`);
      if (isUnknown(s, ["assign_ipv6_address_on_creation"]) && s.configured.has("assign_ipv6_address_on_creation")) return unknown(`${s.address}: assign_ipv6_address_on_creation is unknown until apply`);
      if (s.values.assign_ipv6_address_on_creation === true) return known(`${s.address} assign_ipv6_address_on_creation = true`);
      return known(void 0);
    };
    return this.place(r, subnet.value, publicIp, (vpc) => {
      const g = this.groups(r, "vpc_security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    }, void 0, this.eips.sources(r.address), publicIp6);
  }
  /**
   * An instance launched with an existing network interface (a `network_interface` block).
   * The interface decides the subnet and the security groups; "The public IP address can
   * only be assigned to a network interface for eth0, and can only be assigned to a new
   * network interface, not an existing one", so a public IPv4 address comes only from an
   * Elastic IP on the interface. Only the primary interface (device index 0) is modeled.
   * https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_InstanceNetworkInterfaceSpecification.html
   */
  instanceWithInterface(r, nics) {
    const nic = nics[0];
    if (nics.length > 1) return this.fail(r, `${r.address} has more than one network interface; paths through secondary interfaces are not modeled yet`);
    if (!isObj(nic) || hasUnknown(r, ["network_interface", 0, "device_index"]) || num(nic.device_index) !== 0) return this.fail(r, `${r.address}: only the primary network interface (device_index 0) is modeled`);
    const id = nic.network_interface_id;
    let eni;
    if (!isUnknown(r, ["network_interface", 0, "network_interface_id"]) && typeof id === "string") {
      const a = this.snap.byId.get(id);
      eni = a ? this.get(a) : void 0;
      if (!eni) return this.fail(r, `${r.address}: network interface ${id} is not in this plan`);
    } else {
      const refs = r.otherRefs.has("network_interface") ? [] : fromConfig(this.snap, r, "network_interface", "aws_network_interface");
      const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.get(refs[0].address) : void 0;
      if (!one) return this.fail(r, `${r.address}: its network interface is unknown until apply and cannot be matched to one aws_network_interface`);
      eni = one;
    }
    const e = eni;
    const subnet = this.refTo(e, "subnet_id", "aws_subnet");
    if (!subnet.ok) return this.fail(r, subnet.reason);
    const publicIp = () => {
      const onEni = this.eniEips.get(e.address);
      if (!onEni.ok) return unknown(onEni.reason);
      const onInstance = this.eips.get(r.address);
      if (!onInstance.ok) return unknown(onInstance.reason);
      const texts = [
        ...onEni.value.length ? [`${onEni.value.toSorted(cmp).join(", ")} is associated with ${e.address}`] : [],
        ...onInstance.value.length ? [`${onInstance.value.toSorted(cmp).join(", ")} is associated with ${r.address}`] : []
      ];
      return known(texts.length ? texts.join("; ") : void 0);
    };
    const publicIp6 = () => {
      if (isUnknown(e, ["ipv6_address_count"]) && e.configured.has("ipv6_address_count") || isUnknown(e, ["ipv6_addresses"]) && e.configured.has("ipv6_addresses")) return unknown(`${e.address}: its IPv6 addresses are unknown until apply`);
      const count = e.values.ipv6_address_count;
      return typeof count === "number" && count > 0 || arr(e.values.ipv6_addresses).length ? known(`${e.address} has IPv6 addresses`) : known(void 0);
    };
    const groups = (vpc) => {
      const own = this.groups(e, "security_groups", vpc, false);
      const extra = this.eniGroups.get(e.address);
      if (own !== "empty" && !own.ok) return own;
      if (!extra.ok) return unknown(extra.reason);
      const mine = own === "empty" ? [] : own.value;
      const keys = [.../* @__PURE__ */ new Set([...mine.map((g) => g.key), ...extra.value])].toSorted(cmp);
      return known(keys.length ? keys.map((k) => mine.find((g) => g.key === k) ?? this.securityGroup(k)) : [this.securityGroup(`default-sg:${vpc}`)]);
    };
    return this.place(r, subnet.value, publicIp, groups, void 0, [e.address, ...this.eniEips.sources(e.address), ...this.eips.sources(r.address), ...this.eniGroups.sources(e.address)], publicIp6);
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
   * Interface VPC endpoint: "For each subnet that you specify from your VPC, we create an
   * endpoint network interface in the subnet and assign it a private IP address from the
   * subnet address range." Security groups: "By default, we associate the default security
   * group for the VPC." It has no public address, so it matters for paths inside the VPC.
   * https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html
   */
  interfaceEndpoint(r) {
    if (isUnknown(r, ["vpc_endpoint_type"])) return [this.fail(r, `${r.address}: vpc_endpoint_type is unknown until apply`)];
    if (String(r.values.vpc_endpoint_type ?? "Gateway") !== "Interface") return [];
    const refs = resolveRefs(this.snap, r, "subnet_ids", "aws_subnet");
    const bad = refs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    const groups = (vpc) => {
      const g = this.groups(r, "security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    };
    return refs.map((x) => this.place(r, x.address, () => known(void 0), groups, "the result differs between the endpoint's subnets"));
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
    const publicIp6 = () => {
      if (isUnknown(r, ["internal"]) || isUnknown(r, ["ip_address_type"]) && r.configured.has("ip_address_type")) return unknown(`${r.address}: internal or ip_address_type is unknown until apply`);
      const ipType = isUnknown(r, ["ip_address_type"]) ? "ipv4" : String(r.values.ip_address_type ?? "ipv4");
      return r.values.internal !== true && ipType.startsWith("dualstack") ? known(`${r.address} is internet-facing with ip_address_type = ${ipType}`) : known(void 0);
    };
    return subnets.value.map((sub) => this.place(r, sub, publicIp, groups, "the result differs between the load balancer's subnets", [], publicIp6));
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

// ../engine/src/gcp/model.ts
var known2 = (value) => ({ ok: true, value });
var unknown2 = (reason) => ({ ok: false, reason });
var UNMODELED_POLICIES = ["google_compute_network_firewall_policy_association", "google_compute_region_network_firewall_policy_association", "google_compute_firewall_policy_association"];
var UNMODELED_ROUTES2 = ["google_network_connectivity_policy_based_route"];
var strList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
var lastSegment = (v) => v.split("/").at(-1) ?? v;
function portsOf(protocol, ports) {
  const list = strList(ports);
  if (protocol === "all" || !list.length) return ALL_PORTS;
  const ranges = [];
  for (const p of list) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim());
    if (!m) return void 0;
    ranges.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return fromRanges(ranges);
}
var GcpModel = class {
  constructor(snap) {
    this.snap = snap;
  }
  snap;
  ofType(type) {
    return [...this.snap.resources.values()].filter((r) => r.type === type).toSorted((a, b) => cmp(a.address, b.address));
  }
  /** The google_compute_network a value names (name, ID, or self link), or one configuration reference. */
  networkOf(r, attr, value, unknownValue) {
    if (!unknownValue && typeof value === "string" && value) {
      const name = lastSegment(value);
      const found = this.ofType("google_compute_network").filter((n) => !isUnknown(n, ["name"]) && n.values.name === name);
      if (found.length === 1) return known2(found[0].address);
      return unknown2(`${r.address}: network ${value} is not in this plan; its firewall rules (for the default network, rules that allow incoming connections) are not known`);
    }
    if (r.otherRefs.has(attr)) return unknown2(`${r.address}: its network uses values that are unknown until apply`);
    const refs = fromConfig(this.snap, r, attr, "google_compute_network");
    if (refs.length === 1 && refs[0]?.kind === "resource") return known2(refs[0].address);
    const subs = fromConfig(this.snap, r, attr, "google_compute_subnetwork");
    const sub = subs.length === 1 && subs[0]?.kind === "resource" ? this.snap.resources.get(subs[0].address) : void 0;
    if (sub) return this.networkOf(sub, "network", sub.values.network, isUnknown(sub, ["network"]));
    return unknown2(`${r.address}: its network is unknown until apply and cannot be matched to one google_compute_network`);
  }
  /** The network of the subnetwork a VM interface names: a known value by its name, else a configuration reference. */
  subnetNetwork(r, value, unknownValue) {
    if (!unknownValue && typeof value === "string" && value) {
      const name = lastSegment(value);
      const found = this.ofType("google_compute_subnetwork").filter((n) => !isUnknown(n, ["name"]) && n.values.name === name);
      if (found.length !== 1) return unknown2(`${r.address}: subnetwork ${value} is not one google_compute_subnetwork in this plan`);
      const sub = found[0];
      return this.networkOf(sub, "network", sub.values.network, isUnknown(sub, ["network"]));
    }
    return this.networkOf(r, "network_interface", value, true);
  }
  vms() {
    return [...this.ofType("google_compute_instance").map((r) => this.vm(r)), ...this.ofType("google_sql_database_instance").map((r) => this.sql(r))];
  }
  /**
   * A Cloud SQL instance: a public IP when ipv4_enabled, and the authorized networks as the
   * only allow rules on the engine's port (docs/semantics/gcp.md, rules 10 to 12).
   */
  sql(r) {
    const base = { address: r.address, type: r.type, network: known2(r.address), route: known2(null), implied: "no authorized network: Cloud SQL refuses the connection" };
    const fail = (reason) => ({ ...base, externalIp: unknown2(reason), firewall: unknown2(reason) });
    if (isUnknown(r, ["database_version"])) return fail(`${r.address}: database_version is unknown until apply`);
    const version = typeof r.values.database_version === "string" ? r.values.database_version : "";
    const port = version.startsWith("POSTGRES") ? 5432 : version.startsWith("MYSQL") ? 3306 : version.startsWith("SQLSERVER") ? 1433 : void 0;
    if (!port) return fail(`${r.address}: database_version ${version || "(none)"} is not a known engine`);
    const path = ["settings", 0, "ip_configuration", 0];
    if (isUnknown(r, ["settings"]) || isUnknown(r, ["settings", 0, "ip_configuration"])) return fail(`${r.address}: ip_configuration is unknown until apply`);
    const settings = Array.isArray(r.values.settings) && isObj(r.values.settings[0]) ? r.values.settings[0] : {};
    const ipc = Array.isArray(settings.ip_configuration) && isObj(settings.ip_configuration[0]) ? settings.ip_configuration[0] : {};
    if (isUnknown(r, [...path, "ipv4_enabled"])) return fail(`${r.address}: ipv4_enabled is unknown until apply`);
    const publicIp = ipc.ipv4_enabled !== false;
    if (hasUnknown(r, [...path, "authorized_networks"])) return { ...fail(`${r.address}: an authorized network is unknown until apply`), externalIp: known2(publicIp ? `${r.address} has a public IP address (ipv4_enabled)` : void 0) };
    const rules = [];
    for (const n of Array.isArray(ipc.authorized_networks) ? ipc.authorized_networks : []) {
      if (!isObj(n) || typeof n.value !== "string") return fail(`${r.address}: an authorized network has no value the engine can read`);
      const set = cidrToSet(n.value.includes("/") ? n.value : `${n.value}/32`);
      if (!set) return fail(`${r.address}: authorized network ${n.value} cannot be read`);
      rules.push({ resource: r.address, priority: 0, allow: true, protocol: "tcp", ports: fromRanges([[port, port]]), sources: set, text: `${r.address} authorized network ${typeof n.name === "string" && n.name ? `${n.name} ` : ""}${n.value} on tcp ${port}` });
    }
    return { ...base, externalIp: known2(publicIp ? `${r.address} has a public IP address (ipv4_enabled)` : void 0), firewall: known2(rules.toSorted((a, b) => cmp(a.text, b.text))) };
  }
  vm(r) {
    const fail = (reason) => ({ address: r.address, type: r.type, network: unknown2(reason), externalIp: unknown2(reason), firewall: unknown2(reason), route: unknown2(reason), implied: IMPLIED_VM });
    if (isUnknown(r, ["network_interface"])) return fail(`${r.address}: network_interface is unknown until apply`);
    const nics = Array.isArray(r.values.network_interface) ? r.values.network_interface : [];
    if (nics.length !== 1) return fail(`${r.address} has ${nics.length} network interfaces; only VMs with one are modeled`);
    const nic = nics[0];
    if (!isObj(nic)) return fail(`${r.address}: network_interface cannot be read`);
    const netUnknown = isUnknown(r, ["network_interface", 0, "network"]);
    const net = netUnknown || typeof nic.network === "string" && nic.network ? this.networkOf(r, "network_interface", nic.network, netUnknown) : this.subnetNetwork(r, nic.subnetwork, isUnknown(r, ["network_interface", 0, "subnetwork"]));
    let externalIp;
    if (isUnknown(r, ["network_interface", 0, "access_config"])) externalIp = unknown2(`${r.address}: access_config is unknown until apply`);
    else {
      const configs = Array.isArray(nic.access_config) ? nic.access_config : [];
      const ip = configs.length && isObj(configs[0]) && typeof configs[0].nat_ip === "string" && configs[0].nat_ip ? configs[0].nat_ip : void 0;
      externalIp = known2(configs.length ? ip ? `${r.address} has the external IP address ${ip}` : `${r.address} has an external IP address (access_config)` : void 0);
    }
    if (!net.ok) return { address: r.address, type: r.type, network: net, externalIp, firewall: unknown2(net.reason), route: unknown2(net.reason), implied: IMPLIED_VM };
    return { address: r.address, type: r.type, network: net, externalIp, firewall: this.firewall(r, net.value), route: this.route(r, net.value), implied: IMPLIED_VM };
  }
  /** Whether `target_tags` / `target_service_accounts` select the VM (rule 5). */
  targets(rule, vm) {
    for (const attr of ["target_tags", "target_service_accounts"]) if (hasUnknown(rule, [attr])) return unknown2(`${rule.address}: ${attr} is unknown until apply`);
    const tags = strList(rule.values.target_tags);
    const accounts = strList(rule.values.target_service_accounts);
    if (!tags.length && !accounts.length) return known2(true);
    if (tags.length) {
      if (hasUnknown(vm, ["tags"])) return unknown2(`${vm.address}: tags are unknown until apply, and ${rule.address} applies to tags ${tags.join(", ")}`);
      return known2(strList(vm.values.tags).some((t) => tags.includes(t)));
    }
    if (hasUnknown(vm, ["service_account"])) return unknown2(`${vm.address}: service_account is unknown until apply, and ${rule.address} applies to service accounts`);
    const sa = Array.isArray(vm.values.service_account) ? vm.values.service_account : [];
    const emails = [];
    for (const [i, s] of sa.entries()) {
      if (isUnknown(vm, ["service_account", i, "email"])) return unknown2(`${vm.address}: its service account email is unknown until apply, and ${rule.address} applies to service accounts`);
      if (isObj(s) && typeof s.email === "string") emails.push(s.email);
    }
    return known2(emails.some((e) => accounts.includes(e)));
  }
  /**
   * The network's ingress rules that apply to the VM, in evaluation order: lower priority
   * number first, deny before allow on a tie (rule 3).
   */
  firewall(vm, network) {
    for (const type of UNMODELED_POLICIES) {
      const p = this.ofType(type)[0];
      if (p) return unknown2(`${p.address} (${type}) adds firewall policy rules, and ${type} is not modeled yet`);
    }
    const out = [];
    for (const r of this.ofType("google_compute_firewall")) {
      const net = this.networkOf(r, "network", r.values.network, isUnknown(r, ["network"]));
      if (!net.ok) {
        return unknown2(net.reason);
      }
      if (net.value !== network) continue;
      for (const attr of ["allow", "deny", "source_ranges", "source_tags", "source_service_accounts"]) if (hasUnknown(r, [attr])) return unknown2(`${r.address}: ${attr} is unknown until apply`);
      const direction = valueOr(r, "direction", "INGRESS");
      const disabled = valueOr(r, "disabled", false);
      const prio = valueOr(r, "priority", 1e3);
      for (const v of [direction, disabled, prio]) if (!v.ok) return unknown2(v.reason);
      if (String(direction.ok && direction.value) !== "INGRESS" || disabled.ok && disabled.value === true) continue;
      const target = this.targets(r, vm);
      if (!target.ok) return target;
      if (!target.value) continue;
      const priority = prio.ok && typeof prio.value === "number" ? prio.value : 1e3;
      const ranges = strList(r.values.source_ranges);
      const anySource = !ranges.length && !strList(r.values.source_tags).length && !strList(r.values.source_service_accounts).length;
      const sources = [];
      for (const c of anySource ? ["0.0.0.0/0"] : ranges) {
        if (c.includes(":")) continue;
        const set = cidrToSet(c);
        if (!set) return unknown2(`${r.address}: source range ${c} cannot be read`);
        sources.push(...set);
      }
      for (const action of ["deny", "allow"]) {
        for (const block of Array.isArray(r.values[action]) ? r.values[action] : []) {
          if (!isObj(block)) continue;
          const protocol = normalizeProtocol(block.protocol);
          const ports = portsOf(protocol, block.ports);
          if (!ports) return unknown2(`${r.address}: ports ${strList(block.ports).join(", ")} cannot be read`);
          const portText = protocol === "all" ? "all traffic" : `${String(block.protocol)} ${strList(block.ports).join(", ") || "all ports"}`;
          out.push({ resource: r.address, priority, allow: action === "allow", protocol, ports, sources: fromRanges(sources), text: `${r.address} priority ${priority}: ${action} ${portText} from ${anySource ? "0.0.0.0/0" : ranges.join(", ") || "tagged instances only"}` });
        }
      }
    }
    return known2(out.toSorted((a, b) => a.priority - b.priority || Number(a.allow) - Number(b.allow) || cmp(a.text, b.text)));
  }
  /** Whether the response can use the default internet gateway (rule 9). */
  route(vm, network) {
    for (const type of UNMODELED_ROUTES2) {
      const p = this.ofType(type)[0];
      if (p) return unknown2(`${p.address} (${type}) can change routing, and ${type} is not modeled yet`);
    }
    const n = this.snap.resources.get(network);
    if (isUnknown(n, ["delete_default_routes_on_create"])) return unknown2(`${network}: delete_default_routes_on_create is unknown until apply`);
    let viaGateway = n.values.delete_default_routes_on_create === true ? void 0 : `${network} system default route 0.0.0.0/0 -> default internet gateway`;
    for (const r of this.ofType("google_compute_route")) {
      const net = this.networkOf(r, "network", r.values.network, isUnknown(r, ["network"]));
      if (!net.ok) return unknown2(net.reason);
      if (net.value !== network) continue;
      if (hasAnyUnknown(r, ["dest_range", "tags", "next_hop_gateway"])) return unknown2(`${r.address}: its destination, tags, or next hop are unknown until apply`);
      const tags = strList(r.values.tags);
      if (tags.length) {
        if (hasUnknown(vm, ["tags"])) return unknown2(`${vm.address}: tags are unknown until apply, and ${r.address} applies to tags ${tags.join(", ")}`);
        if (!strList(vm.values.tags).some((t) => tags.includes(t))) continue;
      }
      const dest = typeof r.values.dest_range === "string" ? r.values.dest_range : "";
      const gw = typeof r.values.next_hop_gateway === "string" ? r.values.next_hop_gateway : "";
      const toGateway = gw !== "" && lastSegment(gw) === "default-internet-gateway";
      const set = cidrToSet(dest);
      if (!set) return unknown2(`${r.address}: destination ${dest} cannot be read`);
      if (isPrivate(set)) continue;
      if (toGateway && dest === "0.0.0.0/0") viaGateway ??= `${r.address} 0.0.0.0/0 -> default internet gateway`;
      else if (!toGateway) return unknown2(`${r.address} sends ${dest} to another next hop, so responses to some internet clients may not use the default internet gateway; custom routes are not modeled yet`);
    }
    if (!viaGateway) return unknown2(`${network} has no default route to the default internet gateway (delete_default_routes_on_create = true); whether a response needs it is not documented`);
    return known2({ ok: true, resource: network, text: viaGateway });
  }
};
function valueOr(r, attr, dflt) {
  if (isUnknown(r, [attr])) return r.configured.has(attr) ? unknown2(`${r.address}: ${attr} is unknown until apply`) : known2(dflt);
  const v = r.values[attr];
  return known2(v === null || v === void 0 ? dflt : v);
}
var IMPLIED_VM = "implied rule: deny all ingress";
var hasAnyUnknown = (r, attrs) => attrs.some((a) => hasUnknown(r, [a]));
var PRIVATE = fromRanges(["10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16"].flatMap((c) => cidrToSet(c) ?? []));
var isPrivate = (set) => set.every(([lo, hi]) => PRIVATE.some(([plo, phi]) => lo >= plo && hi <= phi));

// ../engine/src/azure/model.ts
var known3 = (value) => ({ ok: true, value });
var unknown3 = (reason) => ({ ok: false, reason });
var VMS = ["azurerm_linux_virtual_machine", "azurerm_windows_virtual_machine"];
var PLATFORM = cidrToSet("168.63.129.16/32") ?? EMPTY;
var DROPPED = ["157.59.0.0/16", "104.147.0.0/16", "104.146.0.0/17"];
var strs = (...vs) => vs.flatMap((v) => Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x !== "");
var setOf = (cidrs) => {
  let out = EMPTY;
  for (const c of cidrs) {
    const s = cidrToSet(c.includes("/") ? c : `${c}/32`);
    if (!s) return void 0;
    out = union(out, s);
  }
  return out;
};
var prefixOf = (c) => Number(c.split("/")[1] ?? 32);
function portsOf2(list) {
  if (!list.length || list.includes("*")) return ALL_PORTS;
  const ranges = [];
  for (const p of list) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim());
    if (!m) return void 0;
    ranges.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return fromRanges(ranges);
}
var protocolOf = (p) => {
  const s = String(p).toLowerCase();
  return s === "*" ? "all" : s === "tcp" ? "tcp" : s === "udp" ? "udp" : "other";
};
var AzureModel = class {
  constructor(snap) {
    this.snap = snap;
    let space = EMPTY;
    let why;
    for (const n of this.ofType("azurerm_virtual_network")) {
      if (hasUnknown(n, ["address_space"])) why ??= `${n.address}: address_space is unknown until apply`;
      const s = setOf(strs(n.values.address_space));
      if (!s) why ??= `${n.address}: address_space cannot be read`;
      else space = union(space, s);
    }
    this.vnetSpace = why ? unknown3(why) : known3(space);
  }
  snap;
  vnetSpace;
  ofType(type) {
    return [...this.snap.resources.values()].filter((r) => r.type === type).toSorted((a, b) => cmp(a.address, b.address));
  }
  /** A resource that an ID attribute names: a known ID, else one configuration reference. */
  byRef(r, attr, value, unknownValue, type) {
    if (!unknownValue && typeof value === "string" && value) {
      const a = this.snap.byId.get(value);
      const found = a ? this.snap.resources.get(a) : void 0;
      return found && found.type === type ? known3(found) : unknown3(`${r.address}: ${value} is not a ${type} in this plan`);
    }
    if (r.otherRefs.has(attr)) return unknown3(`${r.address}: ${attr} uses values that are unknown until apply`);
    const refs = fromConfig(this.snap, r, attr, type);
    const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.snap.resources.get(refs[0].address) : void 0;
    return one ? known3(one) : unknown3(`${r.address}: its ${type} is unknown until apply and cannot be matched to one resource`);
  }
  /** A resource named by `name` and `resource_group_name` (rule resources), else one configuration reference. */
  byName(r, attr, type) {
    const name = r.values[attr];
    const rg = r.values.resource_group_name;
    if (!isUnknown(r, [attr]) && typeof name === "string" && !isUnknown(r, ["resource_group_name"]) && typeof rg === "string") {
      const found = this.ofType(type).filter((x) => x.values.name === name && x.values.resource_group_name === rg && !isUnknown(x, ["name"]));
      if (found.length === 1) return known3(found[0]);
    }
    const refs = fromConfig(this.snap, r, attr, type);
    const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.snap.resources.get(refs[0].address) : void 0;
    return one ? known3(one) : unknown3(`${r.address}: ${attr} cannot be matched to one ${type} in this plan`);
  }
  vms() {
    return VMS.flatMap((t) => this.ofType(t)).toSorted((a, b) => cmp(a.address, b.address)).map((r) => this.vm(r));
  }
  vm(r) {
    const universe = subtract(subtract(subtract(PUBLIC_IPV4, PLATFORM), DROPPED_SET), this.vnetSpace.ok ? this.vnetSpace.value : EMPTY);
    const fail = (reason) => ({ address: r.address, type: r.type, publicIp: unknown3(reason), subnetNsg: unknown3(reason), nicNsg: unknown3(reason), routes: unknown3(reason), universe });
    if (!this.vnetSpace.ok) return fail(this.vnetSpace.reason);
    const nics = resolveRefs(this.snap, r, "network_interface_ids", "azurerm_network_interface");
    if (nics.length !== 1) return fail(`${r.address} has ${nics.length} network interfaces; only VMs with one are modeled`);
    const ref = nics[0];
    if (ref?.kind !== "resource") return fail(ref?.kind === "unknown" ? ref.reason : `${r.address}: its network interface is not in this plan`);
    const nic = this.snap.resources.get(ref.address);
    if (isUnknown(nic, ["ip_configuration"])) return fail(`${nic.address}: ip_configuration is unknown until apply`);
    const configs = Array.isArray(nic.values.ip_configuration) ? nic.values.ip_configuration : [];
    if (configs.length !== 1 || !isObj(configs[0])) return fail(`${nic.address} has ${configs.length} IP configurations; only one is modeled`);
    const ipc = configs[0];
    const subnet = this.byRef(nic, "ip_configuration", ipc.subnet_id, isUnknown(nic, ["ip_configuration", 0, "subnet_id"]), "azurerm_subnet");
    if (!subnet.ok) return fail(subnet.reason);
    const s = subnet.value;
    if (hasUnknown(s, ["address_prefixes"])) return fail(`${s.address}: address_prefixes is unknown until apply`);
    const subnetSet = setOf(strs(s.values.address_prefixes));
    if (!subnetSet || isEmpty(subnetSet)) return fail(`${s.address}: address_prefixes cannot be read`);
    return {
      address: r.address,
      type: r.type,
      publicIp: this.publicIp(nic, ipc),
      subnetNsg: this.associated("azurerm_subnet_network_security_group_association", "subnet_id", "azurerm_subnet", s, subnetSet),
      nicNsg: this.associated("azurerm_network_interface_security_group_association", "network_interface_id", "azurerm_network_interface", nic, subnetSet),
      routes: this.routes(s),
      universe
    };
  }
  /** Rules 1 and 2: a Standard public IP on the interface's IP configuration. */
  publicIp(nic, ipc) {
    const path = ["ip_configuration", 0, "public_ip_address_id"];
    if (!isUnknown(nic, path) && (ipc.public_ip_address_id === null || ipc.public_ip_address_id === void 0 || ipc.public_ip_address_id === "")) return known3(void 0);
    const pip = this.byRef(nic, "ip_configuration", ipc.public_ip_address_id, isUnknown(nic, path), "azurerm_public_ip");
    if (!pip.ok) return unknown3(pip.reason);
    const p = pip.value;
    if (isUnknown(p, ["sku"]) && p.configured.has("sku")) return unknown3(`${p.address}: sku is unknown until apply`);
    const sku = typeof p.values.sku === "string" ? p.values.sku : "Standard";
    if (sku !== "Standard") return unknown3(`${p.address} has the ${sku} SKU; Basic public IPs are retired and open by default, which is not modeled`);
    return known3(`${p.address} (Standard) is on ${nic.address}`);
  }
  /** The NSG an association resource attaches to `target` (a subnet or an interface), or null. */
  associated(type, attr, targetType, target, subnet) {
    const found = [];
    for (const a of this.ofType(type)) {
      const t = this.byRef(a, attr, a.values[attr], isUnknown(a, [attr]), targetType);
      if (!t.ok) return unknown3(t.reason);
      if (t.value.address !== target.address) continue;
      const nsg2 = this.byRef(a, "network_security_group_id", a.values.network_security_group_id, isUnknown(a, ["network_security_group_id"]), "azurerm_network_security_group");
      if (!nsg2.ok) return unknown3(nsg2.reason);
      found.push(nsg2.value);
    }
    if (found.length > 1) return unknown3(`${target.address} has ${found.length} network security group associations`);
    const nsg = found[0];
    return known3(nsg ? { resource: nsg.address, rules: this.rules(nsg, subnet) } : null);
  }
  /** The NSG's inbound rules for a VM in `subnet` (rules 4 to 6), with the default rules. */
  rules(nsg, subnet) {
    if (hasUnknown(nsg, ["security_rule"]) && nsg.configured.has("security_rule")) return unknown3(`${nsg.address}: security_rule is unknown until apply`);
    const raw = [];
    for (const b of !isUnknown(nsg, ["security_rule"]) && Array.isArray(nsg.values.security_rule) ? nsg.values.security_rule : []) if (isObj(b)) raw.push({ values: b, label: `${nsg.address} rule ${String(b.name)}` });
    for (const r of this.ofType("azurerm_network_security_rule")) {
      const owner = this.byName(r, "network_security_group_name", "azurerm_network_security_group");
      if (!owner.ok) return unknown3(owner.reason);
      if (owner.value.address !== nsg.address) continue;
      if (anyUnknown(r, ["priority", "direction", "access", "protocol", "source_address_prefix", "source_address_prefixes", "destination_address_prefix", "destination_address_prefixes", "destination_port_range", "destination_port_ranges", "source_port_range", "source_port_ranges", "destination_application_security_group_ids", "source_application_security_group_ids"])) return unknown3(`${r.address}: a field is unknown until apply`);
      raw.push({ values: r.values, label: r.address });
    }
    const vnet = this.vnetSpace.ok ? this.vnetSpace.value : EMPTY;
    const out = [];
    for (const { values: v, label } of raw) {
      if (String(v.direction) !== "Inbound") continue;
      const priority = typeof v.priority === "number" ? v.priority : NaN;
      if (!Number.isFinite(priority)) return unknown3(`${label}: priority cannot be read`);
      const ports = portsOf2(strs(v.destination_port_range, v.destination_port_ranges));
      if (!ports) return unknown3(`${label}: destination ports cannot be read`);
      const text = `${label} priority ${priority}: ${String(v.access).toLowerCase()} ${String(v.protocol)} ${strs(v.destination_port_range, v.destination_port_ranges).join(", ") || "*"} from ${strs(v.source_address_prefix, v.source_address_prefixes).join(", ") || "application security groups"}`;
      const doubts = [];
      const srcPorts = strs(v.source_port_range, v.source_port_ranges);
      if (srcPorts.length && !srcPorts.includes("*")) doubts.push("its source ports depend on the client");
      if (strs(v.destination_application_security_group_ids).length) doubts.push("its destination is an application security group, which is not modeled yet");
      else {
        let covers = false;
        for (const d of strs(v.destination_address_prefix, v.destination_address_prefixes)) {
          if (["*", "Any", "VirtualNetwork", "0.0.0.0/0"].includes(d)) covers = true;
          else if (d === "Internet" || d.includes(":") || /^[A-Za-z]/.test(d)) continue;
          else {
            const set = setOf([d]);
            if (!set) return unknown3(`${label}: destination ${d} cannot be read`);
            if (contains(set, subnet)) covers = true;
            else if (!isEmpty(intersect(set, subnet))) doubts.push(`its destination ${d} covers only part of the subnet, and the VM's address is not known before apply`);
          }
        }
        if (!covers && !doubts.length) continue;
        if (covers) doubts.splice(0, doubts.length, ...doubts.filter((d) => d.startsWith("its source ports")));
      }
      let sources = EMPTY;
      for (const src of strs(v.source_address_prefix, v.source_address_prefixes)) {
        if (["*", "Any", "Internet", "0.0.0.0/0"].includes(src)) sources = ALL_IPV4_SET;
        else if (src === "AzureLoadBalancer") sources = union(sources, PLATFORM);
        else if (src === "VirtualNetwork") {
          if (!isEmpty(intersect(vnet, PUBLIC_IPV4))) doubts.push("VirtualNetwork includes a public address space");
          sources = union(sources, vnet);
        } else if (src.includes(":")) continue;
        else if (/^[A-Za-z]/.test(src)) doubts.push(`its source is the service tag ${src}, whose addresses are not in the plan`);
        else {
          const set = setOf([src]);
          if (!set) return unknown3(`${label}: source ${src} cannot be read`);
          sources = union(sources, set);
        }
      }
      out.push({ priority, allow: String(v.access) === "Allow", protocol: protocolOf(v.protocol), ports, sources, text, ...doubts.length ? { doubt: `${label}: ${doubts.join("; ")}` } : {} });
    }
    out.push(
      { priority: 65e3, allow: true, protocol: "all", ports: ALL_PORTS, sources: vnet, text: `${nsg.address} default rule AllowVnetInBound (65000): allow from VirtualNetwork` },
      { priority: 65001, allow: true, protocol: "all", ports: ALL_PORTS, sources: PLATFORM, text: `${nsg.address} default rule AllowAzureLoadBalancerInBound (65001): allow from AzureLoadBalancer` },
      { priority: 65500, allow: false, protocol: "all", ports: ALL_PORTS, sources: ALL_IPV4_SET, text: `${nsg.address} default rule DenyAllInbound (65500): deny all` }
    );
    return known3(out.toSorted((a, b) => a.priority - b.priority || cmp(a.text, b.text)));
  }
  /** The subnet's routes: system routes and the user-defined routes of its route table (rule 8). */
  routes(s) {
    const system = [
      { cidr: cidrToSet("0.0.0.0/0") ?? EMPTY, prefix: 0, hop: "Internet", user: false, text: "system route 0.0.0.0/0 -> Internet" },
      ...DROPPED.map((c) => ({ cidr: cidrToSet(c) ?? EMPTY, prefix: prefixOf(c), hop: "None", user: false, text: `system route ${c} -> None` }))
    ];
    const tables = [];
    for (const a of this.ofType("azurerm_subnet_route_table_association")) {
      const t = this.byRef(a, "subnet_id", a.values.subnet_id, isUnknown(a, ["subnet_id"]), "azurerm_subnet");
      if (!t.ok) return unknown3(t.reason);
      if (t.value.address !== s.address) continue;
      const table2 = this.byRef(a, "route_table_id", a.values.route_table_id, isUnknown(a, ["route_table_id"]), "azurerm_route_table");
      if (!table2.ok) return unknown3(table2.reason);
      tables.push(table2.value);
    }
    if (tables.length > 1) return unknown3(`${s.address} has ${tables.length} route table associations`);
    const table = tables[0];
    if (!table) return known3(system);
    if (hasUnknown(table, ["route"]) && table.configured.has("route")) return unknown3(`${table.address}: route is unknown until apply`);
    const user = (!isUnknown(table, ["route"]) && Array.isArray(table.values.route) ? table.values.route : []).filter(isObj).map((v) => ({ v, label: `${table.address} route ${String(v.name)}` }));
    for (const r of this.ofType("azurerm_route")) {
      const owner = this.byName(r, "route_table_name", "azurerm_route_table");
      if (!owner.ok) return unknown3(owner.reason);
      if (owner.value.address !== table.address) continue;
      if (anyUnknown(r, ["address_prefix", "next_hop_type"])) return unknown3(`${r.address}: address_prefix or next_hop_type is unknown until apply`);
      user.push({ v: r.values, label: r.address });
    }
    const out = [];
    for (const { v, label } of user) {
      const c = typeof v.address_prefix === "string" ? v.address_prefix : "";
      if (c.includes(":")) continue;
      if (/^[A-Za-z]/.test(c)) return unknown3(`${label}: a service tag prefix (${c}) is not modeled yet`);
      const set = cidrToSet(c);
      if (!set) continue;
      out.push({ cidr: set, prefix: prefixOf(c), hop: String(v.next_hop_type), user: true, text: `${label} ${c} -> ${String(v.next_hop_type)}` });
    }
    return known3([...out, ...system.filter((x) => !out.some((u) => u.prefix === x.prefix && contains(u.cidr, x.cidr) && contains(x.cidr, u.cidr)))]);
  }
};
var anyUnknown = (r, attrs) => attrs.some((a) => hasUnknown(r, [a]));
var ALL_IPV4_SET = cidrToSet("0.0.0.0/0") ?? EMPTY;
var DROPPED_SET = DROPPED.reduce((acc, c) => union(acc, cidrToSet(c) ?? EMPTY), EMPTY);
var DROPPED_TEXT = `system routes drop ${DROPPED.join(", ")}`;

// ../engine/src/azure/evaluate.ts
var DOC5 = {
  "public-ip": "https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses",
  nsg: "https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works",
  route: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview"
};
var absent5 = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
var protoMatches5 = (rule, p) => rule === "all" || rule === p;
function nsgEval(nsg, addrs, p, ports) {
  if (!nsg.rules.ok) return { error: nsg.rules.reason };
  let remaining = addrs;
  let allowed = EMPTY;
  const texts = [];
  for (const rule of nsg.rules.value) {
    if (isEmpty(remaining)) break;
    if (!protoMatches5(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    if (rule.doubt) return { allowed, texts, doubt: rule.doubt };
    const m = intersect(remaining, rule.sources);
    if (isEmpty(m)) continue;
    if (rule.allow) allowed = union(allowed, m);
    texts.push(rule.text);
    remaining = subtract(remaining, m);
  }
  return { allowed, texts };
}
function evaluateAzure(vm, p, ports) {
  if (!vm) return absent5;
  const hops = [];
  const add = (hop, resource, decision, rule) => hops.push({ hop, resource, decision, rule, doc: DOC5[hop] });
  const stop = (verdict, reason) => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop, resource, reason) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const portText = `${p}/${formatPorts([ports])}`;
  const universe = vm.universe;
  if (!vm.publicIp.ok) return unknownAt("public-ip", vm.address, vm.publicIp.reason);
  if (!vm.publicIp.value) {
    add("public-ip", vm.address, "deny", `${vm.address} has no public IP address on its network interface`);
    return stop("blocked", `${vm.address} has no public IP address`);
  }
  add("public-ip", vm.address, "allow", vm.publicIp.value);
  if (!vm.subnetNsg.ok) return unknownAt("nsg", vm.address, vm.subnetNsg.reason);
  if (!vm.nicNsg.ok) return unknownAt("nsg", vm.address, vm.nicNsg.reason);
  const levels = [vm.subnetNsg.value, vm.nicNsg.value].filter((n) => n !== null);
  const names = levels.map((n) => n.resource).join(", ");
  if (!levels.length) {
    const why = `no network security group is associated with the subnet or the network interface of ${vm.address}; a Standard public IP is secure by default and closed to inbound traffic`;
    add("nsg", vm.address, "deny", why);
    return stop("blocked", why);
  }
  let sources = universe;
  const texts = [];
  for (const nsg of levels) {
    const r = nsgEval(nsg, sources, p, ports);
    if ("error" in r) return unknownAt("nsg", nsg.resource, r.error);
    texts.push(...r.texts);
    if (r.doubt) return unknownAt("nsg", nsg.resource, r.doubt);
    sources = r.allowed;
    if (isEmpty(sources)) {
      add("nsg", names, "deny", texts.join("; "));
      return stop("blocked", `${nsg.resource} does not allow ${portText} from the internet (${r.texts.at(-1) ?? "DenyAllInbound"})`);
    }
  }
  add("nsg", names, equals(sources, universe) ? "allow" : "partial", texts.join("; "));
  if (!vm.routes.ok) return unknownAt("route", vm.address, vm.routes.reason);
  const routes = vm.routes.value.toSorted((a, b) => b.prefix - a.prefix || Number(b.user) - Number(a.user));
  let remaining = sources;
  let out = EMPTY;
  const routeTexts = [];
  const undecided = [];
  let defaultAway;
  for (const route of routes) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    routeTexts.push(route.text);
    remaining = subtract(remaining, m);
    if (route.hop === "Internet") out = union(out, m);
    else if (route.hop === "None") continue;
    else if (route.prefix === 0) defaultAway = `${route.text}: with 0.0.0.0/0 sent to a ${route.hop}, resources in the subnet can no longer be reached directly from the internet`;
    else undecided.push(`responses to ${setToCidrs(m).join(", ")} use ${route.text}, which is not modeled yet`);
  }
  if (isEmpty(out)) {
    if (undecided.length) return unknownAt("route", vm.address, undecided.join("; "));
    if (defaultAway) {
      add("route", vm.address, "deny", defaultAway);
      return stop("blocked", defaultAway);
    }
    add("route", vm.address, "deny", routeTexts.join("; "));
    return stop("blocked", `the response cannot return to the internet: ${routeTexts.join("; ")}`);
  }
  add("route", vm.address, equals(out, sources) ? "allow" : "partial", [...routeTexts, `${DROPPED_TEXT}, so clients there are not internet sources`].join("; "));
  return { verdict: "allowed", sources: equals(out, universe) ? ["internet"] : setToCidrs(out), hops, reason: undecided.join("; ") };
}
function azureExposed(vm, p) {
  if (!vm) return EMPTY;
  if (!vm.subnetNsg.ok || !vm.nicNsg.ok) return ALL_PORTS;
  let out = EMPTY;
  for (const nsg of [vm.subnetNsg.value, vm.nicNsg.value]) {
    if (!nsg) continue;
    if (!nsg.rules.ok) return ALL_PORTS;
    for (const r of nsg.rules.value) if ((r.allow || r.doubt) && protoMatches5(r.protocol, p) && (r.doubt || !isEmpty(intersect(r.sources, vm.universe)))) out = union(out, r.ports);
  }
  return out;
}
function azureCuts(vm) {
  const cuts = [];
  for (const n of vm?.subnetNsg.ok && vm.nicNsg.ok ? [vm.subnetNsg.value, vm.nicNsg.value] : []) if (n?.rules.ok) cuts.push(...n.rules.value.map((r) => r.ports));
  return cuts;
}

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
function evaluateAll6(list, p, ports) {
  if (!list?.length) return evaluate6(void 0, p, ports);
  return combine(list.map((e) => evaluate6(e, p, ports)), list.map((e) => e.subnet.ok ? e.subnet.value : "unknown subnet"), list[0]?.placement);
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
  for (const address of addresses) {
    const b = epBefore.get(address);
    const a = epAfter.get(address);
    const ports6 = (list, p) => (list ?? []).reduce((acc, e) => union(acc, exposedPorts6(e, p).map(({ lo, hi }) => [lo, hi])), []);
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
  const vmsOf = (snap) => new Map(new GcpModel(snap).vms().map((v) => [v.address, v]));
  const vmBefore = vmsOf(before);
  const vmAfter = vmsOf(after);
  for (const address of [.../* @__PURE__ */ new Set([...vmBefore.keys(), ...vmAfter.keys()])].toSorted(cmp)) {
    const b = vmBefore.get(address);
    const a = vmAfter.get(address);
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
        risk: () => []
      })
    );
  }
  const azOf2 = (snap) => new Map(new AzureModel(snap).vms().map((v) => [v.address, v]));
  const azBefore = azOf2(before);
  const azAfter = azOf2(after);
  for (const address of [.../* @__PURE__ */ new Set([...azBefore.keys(), ...azAfter.keys()])].toSorted(cmp)) {
    const b = azBefore.get(address);
    const a = azAfter.get(address);
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
        risk: () => []
      })
    );
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
      out.push({ id: `${spec.id}:${p}:${ports}`, from: spec.from, ...spec.fromType !== void 0 ? { fromType: spec.fromType } : {}, ...spec.family ? { family: spec.family } : {}, ...spec.provider ? { provider: spec.provider } : {}, to: spec.to, toType: spec.toType, protocol: p, ports, change: changeOf(run2.before, run2.after), before: run2.before, after: run2.after, ...risk.length ? { outageRisk: risk } : {} });
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

// ../engine/src/sources.ts
var AZURE_NOT_INTERNET = ["168.63.129.16/32", "157.59.0.0/16", "104.147.0.0/16", "104.146.0.0/17"].reduce((acc, c) => union(acc, cidrToSet(c) ?? []), []);
function exceptOf(sources, provider) {
  if (sources.length <= 6) return void 0;
  let allowed = [];
  for (const c of sources) {
    const set = cidrToSet(c);
    if (!set) return void 0;
    allowed = union(allowed, set);
  }
  const missing = setToCidrs(subtract(subtract(PUBLIC_IPV4, allowed), provider === "azure" ? AZURE_NOT_INTERNET : []));
  return missing.length && missing.length <= 6 && missing.length < sources.length ? missing : void 0;
}
function sourcesText(sources, family, provider) {
  const except = family === "ipv6" ? void 0 : exceptOf(sources, provider);
  return except ? `internet except ${except.join(", ")}` : sources.join(", ");
}
var CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
function withoutControls(value) {
  if (typeof value === "string") return value.replace(CONTROL, "\uFFFD");
  if (Array.isArray(value)) return value.map((v) => withoutControls(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [withoutControls(k), withoutControls(v)]));
  return value;
}

// ../engine/src/explain.ts
function mdCode(value) {
  const text = value.replace(/[\r\n]+/g, " ");
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
function mdText(value) {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#+!|~]/g, (c) => `\\${c}`).replace(/@/g, "@\u200B").replace(/\b(https?|ftp):\/\//gi, "$1:\u200B//").replace(/\bwww\./gi, "www\u200B.");
}
function htmlText(value) {
  return value.replace(/[\r\n]+/g, " ").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replace(/@/g, "@\u200B").replace(/\b(https?|ftp):\/\//gi, "$1:\u200B//").replace(/\bwww\./gi, "www\u200B.");
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
function outcomeLine(o, provider) {
  switch (o.verdict) {
    case "allowed":
      return `allowed from ${sourcesText(o.sources, void 0, provider)}${o.reason ? ` (also undecided: ${o.reason})` : ""}`;
    case "absent":
      return "resource does not exist";
    default: {
      const last = o.hops.at(-1);
      return `${o.verdict}${last ? ` at ${last.hop}` : ""}: ${o.reason}`;
    }
  }
}
var md = (text) => mdText(text);
var code = (text) => mdCode(text).replaceAll("|", "\\|");
function renderMarkdown(result, opts) {
  const lines = ["### vpcdiff: reachability", "", summaryLine(result), ""];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("No reachability changes.", "");
  else {
    lines.push("| | Path | Port | Before | After |", "|---|---|---|---|---|");
    for (const p of paths) lines.push(`| ${ICON[p.change]} ${p.change}${p.outageRisk ? " \u26A0\uFE0F" : ""} | ${p.from === "internet" ? p.family === "ipv6" ? "internet (IPv6)" : "internet" : code(p.from)} \u2192 ${code(p.to)} | ${p.protocol}/${p.ports} | ${md(outcomeLine(p.before, p.provider))} | ${md(outcomeLine(p.after, p.provider))} |`);
    lines.push("");
    for (const p of paths.filter((x) => x.outageRisk)) lines.push(`> \u26A0\uFE0F ${p.from === "internet" ? "" : `${code(p.from)} \u2192 `}${code(p.to)} ${p.protocol}/${p.ports}: ${md(riskLine(p))}`, "");
    for (const p of paths) {
      const explain = p.after.verdict === "absent" ? p.before : p.after;
      if (!explain.hops.length) continue;
      lines.push(`<details><summary>${p.from === "internet" ? "" : `${htmlText(p.from)} \u2192 `}${htmlText(p.to)} ${p.protocol}/${p.ports}: hops (${p.after.verdict === "absent" ? "before" : "after"})</summary>`, "", "| Hop | Decision | Rule |", "|---|---|---|");
      for (const h of explain.hops) lines.push(`| [${h.hop}](${h.doc}) | ${h.decision} | ${md(h.rule)} |`);
      lines.push("", "</details>", "");
    }
  }
  if (result.notes.length) {
    lines.push("<details><summary>Notes</summary>", "");
    for (const n of result.notes) lines.push(`- ${code(n.resource)}: ${md(n.message)}`);
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
    existing = list.find((c) => c.user?.type === "Bot" && c.body?.startsWith(MARKER))?.id;
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
    result = withoutControls(analyze(JSON.parse(env.readFile(planPath))));
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
