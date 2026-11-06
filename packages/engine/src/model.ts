import { ALL_IPV4, ALL_PORTS, cidrPrefixLength, cidrToSet, fromRanges, type IntervalSet } from "./intervals.js";
import { fromConfig, hasUnknown, isObj, isUnknown, resolveRef, resolveRefs, type Obj, type Ref, type Resource, type Snapshot } from "./plan.js";

export type Known<T> = { ok: true; value: T } | { ok: false; reason: string };
const known = <T>(value: T): Known<T> => ({ ok: true, value });
const unknown = <T>(reason: string): Known<T> => ({ ok: false, reason });

export type RuleProtocol = "tcp" | "udp" | "all" | "other";

export interface SgRule {
  protocol: RuleProtocol;
  ports: IntervalSet;
  sources: IntervalSet;
  text: string;
}

export interface SecurityGroup {
  address: string;
  ingress: Known<SgRule[]>;
}

export interface NaclRule {
  ruleNo: number;
  allow: boolean;
  protocol: RuleProtocol;
  ports: IntervalSet;
  cidr: IntervalSet;
  text: string;
}

export interface Nacl {
  resource: string;
  ingress: Known<NaclRule[]>;
  egress: Known<NaclRule[]>;
}

export type RouteTarget =
  | { kind: "local" }
  | { kind: "igw"; address: string }
  | { kind: "other"; text: string }
  | { kind: "unknown"; reason: string };

export interface Route {
  cidr: IntervalSet;
  prefix: number;
  target: RouteTarget;
  text: string;
}

export interface RouteTable {
  resource: string;
  routes: Known<Route[]>;
}

export interface Vpc {
  address: string;
  cidrs: Known<IntervalSet>;
  igw: Known<string | undefined>;
}

export interface Endpoint {
  address: string;
  type: string;
  vpc: Known<Vpc>;
  subnet: Known<string>;
  publicIp: Known<string | undefined>;
  securityGroups: Known<SecurityGroup[]>;
  nacl: Known<Nacl>;
  routeTable: Known<RouteTable>;
}

// Resource types that change network behavior but are not modeled yet. A hop that one
// of them can change becomes `unknown`, so an unmodeled rule never hides a path (ADR 0003).
const UNMODELED_SG = ["aws_security_group_rule", "aws_vpc_security_group_ingress_rule", "aws_vpc_security_group_egress_rule"];
const UNMODELED_ROUTES = ["aws_route", "aws_vpn_gateway_route_propagation"];
const UNMODELED_MAIN_ROUTES = ["aws_main_route_table_association", "aws_default_route_table"];
const UNMODELED_NACL = ["aws_network_acl_rule"];
const UNMODELED_SUBNET = ["aws_network_acl_association"];
const UNMODELED_IGW = ["aws_internet_gateway_attachment"];
const UNMODELED_INSTANCE = ["aws_eip", "aws_eip_association", "aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
const UNMODELED = new Set([...UNMODELED_SG, ...UNMODELED_ROUTES, ...UNMODELED_MAIN_ROUTES, ...UNMODELED_NACL, ...UNMODELED_SUBNET, ...UNMODELED_IGW, ...UNMODELED_INSTANCE]);

/** Resource type from an address such as `module.a.aws_vpc.main[0]`. */
export const typeOf = (address: string): string => address.replace(/\[[^\]]*\]/g, "").split(".").at(-2) ?? "";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function normalizeProtocol(p: unknown): RuleProtocol {
  const s = String(p).toLowerCase();
  if (s === "-1" || s === "all") return "all";
  if (s === "tcp" || s === "6") return "tcp";
  if (s === "udp" || s === "17") return "udp";
  return "other";
}

function portSet(protocol: RuleProtocol, from: unknown, to: unknown): IntervalSet | undefined {
  // Protocol -1 means all protocols and all ports, whatever the port fields say.
  // https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  if (protocol === "all") return ALL_PORTS;
  const lo = num(from);
  const hi = num(to);
  if (lo === undefined || hi === undefined) return undefined;
  return fromRanges([[Math.max(0, lo), Math.min(65535, hi)]]);
}

const describePorts = (protocol: RuleProtocol, from: unknown, to: unknown) =>
  protocol === "all" ? "all traffic" : `${protocol} ${from === to ? String(from) : `${String(from)}-${String(to)}`}`;

export class ModelBuilder {
  /** Target address to the unmodeled resources that point at it. */
  private readonly touchedBy = new Map<string, Resource[]>();

  constructor(private readonly snap: Snapshot) {
    for (const r of snap.resources.values()) {
      if (!UNMODELED.has(r.type)) continue;
      const targets = new Set<string>();
      for (const list of Object.values(r.refs)) {
        for (const t of list) for (const inst of snap.resources.has(t) ? [t] : (snap.instancesOf.get(t) ?? [])) targets.add(inst);
      }
      for (const v of Object.values(r.values)) {
        const t = typeof v === "string" ? snap.byId.get(v) : undefined;
        if (t) targets.add(t);
      }
      for (const t of targets) this.touchedBy.set(t, [...(this.touchedBy.get(t) ?? []), r]);
    }
  }

  /** Reason why `address` is unknown because an unmodeled resource of `types` changes it. */
  private touched(address: string, types: string[]): string | undefined {
    const r = (this.touchedBy.get(address) ?? []).find((x) => types.includes(x.type));
    return r ? `${r.address} (${r.type}) changes ${address}, and ${r.type} is not modeled yet` : undefined;
  }

  private get(address: string): Resource | undefined {
    return this.snap.resources.get(address);
  }

  private ofType(type: string): Resource[] {
    return [...this.snap.resources.values()].filter((r) => r.type === type);
  }

  private refTo(r: Resource, attr: string, type: string): Known<string> {
    const ref: Ref = resolveRef(this.snap, r, attr, type);
    if (ref.kind === "resource") return known(ref.address);
    if (ref.kind === "external") return unknown(`${r.address}: ${attr} = ${ref.id} is not managed in this plan`);
    return unknown(ref.reason);
  }

  private refsTo(r: Resource, attr: string, type: string): Known<string[]> {
    const out: string[] = [];
    for (const ref of resolveRefs(this.snap, r, attr, type)) {
      if (ref.kind === "unknown") return unknown(ref.reason);
      if (ref.kind === "external") return unknown(`${r.address}: ${attr} contains ${ref.id}, which is not managed in this plan`);
      out.push(ref.address);
    }
    return known(out);
  }

  vpc(address: string): Known<Vpc> {
    const r = this.get(address);
    if (!r || r.type !== "aws_vpc") return unknown(`${address} is not an aws_vpc in this plan`);
    const cidr = str(r.values.cidr_block);
    const set = cidr ? cidrToSet(cidr) : undefined;
    const extra = this.ofType("aws_vpc_ipv4_cidr_block_association").filter((a) => {
      const v = this.refTo(a, "vpc_id", "aws_vpc");
      return !v.ok || v.value === address;
    });
    const cidrs: Known<IntervalSet> = isUnknown(r, ["cidr_block"]) || !set ? unknown(`${address}: cidr_block is unknown`) : extra.length ? unknown(`${address} has secondary CIDR blocks, which are not modeled yet`) : known(set);

    // An internet gateway must be attached to the VPC.
    // https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
    const igws: string[] = [];
    for (const g of this.ofType("aws_internet_gateway")) {
      if (g.values.vpc_id === null && !isUnknown(g, ["vpc_id"])) continue;
      const v = this.refTo(g, "vpc_id", "aws_vpc");
      if (!v.ok) return { ok: true, value: { address, cidrs, igw: unknown(v.reason) } };
      if (v.value === address) igws.push(g.address);
    }
    const touchedIgw = [address, ...igws].map((g) => this.touched(g, UNMODELED_IGW)).find(Boolean);
    const igw: Known<string | undefined> = touchedIgw ? unknown(touchedIgw) : igws.length > 1 ? unknown(`${address} has ${igws.length} internet gateways in the plan`) : known(igws[0]);
    return known({ address, cidrs, igw });
  }

  securityGroup(address: string): SecurityGroup {
    const r = this.get(address);
    if (!r) return { address, ingress: unknown(`${address} is not in this plan`) };
    const touched = this.touched(address, UNMODELED_SG);
    if (touched) return { address, ingress: unknown(touched) };
    if (isUnknown(r, ["ingress"])) return { address, ingress: unknown(`${address}: ingress is unknown until apply`) };
    const rules: SgRule[] = [];
    for (const [i, raw] of arr(r.values.ingress).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, ["ingress", i])) return { address, ingress: unknown(`${address}: ingress rule ${i} has values that are unknown until apply`) };
      const protocol = normalizeProtocol(raw.protocol);
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      // Prefix lists can contain public ranges; the engine cannot expand them offline.
      if (arr(raw.prefix_list_ids).length) return { address, ingress: unknown(`${address}: ingress rule ${i} uses a prefix list, which is not modeled yet`) };
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s)) return { address, ingress: unknown(`${address}: ingress rule ${i} has a value the engine cannot read`) };
      if (!cidrs.length) continue; // Only security group sources (or IPv6): no IPv4 internet source.
      rules.push({ protocol, ports, sources: fromRanges((sets as IntervalSet[]).flat()), text: `${address} ingress ${describePorts(protocol, raw.from_port, raw.to_port)} from ${cidrs.join(", ")}` });
    }
    return { address, ingress: known(rules) };
  }

  private naclRules(r: Resource, key: "ingress" | "egress"): Known<NaclRule[]> {
    if (isUnknown(r, [key])) return unknown(`${r.address}: ${key} is unknown until apply`);
    const rules: NaclRule[] = [];
    for (const [i, raw] of arr(r.values[key]).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, [key, i])) return unknown(`${r.address}: ${key} rule ${i} has values that are unknown until apply`);
      if (str(raw.ipv6_cidr_block)) continue; // IPv6 rules never match IPv4 traffic.
      const protocol = normalizeProtocol(raw.protocol);
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidr = str(raw.cidr_block);
      const set = cidr ? cidrToSet(cidr) : undefined;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === undefined) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
    }
    return known(rules.toSorted((a, b) => a.ruleNo - b.ruleNo));
  }

  private nacl(r: Resource): Nacl {
    const touched = this.touched(r.address, UNMODELED_NACL);
    if (touched) return { resource: r.address, ingress: unknown(touched), egress: unknown(touched) };
    return { resource: r.address, ingress: this.naclRules(r, "ingress"), egress: this.naclRules(r, "egress") };
  }

  /**
   * The NACL of a subnet: an explicit association, else the VPC's default NACL.
   * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
   */
  subnetNacl(subnet: string, vpc: string): Known<Nacl> {
    const touched = this.touched(subnet, UNMODELED_SUBNET);
    if (touched) return unknown(touched);
    const claims: Resource[] = [];
    for (const type of ["aws_network_acl", "aws_default_network_acl"]) {
      for (const a of this.ofType(type)) {
        const subs = this.refsTo(a, "subnet_ids", "aws_subnet");
        if (!subs.ok) return unknown(subs.reason);
        if (subs.value.includes(subnet)) claims.push(a);
      }
    }
    if (claims.length > 1) return unknown(`${subnet} is listed in ${claims.length} network ACLs`);
    if (claims[0]) return known(this.nacl(claims[0]));

    // An aws_default_network_acl replaces the default rules of its VPC. Match it by the
    // known ID, else by the configuration reference to the VPC (instance keys removed).
    let managedDefault: Resource | undefined;
    for (const d of this.ofType("aws_default_network_acl")) {
      const id = str(d.values.default_network_acl_id);
      let match: boolean;
      if (id && !isUnknown(d, ["default_network_acl_id"])) match = id === this.get(vpc)?.values.default_network_acl_id;
      else {
        const refs = d.otherRefs.has("default_network_acl_id") ? [] : fromConfig(this.snap, d, "default_network_acl_id", "aws_vpc");
        const ref = refs.length === 1 ? refs[0] : undefined;
        if (ref?.kind !== "resource") return unknown(`${d.address}: cannot tell which VPC's default NACL it manages`);
        match = ref.address === vpc;
      }
      if (match && managedDefault) return unknown(`${vpc} has more than one aws_default_network_acl`);
      if (match) managedDefault = d;
    }
    if (managedDefault) return known(this.nacl(managedDefault));
    // The default NACL allows all inbound and outbound traffic. The engine assumes it
    // was not changed outside Terraform.
    // https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html
    const all = (key: string): NaclRule[] => [{ ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${key} rule 100: allow all traffic (AWS default)` }];
    return known({ resource: `default NACL of ${vpc}`, ingress: known(all("ingress")), egress: known(all("egress")) });
  }

  private routeTarget(r: Resource, raw: Obj, path: (string | number)[], unknownGateways: number, knownGateways: number): RouteTarget {
    const gwUnknown = isUnknown(r, [...path, "gateway_id"]);
    const gw = str(raw.gateway_id);
    if (gw === "local") return { kind: "local" };
    if (gw || gwUnknown) {
      if (!gwUnknown && gw) {
        const a = this.snap.byId.get(gw);
        if (a && this.get(a)?.type === "aws_internet_gateway") return { kind: "igw", address: a };
        return { kind: "unknown", reason: `${r.address}: gateway_id ${gw} is not an internet gateway in this plan` };
      }
      // References of all `route` blocks are merged (see terraform-plan-json.md). One
      // gateway-type reference is unambiguous only when this is the only route with a
      // gateway, and the blocks use resources alone.
      if (unknownGateways !== 1 || knownGateways > 0 || r.otherRefs.has(String(path[0]))) {
        return { kind: "unknown", reason: `${r.address}: gateway_id of a route is unknown until apply and cannot be matched to one resource` };
      }
      const gateways = (r.refs[String(path[0])] ?? []).filter((a) => ["aws_internet_gateway", "aws_vpn_gateway"].includes(typeOf(a)));
      const ref = gateways.length === 1 && typeOf(gateways[0] as string) === "aws_internet_gateway" ? fromConfig(this.snap, r, String(path[0]), "aws_internet_gateway") : [];
      if (ref.length === 1 && ref[0]?.kind === "resource") return { kind: "igw", address: ref[0].address };
      return { kind: "unknown", reason: `${r.address}: gateway_id is unknown until apply and its reference is ambiguous` };
    }
    for (const key of ["nat_gateway_id", "network_interface_id", "transit_gateway_id", "vpc_peering_connection_id", "vpc_endpoint_id", "egress_only_gateway_id", "carrier_gateway_id", "local_gateway_id", "core_network_arn"]) {
      if (str(raw[key]) || isUnknown(r, [...path, key])) return { kind: "other", text: key.replace(/_id$|_arn$/, "").replaceAll("_", " ") };
    }
    return { kind: "unknown", reason: `${r.address}: route has no target the engine can read` };
  }

  private routeTable(r: Resource, vpc: Vpc): RouteTable {
    const touched = this.touched(r.address, UNMODELED_ROUTES);
    if (touched) return { resource: r.address, routes: unknown(touched) };
    if (isUnknown(r, ["route"])) return { resource: r.address, routes: unknown(`${r.address}: route is unknown until apply`) };
    if (!vpc.cidrs.ok) return { resource: r.address, routes: unknown(vpc.cidrs.reason) };
    // Routes propagated from a virtual private gateway can be more specific than static routes.
    // https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
    const vgws = r.values.propagating_vgws;
    if ((Array.isArray(vgws) && vgws.length) || (isUnknown(r, ["propagating_vgws"]) && r.configured.has("propagating_vgws"))) {
      return { resource: r.address, routes: unknown(`${r.address}: route propagation from a virtual private gateway is not modeled yet`) };
    }
    const blocks = arr(r.values.route);
    const unknownGateways = blocks.filter((_, i) => isUnknown(r, ["route", i, "gateway_id"])).length;
    const knownGateways = blocks.filter((b, i) => isObj(b) && !isUnknown(r, ["route", i, "gateway_id"]) && str(b.gateway_id) && b.gateway_id !== "local").length;
    // Every route table has a local route for the VPC CIDR.
    // https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
    const routes: Route[] = vpc.cidrs.value.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `${r.address} local route` }));
    for (const [i, raw] of arr(r.values.route).entries()) {
      if (!isObj(raw)) continue;
      if (isUnknown(r, ["route", i, "cidr_block"])) return { resource: r.address, routes: unknown(`${r.address}: route ${i} destination is unknown until apply`) };
      const cidr = str(raw.cidr_block);
      if (!cidr) {
        if (str(raw.destination_prefix_list_id)) return { resource: r.address, routes: unknown(`${r.address}: route ${i} uses a prefix list, which is not modeled yet`) };
        continue; // IPv6 route.
      }
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === undefined) return { resource: r.address, routes: unknown(`${r.address}: route ${i} has destination ${cidr}, which the engine cannot read`) };
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
  subnetRouteTable(subnet: string, vpc: Vpc): Known<RouteTable> {
    const assoc: string[] = [];
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
    const table = assoc[0] ? this.get(assoc[0]) : undefined;
    if (table) return known(this.routeTable(table, vpc));
    const touched = this.touched(vpc.address, UNMODELED_MAIN_ROUTES);
    if (touched) return unknown(touched);
    // The main route table of a VPC has only the local route unless Terraform manages it.
    if (!vpc.cidrs.ok) return unknown(vpc.cidrs.reason);
    const routes: Route[] = vpc.cidrs.value.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `main route table of ${vpc.address} local route` }));
    return known({ resource: `main route table of ${vpc.address}`, routes: known(routes) });
  }

  /** EC2 instances as endpoints. */
  endpoints(): Endpoint[] {
    return this.ofType("aws_instance").map((r) => this.instance(r));
  }

  private instance(r: Resource): Endpoint {
    const fail = (reason: string): Endpoint => ({ address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) });
    const touched = this.touched(r.address, UNMODELED_INSTANCE);
    if (touched) return fail(touched);
    if (arr(r.values.network_interface).length) return fail(`${r.address}: network_interface blocks are not modeled yet`);
    const subnet = this.refTo(r, "subnet_id", "aws_subnet");
    if (!subnet.ok) return fail(subnet.reason);
    const s = this.get(subnet.value) as Resource;
    const vpcRef = this.refTo(s, "vpc_id", "aws_vpc");
    if (!vpcRef.ok) return fail(vpcRef.reason);
    const vpc = this.vpc(vpcRef.value);
    if (!vpc.ok) return fail(vpc.reason);

    // A public IPv4 address comes from associate_public_ip_address, else from the
    // subnet's map_public_ip_on_launch.
    // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html
    let publicIp: Known<string | undefined>;
    const assoc = r.values.associate_public_ip_address;
    if (isUnknown(r, ["associate_public_ip_address"]) && r.configured.has("associate_public_ip_address")) {
      publicIp = unknown(`${r.address}: associate_public_ip_address is set to a value that is unknown until apply`);
    } else if (!isUnknown(r, ["associate_public_ip_address"]) && typeof assoc === "boolean") {
      publicIp = known(assoc ? `${r.address} associate_public_ip_address = true` : undefined);
    } else if (!isUnknown(s, ["map_public_ip_on_launch"]) && typeof s.values.map_public_ip_on_launch === "boolean") {
      publicIp = known(s.values.map_public_ip_on_launch ? `${s.address} map_public_ip_on_launch = true` : undefined);
    } else {
      publicIp = unknown(`${r.address}: whether it gets a public IPv4 address is unknown until apply`);
    }

    const sgIds = this.refsTo(r, "vpc_security_group_ids", "aws_security_group");
    let securityGroups: Known<SecurityGroup[]>;
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
      routeTable: this.subnetRouteTable(subnet.value, vpc.value),
    };
  }
}
