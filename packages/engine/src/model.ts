import { ALL_IPV4, ALL_PORTS, cidrPrefixLength, cidrToSet, fromRanges, type IntervalSet } from "./intervals.js";
import { cmp, fromConfig, hasUnknown, instanceOf, isObj, isUnknown, localize, resolveRef, resolveRefs, type Obj, type Ref, type Resource, type Snapshot } from "./plan.js";

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
  /** For endpoints with several possible subnets: why placements can differ. */
  placement?: string;
}

// Resource types that change network behavior but are not modeled yet. A hop that one of
// them can change becomes `unknown`, so an unmodeled resource never hides a path (ADR 0003).
const UNMODELED_ROUTES = ["aws_vpn_gateway_route_propagation"];
const UNMODELED_INSTANCE = ["aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
const UNMODELED = new Set([...UNMODELED_ROUTES, ...UNMODELED_INSTANCE]);

/**
 * A target of a rule resource: a resource address, or a VPC's default object such as
 * `default-rt:aws_vpc.main`. Managed defaults (`aws_default_route_table`, ...) use the
 * same key as the default object they adopt.
 */
type Key = string;
const VPC_DEFAULTS: [string, string][] = [
  ["default_route_table_id", "default-rt"],
  ["main_route_table_id", "main-rt"],
  ["default_network_acl_id", "default-nacl"],
  ["default_security_group_id", "default-sg"],
];

/** Resource type from an address such as `module.a.aws_vpc.main[0]`. */
export const typeOf = (address: string): string => address.replace(/\[[^\]]*\]/g, "").split(".").at(-2) ?? "";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/**
 * True when an optional attribute is not set. An unknown value counts as set only when
 * the configuration sets it; otherwise the provider computes it (for example
 * `aws_eip.network_interface` after an instance association).
 */
const isNull = (r: Resource, attr: string) => (isUnknown(r, [attr]) ? !r.configured.has(attr) : r.values[attr] === null || r.values[attr] === undefined || r.values[attr] === "");

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

const localRoutes = (vpc: Vpc, table: string, cidrs: IntervalSet): Route[] =>
  cidrs.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" }, text: `${table} local route` }));

/** Rules attached to one target key, plus a reason if some rule's target is unknown. */
class Index<T> {
  readonly byKey = new Map<Key, Known<T>[]>();
  /** Set when a rule's target cannot be resolved: every target of this kind is then unknown. */
  unresolved: string | undefined;

  add(key: Known<Key | null>, item: Known<T>): void {
    if (!key.ok) this.unresolved ??= key.reason;
    else if (key.value !== null) this.byKey.set(key.value, [...(this.byKey.get(key.value) ?? []), item]);
  }

  get(key: Key): Known<T[]> {
    if (this.unresolved) return unknown(this.unresolved);
    const out: T[] = [];
    for (const item of this.byKey.get(key) ?? []) {
      if (!item.ok) return unknown(item.reason);
      out.push(item.value);
    }
    return known(out);
  }
}

export class ModelBuilder {
  /** Target address to the unmodeled resources that point at it. */
  private readonly touchedBy = new Map<string, Resource[]>();
  private readonly sgRules = new Index<SgRule>();
  private readonly routes = new Index<Route>();
  private readonly naclRules = new Index<{ egress: boolean; rule: NaclRule }>();
  /** Subnet address to the NACL keys associated with it by aws_network_acl_association. */
  private readonly naclAssoc = new Index<Key>();
  /** VPC address to the route table set as main by aws_main_route_table_association. */
  private readonly mainAssoc = new Index<Key>();
  /** Instance address to the Elastic IPs associated with it. */
  private readonly eips = new Index<string>();
  /** VPC address to internet gateways attached by aws_internet_gateway_attachment. */
  private readonly igwAttach = new Index<string>();

  /** Unmodeled resources whose target cannot be resolved: they may change anything of their kind. */
  private readonly touchesAnything: Resource[] = [];

  constructor(private readonly snap: Snapshot) {
    this.indexRuleResources();
    for (const r of snap.resources.values()) {
      if (!UNMODELED.has(r.type)) continue;
      const targets = new Set<string>();
      for (const list of Object.values(r.refs)) for (const t of list) for (const a of [instanceOf(snap, localize(r.address, t))]) if (a) targets.add(a);
      for (const v of Object.values(r.values)) {
        const t = typeof v === "string" ? snap.byId.get(v) : undefined;
        if (t) targets.add(t);
      }
      // Targets through VPC defaults and managed defaults (`aws_vpc.x.default_route_table_id`).
      for (const attr of new Set([...Object.keys(r.fullRefs), ...Object.keys(r.values).filter((k) => k.endsWith("_id"))])) {
        const key = this.target(r, attr, false);
        if (!key.ok) this.touchesAnything.push(r);
        else if (key.value !== null) targets.add(key.value);
      }
      for (const t of targets) this.touchedBy.set(t, [...(this.touchedBy.get(t) ?? []), r]);
    }
  }

  /** Reason why `address` is unknown because an unmodeled resource of `types` changes it. */
  private touched(address: string, types: string[]): string | undefined {
    const r = (this.touchedBy.get(address) ?? []).find((x) => types.includes(x.type));
    if (r) return `${r.address} (${r.type}) changes ${address}, and ${r.type} is not modeled yet`;
    const any = this.touchesAnything.find((x) => types.includes(x.type));
    return any ? `${any.address} (${any.type}) may change ${address}, and ${any.type} is not modeled yet` : undefined;
  }

  private get(address: string): Resource | undefined {
    return this.snap.resources.get(address);
  }

  private ofType(type: string): Resource[] {
    return [...this.snap.resources.values()].filter((r) => r.type === type);
  }

  private refTo(r: Resource, attr: string, type: string | string[]): Known<string> {
    const ref: Ref = resolveRef(this.snap, r, attr, type);
    if (ref.kind === "resource") return known(ref.address);
    if (ref.kind === "external") return unknown(`${r.address}: ${attr} = ${ref.id} is not managed in this plan`);
    return unknown(ref.reason);
  }

  /** Like refTo, but a known ID outside the plan is `null` (it cannot point at a modeled object). */
  private optionalRefTo(r: Resource, attr: string, type: string | string[]): Known<string | null> {
    if (isNull(r, attr)) return known(null);
    const ref: Ref = resolveRef(this.snap, r, attr, type);
    if (ref.kind === "resource") return known(ref.address);
    if (ref.kind === "external") return known(null);
    return unknown(ref.reason);
  }

  /**
   * The target key of an attribute that holds the ID of a security group, route table,
   * or NACL. Handles VPC default objects (`aws_vpc.x.default_route_table_id`), managed
   * defaults, and plain resources. A known ID outside the plan is `null`.
   */
  private target(r: Resource, attr: string, normalize = true): Known<Key | null> {
    const norm = (key: Key): Known<Key> => (normalize ? this.normalizeKey(key) : known(key));
    if (isNull(r, attr)) return known(null);
    const v = r.values[attr];
    if (!isUnknown(r, [attr]) && typeof v === "string") {
      // A resource that owns the ID wins; only an ID no resource owns can be a VPC default.
      const address = this.snap.byId.get(v);
      if (address) return this.canonical(address);
      for (const vpc of this.ofType("aws_vpc")) for (const [a, kind] of VPC_DEFAULTS) if (vpc.values[a] === v) return norm(`${kind}:${vpc.address}`);
      return known(null);
    }
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: ${attr} uses values that are unknown until apply`);
    const bases = new Map<string, string | undefined>();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) continue;
      const base = m[1] as string;
      if (m[2] || !bases.has(base)) bases.set(base, m[2] ?? bases.get(base));
    }
    if (bases.size !== 1) return unknown(`${r.address}: ${attr} is unknown until apply and cannot be matched to one resource`);
    const [base, part] = [...bases.entries()][0] as [string, string | undefined];
    const address = instanceOf(this.snap, base);
    if (!address) return unknown(`${r.address}: ${attr} refers to ${base}, which is not one resource on the ${this.snap.side} side`);
    if (typeOf(address) === "aws_vpc") {
      const kind = VPC_DEFAULTS.find(([a]) => a === part)?.[1];
      return kind ? norm(`${kind}:${address}`) : unknown(`${r.address}: ${attr} refers to ${address}.${part ?? "id"}`);
    }
    return this.canonical(address);
  }

  /** `main-rt:vpc` is the default route table unless an association replaces the main table. */
  private normalizeKey(key: Key): Known<Key> {
    if (!key.startsWith("main-rt:")) return known(key);
    const vpc = key.slice("main-rt:".length);
    const set = this.mainAssoc.byKey.get(vpc);
    if (this.mainAssoc.unresolved || set?.length) return unknown(`${key}: rules that target the main route table of a VPC with aws_main_route_table_association are not modeled`);
    return known(`default-rt:${vpc}`);
  }

  /** Managed default resources share the key of the default object they adopt. */
  private canonical(address: string): Known<Key> {
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

  private adopted(r: Resource, attr: string, kind: string): Known<Key> {
    const v = r.values[attr];
    if (!isUnknown(r, [attr]) && typeof v === "string") {
      for (const vpc of this.ofType("aws_vpc")) if (VPC_DEFAULTS.some(([a]) => vpc.values[a] === v)) return known(`${kind}:${vpc.address}`);
      return unknown(`${r.address}: ${attr} = ${v} is not the default of a VPC in this plan`);
    }
    const refs = r.otherRefs.has(attr) ? [] : fromConfig(this.snap, r, attr, "aws_vpc");
    const ref = refs.length === 1 ? refs[0] : undefined;
    return ref?.kind === "resource" ? known(`${kind}:${ref.address}`) : unknown(`${r.address}: cannot tell which VPC's default it manages`);
  }

  private managedDefault(key: Key, type: string): Known<Resource | undefined> {
    let found: Resource | undefined;
    for (const d of this.ofType(type)) {
      const k = this.canonical(d.address);
      if (!k.ok) return unknown(k.reason);
      if (k.value !== key) continue;
      if (found) return unknown(`${key} is managed by both ${found.address} and ${d.address}`);
      found = d;
    }
    return known(found);
  }

  private indexRuleResources(): void {
    // Main route table associations first: rules that target `main_route_table_id` depend on them.
    const all = [...this.snap.resources.values()];
    const ordered = [...all.filter((r) => r.type === "aws_main_route_table_association"), ...all.filter((r) => r.type !== "aws_main_route_table_association")];
    for (const r of ordered) {
      switch (r.type) {
        case "aws_security_group_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group_rule
          if (!isUnknown(r, ["type"]) && r.values.type === "egress") break; // Stateful: egress does not affect inbound paths.
          const item = isUnknown(r, ["type"]) ? unknown<SgRule | null>(`${r.address}: type is unknown until apply`) : this.sgRuleOf(r, r.values.protocol, r.values.from_port, r.values.to_port, arr(r.values.cidr_blocks).map(String), arr(r.values.prefix_list_ids).length > 0, ["protocol", "from_port", "to_port", "cidr_blocks", "prefix_list_ids"]);
          this.addSgRule(r, item);
          break;
        }
        case "aws_vpc_security_group_ingress_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule
          const cidr = str(r.values.cidr_ipv4);
          this.addSgRule(r, this.sgRuleOf(r, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], !!str(r.values.prefix_list_id), ["ip_protocol", "from_port", "to_port", "cidr_ipv4", "prefix_list_id"]));
          break;
        }
        case "aws_route": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route
          this.routes.add(this.target(r, "route_table_id"), this.routeOf(r));
          break;
        }
        case "aws_network_acl_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/network_acl_rule
          this.naclRules.add(this.target(r, "network_acl_id"), this.naclRuleOf(r));
          break;
        }
        case "aws_network_acl_association": {
          const subnet = this.optionalRefTo(r, "subnet_id", "aws_subnet");
          const acl = this.target(r, "network_acl_id");
          this.naclAssoc.add(subnet, acl.ok && acl.value !== null ? known(acl.value) : unknown(acl.ok ? `${r.address}: network_acl_id is outside this plan` : acl.reason));
          break;
        }
        case "aws_main_route_table_association": {
          const vpc = this.optionalRefTo(r, "vpc_id", "aws_vpc");
          const t = this.optionalRefTo(r, "route_table_id", ["aws_route_table", "aws_default_route_table"]);
          const table = t.ok && t.value ? this.canonical(t.value) : unknown<Key>(t.ok ? `${r.address}: route_table_id is outside this plan` : t.reason);
          this.mainAssoc.add(vpc, table);
          break;
        }
        case "aws_eip": {
          // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
          // The instance wins; a network interface alone is not modeled. After apply, an EIP on
          // an instance also shows the instance's network interface.
          if (isNull(r, "instance") && !isNull(r, "network_interface")) this.eips.add(unknown(`${r.address} is associated with a network interface, which is not modeled yet`), known(r.address));
          else this.eips.add(this.optionalRefTo(r, "instance", "aws_instance"), known(r.address));
          break;
        }
        case "aws_eip_association": {
          if (isNull(r, "instance_id") && !isNull(r, "network_interface_id")) this.eips.add(unknown(`${r.address} is associated with a network interface, which is not modeled yet`), known(r.address));
          else this.eips.add(this.optionalRefTo(r, "instance_id", "aws_instance"), known(r.address));
          break;
        }
        case "aws_internet_gateway_attachment": {
          const igw = this.refTo(r, "internet_gateway_id", "aws_internet_gateway");
          this.igwAttach.add(this.optionalRefTo(r, "vpc_id", "aws_vpc"), igw);
          break;
        }
      }
    }
  }

  private addSgRule(r: Resource, item: Known<SgRule | null>): void {
    const key = this.target(r, "security_group_id");
    if (item.ok && item.value === null) return; // No IPv4 internet source.
    this.sgRules.add(key, item as Known<SgRule>);
  }

  private sgRuleOf(r: Resource, protocolValue: unknown, from: unknown, to: unknown, cidrs: string[], prefixList: boolean, fields: string[]): Known<SgRule | null> {
    if (fields.some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    // Prefix lists can contain public ranges; the engine cannot expand them offline.
    if (prefixList) return unknown(`${r.address} uses a prefix list, which is not modeled yet`);
    if (!cidrs.length) return known(null); // Security group or IPv6 source: no IPv4 internet source.
    const protocol = normalizeProtocol(protocolValue);
    if (protocol === "other") return known(null); // ICMP and others never match TCP or UDP traffic.
    const ports = portSet(protocol, from, to);
    const sets = cidrs.map((c) => cidrToSet(c));
    if (!ports || sets.some((s) => !s)) return unknown(`${r.address} has a value the engine cannot read`);
    return known({ protocol, ports, sources: fromRanges((sets as IntervalSet[]).flat()), text: `${r.address} ingress ${describePorts(protocol, from, to)} from ${cidrs.join(", ")}` });
  }

  private naclRuleOf(r: Resource): Known<{ egress: boolean; rule: NaclRule }> {
    if (["egress", "rule_number", "protocol", "rule_action", "cidr_block", "from_port", "to_port"].some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    const egress = r.values.egress === true;
    const key = egress ? "egress" : "ingress";
    const cidr = str(r.values.cidr_block);
    if (!cidr) return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol: "other", ports: [], cidr: [], text: `${r.address} (IPv6)` } });
    const protocol = normalizeProtocol(r.values.protocol);
    // ICMP and other protocols never match TCP or UDP traffic; their ports are not read.
    if (protocol === "other") return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol, ports: [], cidr: [], text: `${r.address} (${String(r.values.protocol)})` } });
    const ports = portSet(protocol, r.values.from_port, r.values.to_port);
    const set = cidrToSet(cidr);
    const ruleNo = num(r.values.rule_number);
    if (!ports || !set || ruleNo === undefined) return unknown(`${r.address} has a value the engine cannot read`);
    const allow = String(r.values.rule_action).toLowerCase() === "allow";
    return known({ egress, rule: { ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, r.values.from_port, r.values.to_port)} ${egress ? "to" : "from"} ${cidr}` } });
  }

  private gatewayTarget(r: Resource, gw: Known<string | null>, text: string): RouteTarget {
    if (!gw.ok) return { kind: "unknown", reason: gw.reason };
    if (gw.value === null) return { kind: "unknown", reason: `${text}: gateway is not in this plan` };
    return typeOf(gw.value) === "aws_internet_gateway" ? { kind: "igw", address: gw.value } : { kind: "other", text: typeOf(gw.value).replace(/^aws_/, "").replaceAll("_", " ") };
  }

  private routeOf(r: Resource): Known<Route> {
    if (hasUnknown(r, ["destination_cidr_block"])) return unknown(`${r.address}: destination is unknown until apply`);
    const cidr = str(r.values.destination_cidr_block);
    if (!cidr) {
      if (str(r.values.destination_prefix_list_id) || isUnknown(r, ["destination_prefix_list_id"])) return unknown(`${r.address} uses a prefix list, which is not modeled yet`);
      return known({ cidr: [], prefix: 0, target: { kind: "local" }, text: `${r.address} (IPv6)` });
    }
    const set = cidrToSet(cidr);
    const prefix = cidrPrefixLength(cidr);
    if (!set || prefix === undefined) return unknown(`${r.address}: destination ${cidr} cannot be read`);
    let target: RouteTarget;
    if (r.values.gateway_id === "local") target = { kind: "local" };
    else if (!isNull(r, "gateway_id")) {
      const gw = r.values.gateway_id;
      if (!isUnknown(r, ["gateway_id"]) && typeof gw === "string") {
        const a = this.snap.byId.get(gw);
        target = a ? this.gatewayTarget(r, known(a), r.address) : { kind: "unknown", reason: `${r.address}: gateway ${gw} is not in this plan` };
      } else target = this.gatewayTarget(r, this.refTo(r, "gateway_id", ["aws_internet_gateway", "aws_vpn_gateway"]), r.address);
    } else {
      const other = ["nat_gateway_id", "network_interface_id", "transit_gateway_id", "vpc_peering_connection_id", "vpc_endpoint_id", "egress_only_gateway_id", "carrier_gateway_id", "local_gateway_id", "core_network_arn"].find((k) => !isNull(r, k));
      target = other ? { kind: "other", text: other.replace(/_id$|_arn$/, "").replaceAll("_", " ") } : { kind: "unknown", reason: `${r.address} has no target the engine can read` };
    }
    const to = target.kind === "igw" ? target.address : target.kind === "other" ? target.text : target.kind;
    return known({ cidr: set, prefix, target, text: `${r.address} ${cidr} -> ${to}` });
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
    const igws = new Set<string>();
    for (const g of this.ofType("aws_internet_gateway")) {
      const v = this.optionalRefTo(g, "vpc_id", "aws_vpc");
      if (!v.ok) return known({ address, cidrs, igw: unknown(v.reason) });
      if (v.value === address) igws.add(g.address);
    }
    const attached = this.igwAttach.get(address);
    if (!attached.ok) return known({ address, cidrs, igw: unknown(attached.reason) });
    attached.value.forEach((g) => igws.add(g));
    const igw: Known<string | undefined> = igws.size > 1 ? unknown(`${address} has ${igws.size} internet gateways in the plan`) : known([...igws][0]);
    return known({ address, cidrs, igw });
  }

  /** A security group by key, with inline rules and rule resources merged. */
  private securityGroup(key: Key): SecurityGroup {
    const extra = this.sgRules.get(key);
    if (key.startsWith("default-sg:")) {
      const vpc = key.slice("default-sg:".length);
      const managed = this.managedDefault(key, "aws_default_security_group");
      if (!managed.ok) return { address: `default security group of ${vpc}`, ingress: unknown(managed.reason) };
      if (!managed.value) {
        // The default security group allows inbound traffic only from itself: no internet
        // source. The engine assumes it was not changed outside Terraform.
        // https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
        return { address: `default security group of ${vpc}`, ingress: extra };
      }
      return this.inlineSg(managed.value, extra);
    }
    const r = this.get(key);
    if (!r) return { address: key, ingress: unknown(`${key} is not in this plan`) };
    return this.inlineSg(r, extra);
  }

  private inlineSg(r: Resource, extra: Known<SgRule[]>): SecurityGroup {
    const address = r.address;
    if (!extra.ok) return { address, ingress: extra };
    if (isUnknown(r, ["ingress"])) {
      // A security group with rule resources and no inline rules has computed `ingress`.
      if (!r.configured.has("ingress")) return { address, ingress: extra };
      return { address, ingress: unknown(`${address}: ingress is unknown until apply`) };
    }
    const rules: SgRule[] = [];
    for (const [i, raw] of arr(r.values.ingress).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, ["ingress", i])) return { address, ingress: unknown(`${address}: ingress rule ${i} has values that are unknown until apply`) };
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue; // ICMP and others never match TCP or UDP traffic.
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      if (arr(raw.prefix_list_ids).length) return { address, ingress: unknown(`${address}: ingress rule ${i} uses a prefix list, which is not modeled yet`) };
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s)) return { address, ingress: unknown(`${address}: ingress rule ${i} has a value the engine cannot read`) };
      if (!cidrs.length) continue; // Security group sources or IPv6: no IPv4 internet source.
      rules.push({ protocol, ports, sources: fromRanges((sets as IntervalSet[]).flat()), text: `${address} ingress ${describePorts(protocol, raw.from_port, raw.to_port)} from ${cidrs.join(", ")}` });
    }
    return { address, ingress: known([...rules, ...extra.value]) };
  }

  private inlineNaclRules(r: Resource, key: "ingress" | "egress"): Known<NaclRule[]> {
    if (isUnknown(r, [key])) return r.configured.has(key) ? unknown(`${r.address}: ${key} is unknown until apply`) : known([]);
    const rules: NaclRule[] = [];
    for (const [i, raw] of arr(r.values[key]).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, [key, i])) return unknown(`${r.address}: ${key} rule ${i} has values that are unknown until apply`);
      if (str(raw.ipv6_cidr_block)) continue; // IPv6 rules never match IPv4 traffic.
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue; // ICMP and others never match TCP or UDP traffic.
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidr = str(raw.cidr_block);
      const set = cidr ? cidrToSet(cidr) : undefined;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === undefined) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
    }
    return known(rules);
  }

  /** A NACL by key: inline rules (or the AWS default) merged with aws_network_acl_rule resources. */
  private nacl(key: Key): Nacl {
    let resource = key;
    let base: { ingress: Known<NaclRule[]>; egress: Known<NaclRule[]> };
    if (key.startsWith("default-nacl:")) {
      const vpc = key.slice("default-nacl:".length);
      const managed = this.managedDefault(key, "aws_default_network_acl");
      resource = managed.ok && managed.value ? managed.value.address : `default NACL of ${vpc}`;
      if (!managed.ok) return { resource, ingress: unknown(managed.reason), egress: unknown(managed.reason) };
      if (managed.value) base = { ingress: this.inlineNaclRules(managed.value, "ingress"), egress: this.inlineNaclRules(managed.value, "egress") };
      else {
        // The default NACL allows all inbound and outbound traffic. The engine assumes it
        // was not changed outside Terraform.
        // https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html
        const all = (dir: string): NaclRule[] => [{ ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${dir} rule 100: allow all traffic (AWS default)` }];
        base = { ingress: known(all("ingress")), egress: known(all("egress")) };
      }
    } else {
      const r = this.get(key);
      if (!r) return { resource, ingress: unknown(`${key} is not in this plan`), egress: unknown(`${key} is not in this plan`) };
      base = { ingress: this.inlineNaclRules(r, "ingress"), egress: this.inlineNaclRules(r, "egress") };
    }
    const extra = this.naclRules.get(key);
    const merge = (dir: Known<NaclRule[]>, egress: boolean): Known<NaclRule[]> => {
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
  subnetNacl(subnet: string, vpc: string): Known<Nacl> {
    const claims = new Set<Key>();
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
    return known(this.nacl([...claims][0] ?? `default-nacl:${vpc}`));
  }

  private routeTarget(r: Resource, raw: Obj, path: (string | number)[], unknownGateways: number, knownGateways: number): RouteTarget {
    const gwUnknown = isUnknown(r, [...path, "gateway_id"]);
    const gw = str(raw.gateway_id);
    if (gw === "local") return { kind: "local" };
    if (gw || gwUnknown) {
      if (!gwUnknown && gw) {
        const a = this.snap.byId.get(gw);
        if (a) return this.gatewayTarget(r, known(a), r.address);
        return { kind: "unknown", reason: `${r.address}: gateway_id ${gw} is not in this plan` };
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

  private inlineRoutes(r: Resource): Known<Route[]> {
    // Routes propagated from a virtual private gateway can be more specific than static routes.
    // https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
    const vgws = r.values.propagating_vgws;
    if ((Array.isArray(vgws) && vgws.length) || (isUnknown(r, ["propagating_vgws"]) && r.configured.has("propagating_vgws"))) {
      return unknown(`${r.address}: route propagation from a virtual private gateway is not modeled yet`);
    }
    if (isUnknown(r, ["route"])) return r.configured.has("route") ? unknown(`${r.address}: route is unknown until apply`) : known([]);
    const blocks = arr(r.values.route);
    const unknownGateways = blocks.filter((_, i) => isUnknown(r, ["route", i, "gateway_id"])).length;
    const knownGateways = blocks.filter((b, i) => isObj(b) && !isUnknown(r, ["route", i, "gateway_id"]) && str(b.gateway_id) && b.gateway_id !== "local").length;
    const routes: Route[] = [];
    for (const [i, raw] of blocks.entries()) {
      if (!isObj(raw)) continue;
      if (isUnknown(r, ["route", i, "cidr_block"])) return unknown(`${r.address}: route ${i} destination is unknown until apply`);
      const cidr = str(raw.cidr_block);
      if (!cidr) {
        if (str(raw.destination_prefix_list_id)) return unknown(`${r.address}: route ${i} uses a prefix list, which is not modeled yet`);
        continue; // IPv6 route.
      }
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === undefined) return unknown(`${r.address}: route ${i} has destination ${cidr}, which the engine cannot read`);
      const target = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
      const to = target.kind === "igw" ? target.address : target.kind === "other" ? target.text : target.kind;
      routes.push({ cidr: set, prefix, target, text: `${r.address} route ${cidr} -> ${to}` });
    }
    return known(routes);
  }

  /** A route table by key: local routes, inline routes, and aws_route resources. */
  private routeTable(key: Key, vpc: Vpc, isMain: boolean): RouteTable {
    let resource = key;
    let base: Known<Route[]> = known([]);
    if (key.startsWith("default-rt:")) {
      const managed = this.managedDefault(key, "aws_default_route_table");
      resource = managed.ok && managed.value ? managed.value.address : `${isMain ? "main" : "default"} route table of ${vpc.address}`;
      if (!managed.ok) return { resource, routes: unknown(managed.reason) };
      // Unmanaged, the default route table has only the local route.
      if (managed.value) base = this.inlineRoutes(managed.value);
    } else {
      const r = this.get(key);
      if (!r) return { resource, routes: unknown(`${key} is not in this plan`) };
      base = this.inlineRoutes(r);
    }
    const touched = this.touched(key, UNMODELED_ROUTES) ?? (isMain ? this.touched(`main-rt:${vpc.address}`, UNMODELED_ROUTES) : undefined);
    if (touched) return { resource, routes: unknown(touched) };
    if (!base.ok) return { resource, routes: base };
    const extra = this.routes.get(key);
    if (!extra.ok) return { resource, routes: extra };
    if (!vpc.cidrs.ok) return { resource, routes: unknown(vpc.cidrs.reason) };
    // Every route table has a local route for the VPC CIDR.
    // https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
    return { resource, routes: known([...localRoutes(vpc, resource, vpc.cidrs.value), ...base.value, ...extra.value.filter((x) => x.cidr.length)]) };
  }

  /**
   * The route table of a subnet: an explicit association, else the VPC's main route table.
   * https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
   */
  subnetRouteTable(subnet: string, vpc: Vpc): Known<RouteTable> {
    const assoc = new Set<Key>();
    for (const a of this.ofType("aws_route_table_association")) {
      const s = this.optionalRefTo(a, "subnet_id", "aws_subnet");
      if (!s.ok) return unknown(s.reason);
      if (s.value !== subnet) continue;
      const t = this.target(a, "route_table_id");
      if (!t.ok) return unknown(t.reason);
      if (t.value === null) return unknown(`${a.address}: route table is not in this plan`);
      assoc.add(t.value);
    }
    if (assoc.size > 1) return unknown(`${subnet} has ${assoc.size} route table associations`);
    const explicit = [...assoc][0];
    if (explicit) return known(this.routeTable(explicit, vpc, false));
    const main = this.mainAssoc.get(vpc.address);
    if (!main.ok) return unknown(main.reason);
    if (main.value.length > 1) return unknown(`${vpc.address} has ${main.value.length} main route table associations`);
    return known(this.routeTable(main.value[0] ?? `default-rt:${vpc.address}`, vpc, true));
  }

  /**
   * Endpoints, one entry per possible placement. An EC2 instance has one subnet. RDS and
   * load balancers have several; the analysis compares the results of all placements.
   */
  endpoints(): Endpoint[] {
    return [
      ...this.ofType("aws_instance").map((r) => this.instance(r)),
      ...this.ofType("aws_db_instance").flatMap((r) => this.dbInstance(r)),
      ...this.ofType("aws_lb").flatMap((r) => this.loadBalancer(r)),
    ];
  }

  private fail(r: Resource, reason: string): Endpoint {
    return { address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) };
  }

  /** An endpoint for `r` placed in `subnet`. */
  private place(r: Resource, subnet: string, publicIp: (s: Resource) => Known<string | undefined>, groups: (vpc: string) => Known<SecurityGroup[]>, placement?: string): Endpoint {
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
      publicIp: publicIp(s),
      securityGroups: groups(vpcRef.value),
      nacl: this.subnetNacl(subnet, vpcRef.value),
      routeTable: this.subnetRouteTable(subnet, vpc.value),
      ...(placement ? { placement } : {}),
    };
  }

  /**
   * Security groups listed in `attr`. An empty list means the VPC's default group.
   * https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
   */
  private groups(r: Resource, attr: string, vpc: string, emptyMeansDefault = true): Known<SecurityGroup[]> | "empty" {
    const v = r.values[attr];
    if (isNull(r, attr) || (Array.isArray(v) && !v.length && !isUnknown(r, [attr]))) {
      return emptyMeansDefault ? known([this.securityGroup(`default-sg:${vpc}`)]) : "empty";
    }
    const keys: Key[] = [];
    for (const ref of resolveRefs(this.snap, r, attr, ["aws_security_group", "aws_default_security_group"])) {
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

  private instance(r: Resource): Endpoint {
    const touched = this.touched(r.address, UNMODELED_INSTANCE);
    if (touched) return this.fail(r, touched);
    if (arr(r.values.network_interface).length) return this.fail(r, `${r.address}: network_interface blocks are not modeled yet`);
    const subnet = this.refTo(r, "subnet_id", "aws_subnet");
    if (!subnet.ok) return this.fail(r, subnet.reason);

    // A public IPv4 address comes from an Elastic IP, from associate_public_ip_address,
    // or from the subnet's map_public_ip_on_launch.
    // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
    const publicIp = (s: Resource): Known<string | undefined> => {
      let out: Known<string | undefined>;
      const eips = this.eips.get(r.address);
      const assoc = r.values.associate_public_ip_address;
      if (eips.ok && eips.value.length) out = known(`${eips.value.toSorted(cmp).join(", ")} is associated with ${r.address}`);
      else if (isUnknown(r, ["associate_public_ip_address"]) && r.configured.has("associate_public_ip_address")) {
        out = unknown(`${r.address}: associate_public_ip_address is set to a value that is unknown until apply`);
      } else if (!isUnknown(r, ["associate_public_ip_address"]) && typeof assoc === "boolean") {
        out = known(assoc ? `${r.address} associate_public_ip_address = true` : undefined);
      } else if (!isUnknown(s, ["map_public_ip_on_launch"]) && typeof s.values.map_public_ip_on_launch === "boolean") {
        out = known(s.values.map_public_ip_on_launch ? `${s.address} map_public_ip_on_launch = true` : undefined);
      } else {
        out = unknown(`${r.address}: whether it gets a public IPv4 address is unknown until apply`);
      }
      if (!eips.ok && !(out.ok && out.value)) out = unknown(eips.reason);
      return out;
    };
    return this.place(r, subnet.value, publicIp, (vpc) => {
      const g = this.groups(r, "vpc_security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    });
  }

  /**
   * RDS: the DB instance gets a public address only when publicly_accessible is true, and
   * "Amazon RDS chooses a subnet and an IP address within that subnet group".
   * https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
   */
  private dbInstance(r: Resource): Endpoint[] {
    let subnets: Known<string[]>;
    const groupName = r.values.db_subnet_group_name;
    if (isNull(r, "db_subnet_group_name")) subnets = unknown(`${r.address} uses the default DB subnet group, which is not in this plan`);
    else {
      let group: Resource | undefined;
      if (!isUnknown(r, ["db_subnet_group_name"]) && typeof groupName === "string") group = this.ofType("aws_db_subnet_group").find((g) => g.values.name === groupName);
      else if (!r.otherRefs.has("db_subnet_group_name")) {
        const refs = fromConfig(this.snap, r, "db_subnet_group_name", "aws_db_subnet_group");
        if (refs.length === 1 && refs[0]?.kind === "resource") group = this.get(refs[0].address);
      }
      if (!group) subnets = unknown(`${r.address}: its DB subnet group is not in this plan`);
      else {
        const refs = resolveRefs(this.snap, group, "subnet_ids", "aws_subnet");
        const bad = refs.find((x) => x.kind !== "resource");
        subnets = bad ? unknown(bad.kind === "unknown" ? bad.reason : `${group.address}: a subnet is not managed in this plan`) : known(refs.map((x) => (x as { address: string }).address));
      }
    }
    const pa = r.values.publicly_accessible;
    const publicIp = (): Known<string | undefined> =>
      isUnknown(r, ["publicly_accessible"]) ? unknown(`${r.address}: publicly_accessible is unknown until apply`) : known(pa === true ? `${r.address} publicly_accessible = true` : undefined);
    if (!subnets.ok || !subnets.value.length) {
      const reason = subnets.ok ? `${r.address}: its DB subnet group has no subnets` : subnets.reason;
      // A DB instance known to be private is blocked at the public IP hop wherever it is.
      const ip = publicIp();
      return [ip.ok && !ip.value ? { ...this.fail(r, reason), publicIp: ip } : this.fail(r, reason)];
    }
    return subnets.value.map((sub) =>
      this.place(r, sub, publicIp, (vpc) => {
        const g = this.groups(r, "vpc_security_group_ids", vpc);
        return g === "empty" ? known([]) : g;
      }, "the result depends on the subnet that RDS chooses from the DB subnet group"),
    );
  }

  /**
   * Load balancers: internet-facing when internal = false, with a node in each subnet.
   * A Network Load Balancer without security groups lets "all client traffic reach the
   * Network Load Balancer listeners", so its listener ports act as the allow rules.
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-security-groups.html
   */
  private loadBalancer(r: Resource): Endpoint[] {
    // Subnets come from `subnets` or `subnet_mapping`; when both are known and disagree,
    // the plan may hold stale state for one of them.
    const fromSubnets = (): Known<string[]> => {
      const refs = resolveRefs(this.snap, r, "subnets", "aws_subnet");
      const bad = refs.find((x) => x.kind !== "resource");
      return bad ? unknown(bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`) : known(refs.map((x) => (x as { address: string }).address).toSorted(cmp));
    };
    const mappings = arr(r.values.subnet_mapping);
    let subnets: Known<string[]>;
    if (mappings.length) {
      const ids = mappings.map((m) => (isObj(m) ? m.subnet_id : undefined));
      const all = ids.every((id) => typeof id === "string") ? ids.map((id) => this.snap.byId.get(id as string)) : [];
      subnets = all.length === ids.length && all.every(Boolean) ? known((all as string[]).toSorted(cmp)) : unknown(`${r.address}: subnet_mapping is unknown until apply or outside this plan`);
      const listed = arr(r.values.subnets).length || isUnknown(r, ["subnets"]) ? fromSubnets() : undefined;
      if (subnets.ok && listed && (!listed.ok || listed.value.join() !== subnets.value.join())) subnets = unknown(`${r.address}: subnets and subnet_mapping disagree`);
    } else subnets = fromSubnets();
    if (!subnets.ok) return [this.fail(r, subnets.reason)];
    if (!subnets.value.length) return [this.fail(r, `${r.address} has no subnets in this plan`)];

    // The type decides what an empty security group list means, so it must be known.
    // Unset, the provider's default is "application".
    if (isUnknown(r, ["load_balancer_type"]) && r.configured.has("load_balancer_type")) return [this.fail(r, `${r.address}: load_balancer_type is unknown until apply`)];
    const type = isUnknown(r, ["load_balancer_type"]) ? "application" : String(r.values.load_balancer_type ?? "application");

    // Internet-facing (internal = false) gives each node a public IPv4 address, except
    // with ip_address_type "dualstack-without-public-ipv4".
    // https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
    const publicIp = (): Known<string | undefined> => {
      if (isUnknown(r, ["internal"])) return unknown(`${r.address}: internal is unknown until apply`);
      if (r.values.internal === true) return known(undefined);
      if (isUnknown(r, ["ip_address_type"]) && r.configured.has("ip_address_type")) return unknown(`${r.address}: ip_address_type is unknown until apply`);
      const ipType = isUnknown(r, ["ip_address_type"]) ? "ipv4" : String(r.values.ip_address_type ?? "ipv4");
      if (ipType === "dualstack-without-public-ipv4") return known(undefined);
      if (ipType !== "ipv4" && ipType !== "dualstack") return unknown(`${r.address}: ip_address_type ${ipType} is not modeled`);
      return known(`${r.address} is internet-facing (internal = false)`);
    };
    const network = type === "network" || type === "gateway";
    const groups = (vpc: string): Known<SecurityGroup[]> => {
      const g = this.groups(r, "security_groups", vpc, !network);
      return g === "empty" ? this.listenerGroup(r) : g;
    };
    return subnets.value.map((sub) => this.place(r, sub, publicIp, groups, "the result differs between the load balancer's subnets"));
  }

  /** Listener ports of a load balancer without security groups, as allow rules from anywhere. */
  private listenerGroup(lb: Resource): Known<SecurityGroup[]> {
    if (lb.values.load_balancer_type === "gateway") return unknown(`${lb.address}: Gateway Load Balancers are not modeled yet`);
    const rules: SgRule[] = [];
    for (const l of this.ofType("aws_lb_listener")) {
      const target = this.optionalRefTo(l, "load_balancer_arn", "aws_lb");
      if (!target.ok) return unknown(target.reason);
      if (target.value !== lb.address) continue;
      const port = num(l.values.port);
      const proto = String(l.values.protocol ?? "").toUpperCase();
      if (port === undefined || isUnknown(l, ["port"]) || isUnknown(l, ["protocol"])) return unknown(`${l.address}: port or protocol is unknown until apply`);
      const protocols: RuleProtocol[] = proto === "UDP" ? ["udp"] : proto === "TCP_UDP" ? ["tcp", "udp"] : ["tcp"];
      for (const protocol of protocols) rules.push({ protocol, ports: [[port, port]], sources: ALL_IPV4, text: `${l.address} listens on ${protocol} ${port} (${lb.address} has no security groups)` });
    }
    return known([{ address: `listeners of ${lb.address}`, ingress: known(rules) }]);
  }
}
