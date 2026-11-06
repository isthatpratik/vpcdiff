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
function exposedPorts(ep, p) {
  if (!ep) return EMPTY;
  if (!ep.securityGroups.ok || ep.securityGroups.value.some((g) => !g.ingress.ok)) return ALL_PORTS;
  const universe = internetOf(ep);
  let out = EMPTY;
  for (const g of ep.securityGroups.value) {
    if (!g.ingress.ok) continue;
    for (const rule of g.ingress.value) {
      if (protoMatches(rule.protocol, p) && !isEmpty(intersect(rule.sources, universe))) out = union(out, rule.ports);
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
      const info = { refs: {}, configured: /* @__PURE__ */ new Set(), otherRefs: /* @__PURE__ */ new Set() };
      for (const [attr, expr] of Object.entries(isObj(r.expressions) ? r.expressions : {})) {
        info.configured.add(attr);
        const found = /* @__PURE__ */ new Set();
        collect(expr, (ref) => {
          const m = /^(aws_\w+\.[\w-]+(?:\[[^\]]+\])?)$/.exec(ref);
          if (m) found.add(prefix + m[1]);
          else if (!RESOURCE_REF.test(ref)) info.otherRefs.add(attr);
        });
        if (found.size) info.refs[attr] = [...found].sort(cmp);
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
    const info = refs.get(base) ?? { refs: {}, configured: /* @__PURE__ */ new Set(), otherRefs: /* @__PURE__ */ new Set() };
    const sides = [
      [before, rc.change.before, false],
      [after, rc.change.after, rc.change.after_unknown ?? false]
    ];
    for (const [snap, values, unknown2] of sides) {
      if (!isObj(values)) continue;
      snap.resources.set(address, { address, type, values, unknown: unknown2, refs: info.refs, configured: info.configured, otherRefs: info.otherRefs, actions });
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
var ADDRESS = /^(.*?)(aws_\w+\.[\w-]+(?:\[[^\]]+\])?)$/;
function localize(from, ref) {
  const prefix = ADDRESS.exec(from)?.[1] ?? "";
  return prefix + (ADDRESS.exec(ref)?.[2] ?? ref);
}
function fromConfig(snap, r, attr, targetType) {
  const targets = (r.refs[attr] ?? []).filter((a) => stripKeys(a).split(".").at(-2) === targetType);
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
var UNMODELED_SG = ["aws_security_group_rule", "aws_vpc_security_group_ingress_rule", "aws_vpc_security_group_egress_rule"];
var UNMODELED_ROUTES = ["aws_route", "aws_vpn_gateway_route_propagation"];
var UNMODELED_MAIN_ROUTES = ["aws_main_route_table_association", "aws_default_route_table"];
var UNMODELED_NACL = ["aws_network_acl_rule"];
var UNMODELED_SUBNET = ["aws_network_acl_association"];
var UNMODELED_IGW = ["aws_internet_gateway_attachment"];
var UNMODELED_INSTANCE = ["aws_eip", "aws_eip_association", "aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
var UNMODELED = /* @__PURE__ */ new Set([...UNMODELED_SG, ...UNMODELED_ROUTES, ...UNMODELED_MAIN_ROUTES, ...UNMODELED_NACL, ...UNMODELED_SUBNET, ...UNMODELED_IGW, ...UNMODELED_INSTANCE]);
var typeOf = (address) => address.replace(/\[[^\]]*\]/g, "").split(".").at(-2) ?? "";
var str = (v) => typeof v === "string" && v !== "" ? v : void 0;
var num = (v) => typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : void 0;
var arr = (v) => Array.isArray(v) ? v : [];
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
var ModelBuilder = class {
  constructor(snap) {
    this.snap = snap;
    for (const r of snap.resources.values()) {
      if (!UNMODELED.has(r.type)) continue;
      const targets = /* @__PURE__ */ new Set();
      for (const list of Object.values(r.refs)) {
        for (const t of list) for (const inst of snap.resources.has(t) ? [t] : snap.instancesOf.get(t) ?? []) targets.add(inst);
      }
      for (const v of Object.values(r.values)) {
        const t = typeof v === "string" ? snap.byId.get(v) : void 0;
        if (t) targets.add(t);
      }
      for (const t of targets) this.touchedBy.set(t, [...this.touchedBy.get(t) ?? [], r]);
    }
  }
  snap;
  /** Target address to the unmodeled resources that point at it. */
  touchedBy = /* @__PURE__ */ new Map();
  /** Reason why `address` is unknown because an unmodeled resource of `types` changes it. */
  touched(address, types) {
    const r = (this.touchedBy.get(address) ?? []).find((x) => types.includes(x.type));
    return r ? `${r.address} (${r.type}) changes ${address}, and ${r.type} is not modeled yet` : void 0;
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
  refsTo(r, attr, type) {
    const out = [];
    for (const ref of resolveRefs(this.snap, r, attr, type)) {
      if (ref.kind === "unknown") return unknown(ref.reason);
      if (ref.kind === "external") return unknown(`${r.address}: ${attr} contains ${ref.id}, which is not managed in this plan`);
      out.push(ref.address);
    }
    return known(out);
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
    const igws = [];
    for (const g of this.ofType("aws_internet_gateway")) {
      if (g.values.vpc_id === null && !isUnknown(g, ["vpc_id"])) continue;
      const v = this.refTo(g, "vpc_id", "aws_vpc");
      if (!v.ok) return { ok: true, value: { address, cidrs, igw: unknown(v.reason) } };
      if (v.value === address) igws.push(g.address);
    }
    const touchedIgw = [address, ...igws].map((g) => this.touched(g, UNMODELED_IGW)).find(Boolean);
    const igw = touchedIgw ? unknown(touchedIgw) : igws.length > 1 ? unknown(`${address} has ${igws.length} internet gateways in the plan`) : known(igws[0]);
    return known({ address, cidrs, igw });
  }
  securityGroup(address) {
    const r = this.get(address);
    if (!r) return { address, ingress: unknown(`${address} is not in this plan`) };
    const touched = this.touched(address, UNMODELED_SG);
    if (touched) return { address, ingress: unknown(touched) };
    if (isUnknown(r, ["ingress"])) return { address, ingress: unknown(`${address}: ingress is unknown until apply`) };
    const rules = [];
    for (const [i, raw] of arr(r.values.ingress).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, ["ingress", i])) return { address, ingress: unknown(`${address}: ingress rule ${i} has values that are unknown until apply`) };
      const protocol = normalizeProtocol(raw.protocol);
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      if (arr(raw.prefix_list_ids).length) return { address, ingress: unknown(`${address}: ingress rule ${i} uses a prefix list, which is not modeled yet`) };
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s)) return { address, ingress: unknown(`${address}: ingress rule ${i} has a value the engine cannot read`) };
      if (!cidrs.length) continue;
      rules.push({ protocol, ports, sources: fromRanges(sets.flat()), text: `${address} ingress ${describePorts(protocol, raw.from_port, raw.to_port)} from ${cidrs.join(", ")}` });
    }
    return { address, ingress: known(rules) };
  }
  naclRules(r, key) {
    if (isUnknown(r, [key])) return unknown(`${r.address}: ${key} is unknown until apply`);
    const rules = [];
    for (const [i, raw] of arr(r.values[key]).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, [key, i])) return unknown(`${r.address}: ${key} rule ${i} has values that are unknown until apply`);
      if (str(raw.ipv6_cidr_block)) continue;
      const protocol = normalizeProtocol(raw.protocol);
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidr = str(raw.cidr_block);
      const set = cidr ? cidrToSet(cidr) : void 0;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === void 0) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
    }
    return known(rules.toSorted((a, b) => a.ruleNo - b.ruleNo));
  }
  nacl(r) {
    const touched = this.touched(r.address, UNMODELED_NACL);
    if (touched) return { resource: r.address, ingress: unknown(touched), egress: unknown(touched) };
    return { resource: r.address, ingress: this.naclRules(r, "ingress"), egress: this.naclRules(r, "egress") };
  }
  /**
   * The NACL of a subnet: an explicit association, else the VPC's default NACL.
   * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
   */
  subnetNacl(subnet, vpc) {
    const touched = this.touched(subnet, UNMODELED_SUBNET);
    if (touched) return unknown(touched);
    const claims = [];
    for (const type of ["aws_network_acl", "aws_default_network_acl"]) {
      for (const a of this.ofType(type)) {
        const subs = this.refsTo(a, "subnet_ids", "aws_subnet");
        if (!subs.ok) return unknown(subs.reason);
        if (subs.value.includes(subnet)) claims.push(a);
      }
    }
    if (claims.length > 1) return unknown(`${subnet} is listed in ${claims.length} network ACLs`);
    if (claims[0]) return known(this.nacl(claims[0]));
    let managedDefault;
    for (const d of this.ofType("aws_default_network_acl")) {
      const id = str(d.values.default_network_acl_id);
      let match;
      if (id && !isUnknown(d, ["default_network_acl_id"])) match = id === this.get(vpc)?.values.default_network_acl_id;
      else {
        const refs = d.otherRefs.has("default_network_acl_id") ? [] : fromConfig(this.snap, d, "default_network_acl_id", "aws_vpc");
        const ref = refs.length === 1 ? refs[0] : void 0;
        if (ref?.kind !== "resource") return unknown(`${d.address}: cannot tell which VPC's default NACL it manages`);
        match = ref.address === vpc;
      }
      if (match && managedDefault) return unknown(`${vpc} has more than one aws_default_network_acl`);
      if (match) managedDefault = d;
    }
    if (managedDefault) return known(this.nacl(managedDefault));
    const all = (key) => [{ ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${key} rule 100: allow all traffic (AWS default)` }];
    return known({ resource: `default NACL of ${vpc}`, ingress: known(all("ingress")), egress: known(all("egress")) });
  }
  routeTarget(r, raw, path, unknownGateways, knownGateways) {
    const gwUnknown = isUnknown(r, [...path, "gateway_id"]);
    const gw = str(raw.gateway_id);
    if (gw === "local") return { kind: "local" };
    if (gw || gwUnknown) {
      if (!gwUnknown && gw) {
        const a = this.snap.byId.get(gw);
        if (a && this.get(a)?.type === "aws_internet_gateway") return { kind: "igw", address: a };
        return { kind: "unknown", reason: `${r.address}: gateway_id ${gw} is not an internet gateway in this plan` };
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
      if (str(raw[key]) || isUnknown(r, [...path, key])) return { kind: "other", text: key.replace(/_id$|_arn$/, "").replaceAll("_", " ") };
    }
    return { kind: "unknown", reason: `${r.address}: route has no target the engine can read` };
  }
  routeTable(r, vpc) {
    const touched = this.touched(r.address, UNMODELED_ROUTES);
    if (touched) return { resource: r.address, routes: unknown(touched) };
    if (isUnknown(r, ["route"])) return { resource: r.address, routes: unknown(`${r.address}: route is unknown until apply`) };
    if (!vpc.cidrs.ok) return { resource: r.address, routes: unknown(vpc.cidrs.reason) };
    const vgws = r.values.propagating_vgws;
    if (Array.isArray(vgws) && vgws.length || isUnknown(r, ["propagating_vgws"]) && r.configured.has("propagating_vgws")) {
      return { resource: r.address, routes: unknown(`${r.address}: route propagation from a virtual private gateway is not modeled yet`) };
    }
    const blocks = arr(r.values.route);
    const unknownGateways = blocks.filter((_, i) => isUnknown(r, ["route", i, "gateway_id"])).length;
    const knownGateways = blocks.filter((b, i) => isObj(b) && !isUnknown(r, ["route", i, "gateway_id"]) && str(b.gateway_id) && b.gateway_id !== "local").length;
    const routes = vpc.cidrs.value.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `${r.address} local route` }));
    for (const [i, raw] of arr(r.values.route).entries()) {
      if (!isObj(raw)) continue;
      if (isUnknown(r, ["route", i, "cidr_block"])) return { resource: r.address, routes: unknown(`${r.address}: route ${i} destination is unknown until apply`) };
      const cidr = str(raw.cidr_block);
      if (!cidr) {
        if (str(raw.destination_prefix_list_id)) return { resource: r.address, routes: unknown(`${r.address}: route ${i} uses a prefix list, which is not modeled yet`) };
        continue;
      }
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === void 0) return { resource: r.address, routes: unknown(`${r.address}: route ${i} has destination ${cidr}, which the engine cannot read`) };
      const target = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
      const to = target.kind === "igw" ? target.address : target.kind === "other" ? target.text : target.kind;
      routes.push({ cidr: set, prefix, target, text: `${r.address} route ${cidr} -> ${to}` });
    }
    return { resource: r.address, routes: known(routes) };
  }
  /**
   * The route table of a subnet: an explicit association, else the VPC's main route table.
   * https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
   */
  subnetRouteTable(subnet, vpc) {
    const assoc = [];
    for (const a of this.ofType("aws_route_table_association")) {
      if (a.values.subnet_id === null && !isUnknown(a, ["subnet_id"])) continue;
      const s = this.refTo(a, "subnet_id", "aws_subnet");
      if (!s.ok) return unknown(s.reason);
      if (s.value !== subnet) continue;
      const t = this.refTo(a, "route_table_id", "aws_route_table");
      if (!t.ok) return unknown(t.reason);
      assoc.push(t.value);
    }
    if (assoc.length > 1) return unknown(`${subnet} has ${assoc.length} route table associations`);
    const table = assoc[0] ? this.get(assoc[0]) : void 0;
    if (table) return known(this.routeTable(table, vpc));
    const touched = this.touched(vpc.address, UNMODELED_MAIN_ROUTES);
    if (touched) return unknown(touched);
    if (!vpc.cidrs.ok) return unknown(vpc.cidrs.reason);
    const routes = vpc.cidrs.value.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `main route table of ${vpc.address} local route` }));
    return known({ resource: `main route table of ${vpc.address}`, routes: known(routes) });
  }
  /** EC2 instances as endpoints. */
  endpoints() {
    return this.ofType("aws_instance").map((r) => this.instance(r));
  }
  instance(r) {
    const fail = (reason) => ({ address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) });
    const touched = this.touched(r.address, UNMODELED_INSTANCE);
    if (touched) return fail(touched);
    if (arr(r.values.network_interface).length) return fail(`${r.address}: network_interface blocks are not modeled yet`);
    const subnet = this.refTo(r, "subnet_id", "aws_subnet");
    if (!subnet.ok) return fail(subnet.reason);
    const s = this.get(subnet.value);
    const vpcRef = this.refTo(s, "vpc_id", "aws_vpc");
    if (!vpcRef.ok) return fail(vpcRef.reason);
    const vpc = this.vpc(vpcRef.value);
    if (!vpc.ok) return fail(vpc.reason);
    let publicIp;
    const assoc = r.values.associate_public_ip_address;
    if (isUnknown(r, ["associate_public_ip_address"]) && r.configured.has("associate_public_ip_address")) {
      publicIp = unknown(`${r.address}: associate_public_ip_address is set to a value that is unknown until apply`);
    } else if (!isUnknown(r, ["associate_public_ip_address"]) && typeof assoc === "boolean") {
      publicIp = known(assoc ? `${r.address} associate_public_ip_address = true` : void 0);
    } else if (!isUnknown(s, ["map_public_ip_on_launch"]) && typeof s.values.map_public_ip_on_launch === "boolean") {
      publicIp = known(s.values.map_public_ip_on_launch ? `${s.address} map_public_ip_on_launch = true` : void 0);
    } else {
      publicIp = unknown(`${r.address}: whether it gets a public IPv4 address is unknown until apply`);
    }
    const sgIds = this.refsTo(r, "vpc_security_group_ids", "aws_security_group");
    let securityGroups;
    if (!sgIds.ok) securityGroups = unknown(sgIds.reason);
    else if (!sgIds.value.length) securityGroups = unknown(`${r.address} uses the default security group of ${vpcRef.value}, which is not modeled yet`);
    else securityGroups = known(sgIds.value.map((a) => this.securityGroup(a)));
    return {
      address: r.address,
      type: r.type,
      vpc,
      subnet,
      publicIp,
      securityGroups,
      nacl: this.subnetNacl(subnet.value, vpcRef.value),
      routeTable: this.subnetRouteTable(subnet.value, vpc.value)
    };
  }
};

// ../engine/src/types.ts
var RESULT_FORMAT = "0.1";

// ../engine/src/index.ts
var PROTOCOLS = ["tcp", "udp"];
var MODELED = /* @__PURE__ */ new Set(["aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table", "aws_route_table_association", "aws_security_group", "aws_network_acl", "aws_default_network_acl", "aws_instance"]);
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
  return new Map(new ModelBuilder(snap).endpoints().map((e) => [e.address, e]));
}
function notesFor(before, after) {
  const seen = /* @__PURE__ */ new Map();
  for (const snap of [before, after]) {
    for (const r of snap.resources.values()) {
      if (MODELED.has(r.type) || !NETWORK_TYPE.test(r.type) || seen.has(r.address)) continue;
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
    for (const p of PROTOCOLS) {
      const candidates = union(exposedPorts(b, p), exposedPorts(a, p));
      let run2;
      const flush = () => {
        if (!run2) return;
        const ports = formatPorts([run2.ports]);
        paths.push({ id: `internet->${address}:${p}:${ports}`, from: "internet", to: address, toType: (a ?? b)?.type ?? "", protocol: p, ports, change: changeOf(run2.before, run2.after), before: run2.before, after: run2.after });
        run2 = void 0;
      };
      for (const seg of segment(candidates, [...portCuts(b), ...portCuts(a)])) {
        const ob = evaluate(b, p, seg);
        const oa = evaluate(a, p, seg);
        if (run2 && run2.ports[1] + 1 === seg[0] && JSON.stringify([run2.before, run2.after]) === JSON.stringify([ob, oa])) run2.ports = [run2.ports[0], seg[1]];
        else {
          flush();
          run2 = { ports: seg, before: ob, after: oa };
        }
      }
      flush();
    }
  }
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0, unknown: 0 };
  for (const path of paths) summary[path.change]++;
  return { format: RESULT_FORMAT, summary, paths, notes: notesFor(before, after) };
}

// ../cli/src/render.ts
var ORDER = ["added", "removed", "changed", "unknown", "unchanged"];
var ICON = { added: "\u{1F534}", removed: "\u{1F7E2}", changed: "\u{1F7E0}", unknown: "\u26AA", unchanged: "\xB7" };
function visiblePaths(result, opts) {
  return result.paths.filter((p) => opts.all || p.change !== "unchanged").toSorted((a, b) => ORDER.indexOf(a.change) - ORDER.indexOf(b.change) || a.id.localeCompare(b.id));
}
function summaryLine(result) {
  const s = result.summary;
  return `${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unknown} unknown, ${s.unchanged} unchanged`;
}
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
  const lines = ["### vpcdiff: internet reachability", "", summaryLine(result), ""];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("No reachability changes from the internet.", "");
  else {
    lines.push("| | Path | Port | Before | After |", "|---|---|---|---|---|");
    for (const p of paths) lines.push(`| ${ICON[p.change]} ${p.change} | internet \u2192 \`${p.to}\` | ${p.protocol}/${p.ports} | ${md(outcomeLine(p.before))} | ${md(outcomeLine(p.after))} |`);
    lines.push("");
    for (const p of paths) {
      const explain = p.after.verdict === "absent" ? p.before : p.after;
      if (!explain.hops.length) continue;
      lines.push(`<details><summary>${md(p.to)} ${p.protocol}/${p.ports}: hops (${p.after.verdict === "absent" ? "before" : "after"})</summary>`, "", "| Hop | Decision | Rule |", "|---|---|---|");
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
  const s = result.summary;
  if (failOn === "never") return false;
  if (failOn === "added") return s.added > 0;
  if (failOn === "changed") return s.added + s.changed > 0;
  return s.added + s.changed + s.unknown > 0;
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
