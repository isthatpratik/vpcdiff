import { ALL_IPV4, ALL_PORTS, cidrPrefixLength, cidrToSet, fromRanges, type IntervalSet } from "./intervals.js";
import { cidr6ToSet, fromRanges6, IPV6_MAX, prefixLength6, type Set6 } from "./intervals6.js";

const IPV6_ALL: Set6 = [[0n, IPV6_MAX]];
import { cmp, fromConfig, hasUnknown, instanceOf, isObj, isUnknown, localize, resolveRef, resolveRefs, type Obj, type Ref, type Resource, type Snapshot } from "./plan.js";

export type Known<T> = { ok: true; value: T } | { ok: false; reason: string };
const known = <T>(value: T): Known<T> => ({ ok: true, value });
const unknown = <T>(reason: string): Known<T> => ({ ok: false, reason });

export type RuleProtocol = "tcp" | "udp" | "all" | "other";

export interface SgRule {
  protocol: RuleProtocol;
  ports: IntervalSet;
  /** Source CIDRs of an ingress rule, or destination CIDRs of an egress rule. */
  sources: IntervalSet;
  /** The same for IPv6 (`ipv6_cidr_blocks`, `cidr_ipv6`). */
  sources6?: Set6;
  /**
   * Security groups whose members are the sources (ingress) or destinations (egress),
   * by group key (an address, or `default-sg:<vpc>`). `self` adds the rule's own group.
   * https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
   */
  groups: string[];
  /** Set when a referenced group cannot be resolved in this plan. */
  unresolved?: string;
  /** Set when a prefix list of the rule cannot be expanded: its addresses are undecided. */
  listUnresolved?: string;
  /** The resource that defines the rule: the group, or a rule resource. */
  resource: string;
  text: string;
}

/** `via`: resources that shaped an object (rule resources, associations, attachments). */
export interface SecurityGroup {
  address: string;
  /** The key other rules use to reference this group. */
  key: string;
  ingress: Known<SgRule[]>;
  egress: Known<SgRule[]>;
  via?: string[];
}

export interface NaclRule {
  ruleNo: number;
  allow: boolean;
  protocol: RuleProtocol;
  ports: IntervalSet;
  cidr: IntervalSet;
  /** Set on an IPv6 entry (`ipv6_cidr_block`); `cidr` is then empty. */
  cidr6?: Set6;
  text: string;
}

export interface Nacl {
  resource: string;
  ingress: Known<NaclRule[]>;
  egress: Known<NaclRule[]>;
  via?: string[];
}

export type RouteTarget =
  | { kind: "local" }
  | { kind: "igw"; address: string }
  /** `tgw`: for a route to a transit gateway, the aws_ec2_transit_gateway it names. */
  | { kind: "other"; text: string; tgw?: Known<string> }
  /** A target that never carries traffic back to the internet: NAT gateway, peering, blackhole. */
  | { kind: "drop"; text: string; why: string; peering?: Known<string> }
  | { kind: "unknown"; reason: string };

export interface Route {
  cidr: IntervalSet;
  prefix: number;
  target: RouteTarget;
  text: string;
  /** Set when the destination is a prefix list that cannot be expanded; `cidr` is then empty. */
  listUnresolved?: string;
  /** The list holds an AWS service's public ranges (a gateway endpoint route), never private addresses. */
  awsService?: boolean;
  /** Set on an IPv6 route; `cidr` is then empty and `prefix` is the IPv6 length. */
  cidr6?: Set6;
}

export interface RouteTable {
  resource: string;
  routes: Known<Route[]>;
  via?: string[];
}

/** A VPC peering connection of a VPC: the other VPC, and whether it is active. */
export interface Peering {
  address: string;
  /** The other VPC's address, or why it is not known in this plan. */
  peer: Known<string>;
  active: Known<string>;
}

/** A route in a transit gateway route table. `from`: the attachment that propagated it. */
export interface TgwRoute {
  cidr: IntervalSet;
  prefix: number;
  static: boolean;
  target: { kind: "attachment"; address: string } | { kind: "blackhole" } | { kind: "unknown"; reason: string };
  from?: string;
  text: string;
}

/** A subnet of a transit gateway VPC attachment: where traffic enters and leaves the VPC. */
export interface TgwSubnet {
  address: string;
  az: Known<string>;
  table: Known<RouteTable>;
}

export interface TgwAttachment {
  address: string;
  tgw: string;
  vpc: string;
  subnets: Known<TgwSubnet[]>;
  /** The key of the associated transit gateway route table, or null when there is none. */
  association: Known<string | null>;
  sgRefs: Known<boolean>;
}

/** Transit gateways in the plan, their VPC attachments, and their route tables (docs/semantics/transit-gateway.md). */
export interface Transit {
  gateways: Map<string, { sgRefs: Known<boolean> }>;
  attachments: TgwAttachment[];
  /** Route table key to its routes; `tables` names each key for the result. */
  routes: Map<string, Known<TgwRoute[]>>;
  names: Map<string, string>;
}

export interface Vpc {
  address: string;
  cidrs: Known<IntervalSet>;
  /** The IPv4 blocks (primary and secondary) as written; local routes use each one's own length. */
  blocks?: string[];
  igw: Known<string | undefined>;
  peerings?: Known<Peering[]>;
  /** Whether the VPC has an IPv6 block, and the block when it is known before apply. */
  ipv6?: Known<{ cidrs?: Set6 } | undefined>;
  via?: string[];
}

export interface Endpoint {
  address: string;
  type: string;
  vpc: Known<Vpc>;
  subnet: Known<string>;
  /** The subnet's IPv4 CIDR: the endpoint's private address is somewhere in it. */
  subnetCidr: Known<IntervalSet>;
  publicIp: Known<string | undefined>;
  /** A public (global) IPv6 address, for IPv6 paths from the internet. */
  publicIp6?: Known<string | undefined>;
  securityGroups: Known<SecurityGroup[]>;
  nacl: Known<Nacl>;
  routeTable: Known<RouteTable>;
  /** The subnet's Availability Zone (for transit gateway attachments). */
  az?: Known<string>;
  /** Transit gateways in the plan, for paths between VPCs. */
  transit?: Known<Transit>;
  /** For endpoints with several possible subnets: why placements can differ. */
  placement?: string;
  via?: string[];
}

// Resource types that change network behavior but are not modeled yet. A hop that one of
// them can change becomes `unknown`, so an unmodeled resource never hides a path (ADR 0003).
const UNMODELED_ROUTES = ["aws_vpn_gateway_route_propagation"];
const UNMODELED_INSTANCE = ["aws_network_interface_sg_attachment", "aws_network_interface_attachment"];
const UNMODELED = new Set([...UNMODELED_ROUTES, ...UNMODELED_INSTANCE]);
// They change transit gateway routing; while one is in the plan, every transit gateway path is unknown.
const UNMODELED_TGW = ["aws_ec2_transit_gateway_default_route_table_association", "aws_ec2_transit_gateway_default_route_table_propagation", "aws_ec2_transit_gateway_prefix_list_reference", "aws_ec2_transit_gateway_vpc_attachment_accepter"];
const TGW_DEFAULTS = ["association_default_route_table_id", "propagation_default_route_table_id"];

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

/**
 * Route targets that cannot carry a response back to a client on the internet.
 * - NAT gateway: "Connections must always be initiated from within the VPC containing the NAT gateway."
 *   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
 * - VPC peering: "If VPC A has an internet gateway, resources in VPC B can't use the internet gateway in VPC A to access the internet."
 *   https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html
 */
const DROP: Record<string, { text: string; why: string }> = {
  nat_gateway_id: { text: "nat gateway", why: "a NAT gateway does not carry traffic for connections that start on the internet" },
  vpc_peering_connection_id: { text: "vpc peering connection", why: "a peered VPC cannot use another VPC's internet gateway (no edge to edge routing)" },
  // "prevent the internet from initiating connections with the instances"
  // https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html
  egress_only_gateway_id: { text: "egress-only internet gateway", why: "an egress-only internet gateway does not carry traffic for connections that start on the internet" },
};
const BLACKHOLE = { text: "blackhole", why: "the route's target no longer exists, so AWS drops the traffic (route state blackhole)" };
const dropOf = (key: string): RouteTarget | undefined => {
  const d = DROP[key];
  return d ? { kind: "drop", ...d } : undefined;
};

/** Prefix list entries, expanded: the union and one CIDR per entry (for routes). */
interface Lists {
  set: IntervalSet;
  entries: { cidr: string; set: IntervalSet }[];
  names: string[];
  unresolved?: string;
}
const NO_LISTS: Lists = { set: [], entries: [], names: [] };

/** How a group key reads in a rule: its address, or the VPC's default group. */
export const groupLabel = (key: string): string => (key.startsWith("default-sg:") ? `default security group of ${key.slice("default-sg:".length)}` : key);

/** True when `refs` also holds `ref` with an attribute (`x.id` next to `x`). */
const fullRefsHasAttr = (refs: string[], ref: string) => refs.some((o) => o.startsWith(`${ref}.`));

/** A subnet's IPv4 CIDR block. */
function subnetCidrOf(s: Resource): Known<IntervalSet> {
  const cidr = typeof s.values.cidr_block === "string" ? s.values.cidr_block : undefined;
  const set = cidr && !isUnknown(s, ["cidr_block"]) ? cidrToSet(cidr) : undefined;
  return set ? known(set) : unknown(`${s.address}: cidr_block is unknown until apply`);
}

/** A subnet's Availability Zone name. */
function azOf(s: Resource): Known<string> {
  const az = typeof s.values.availability_zone === "string" ? s.values.availability_zone : undefined;
  return az && !isUnknown(s, ["availability_zone"]) ? known(az) : unknown(`${s.address}: availability_zone is unknown until apply`);
}

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

/** One local route per VPC block, with the block's own prefix length (adjacent blocks must not merge). */
const localRoutes = (vpc: Vpc, table: string, cidrs: IntervalSet): Route[] =>
  vpc.blocks
    ? vpc.blocks.flatMap((b) => {
        const set = cidrToSet(b);
        const prefix = cidrPrefixLength(b);
        return set && prefix !== undefined ? [{ cidr: set, prefix, target: { kind: "local" as const }, text: vpc.blocks && vpc.blocks.length > 1 ? `${table} local route (${b})` : `${table} local route` }] : [];
      })
    : cidrs.map((range) => ({ cidr: [range], prefix: 32 - Math.log2(range[1] - range[0] + 1), target: { kind: "local" as const }, text: `${table} local route` }));

/** Rules attached to one target key, plus a reason if some rule's target is unknown. */
class Index<T> {
  readonly byKey = new Map<Key, Known<T>[]>();
  /** Set when a rule's target cannot be resolved: every target of this kind is then unknown. */
  unresolved: string | undefined;

  private readonly from = new Map<Key, string[]>();

  add(key: Known<Key | null>, item: Known<T>, source?: string): void {
    if (!key.ok) this.unresolved ??= key.reason;
    else if (key.value !== null) {
      this.byKey.set(key.value, [...(this.byKey.get(key.value) ?? []), item]);
      if (source) this.from.set(key.value, [...(this.from.get(key.value) ?? []), source]);
    }
  }

  /** Addresses of the resources that added rules to `key`. */
  sources(key: Key): string[] {
    return this.from.get(key) ?? [];
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
  private readonly sgEgress = new Index<SgRule>();
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
  /** Route table key to the gateway VPC endpoints associated with it. */
  private readonly gatewayEndpoints = new Index<string>();
  /** Network interface address to the Elastic IPs associated with it. */
  private readonly eniEips = new Index<string>();
  /** Network interface address to security group keys added by aws_network_interface_sg_attachment. */
  private readonly eniGroups = new Index<Key>();
  /** Prefix list address to aws_ec2_managed_prefix_list_entry CIDRs. */
  private readonly plEntries = new Index<string>();

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
    if (!isUnknown(r, [attr]) && typeof v === "string") return this.keyOfId(v, normalize);
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

  /** The key of a known ID: a resource that owns it wins; only an ID no resource owns can be a VPC default. */
  private keyOfId(v: string, normalize = true): Known<Key | null> {
    const address = this.snap.byId.get(v);
    if (address) return this.canonical(address);
    for (const vpc of this.ofType("aws_vpc")) for (const [a, kind] of VPC_DEFAULTS) if (vpc.values[a] === v) return normalize ? this.normalizeKey(`${kind}:${vpc.address}`) : known(`${kind}:${vpc.address}`);
    return known(null);
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
          // Egress rules matter only for paths that start inside the VPC: security groups
          // are stateful, so responses to inbound traffic are always allowed.
          if (isUnknown(r, ["type"])) {
            this.addSgRule(r, unknown(`${r.address}: type is unknown until apply`), false);
            this.addSgRule(r, unknown(`${r.address}: type is unknown until apply`), true);
            break;
          }
          const egress = r.values.type === "egress";
          const groups = this.ruleGroups(r, "source_security_group_id", r.values.self === true);
          const lists = isNull(r, "prefix_list_ids") || (!isUnknown(r, ["prefix_list_ids"]) && !arr(r.values.prefix_list_ids).length) ? NO_LISTS : this.listsOf(resolveRefs(this.snap, r, "prefix_list_ids", "aws_ec2_managed_prefix_list"));
          this.addSgRule(r, this.sgRuleOf(r, egress, r.values.protocol, r.values.from_port, r.values.to_port, arr(r.values.cidr_blocks).map(String), lists, groups, ["protocol", "from_port", "to_port", "cidr_blocks", "ipv6_cidr_blocks", "self"], arr(r.values.ipv6_cidr_blocks).map(String)), egress);
          break;
        }
        case "aws_vpc_security_group_ingress_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule
          const cidr = str(r.values.cidr_ipv4);
          const cidr6 = str(r.values.cidr_ipv6);
          this.addSgRule(r, this.sgRuleOf(r, false, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], this.ruleList(r), this.ruleGroups(r, "referenced_security_group_id", false), ["ip_protocol", "from_port", "to_port", "cidr_ipv4", "cidr_ipv6"], cidr6 ? [cidr6] : []), false);
          break;
        }
        case "aws_vpc_security_group_egress_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule
          const cidr = str(r.values.cidr_ipv4);
          this.addSgRule(r, this.sgRuleOf(r, true, r.values.ip_protocol, r.values.from_port, r.values.to_port, cidr ? [cidr] : [], this.ruleList(r), this.ruleGroups(r, "referenced_security_group_id", false), ["ip_protocol", "from_port", "to_port", "cidr_ipv4"]), true);
          break;
        }
        case "aws_route": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route
          const key = this.target(r, "route_table_id");
          const list = this.routeOf(r);
          if (!list.ok) this.routes.add(key, list, r.address);
          else for (const route of list.value) this.routes.add(key, known(route), r.address);
          break;
        }
        case "aws_network_acl_rule": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/network_acl_rule
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
          const table = t.ok && t.value ? this.canonical(t.value) : unknown<Key>(t.ok ? `${r.address}: route_table_id is outside this plan` : t.reason);
          this.mainAssoc.add(vpc, table, r.address);
          break;
        }
        case "aws_eip": {
          // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
          // The instance wins; a network interface alone is not modeled. After apply, an EIP on
          // an instance also shows the instance's network interface.
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
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/network_interface_sg_attachment
          // An attachment to an interface that is not an aws_network_interface in the plan
          // (an instance's own interface) still makes that instance unknown, through `touched`.
          const eni = this.refTo(r, "network_interface_id", "aws_network_interface");
          if (!eni.ok) break;
          const g = this.target(r, "security_group_id");
          this.eniGroups.add(known(eni.value), g.ok && g.value !== null ? known(g.value) : unknown(g.ok ? `${r.address}: security_group_id is outside this plan` : g.reason), r.address);
          break;
        }
        case "aws_vpc_endpoint": {
          // A gateway endpoint adds a route to the service's prefix list in each of its route tables.
          // https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html#route-tables-vpce
          if (isNull(r, "route_table_ids") || (!isUnknown(r, ["route_table_ids"]) && !arr(r.values.route_table_ids).length)) break;
          // An unknown type could be Gateway: then every table it lists is unknown too.
          if (isUnknown(r, ["vpc_endpoint_type"])) {
            this.gatewayEndpoints.add(unknown(`${r.address}: vpc_endpoint_type is unknown until apply, so it may add routes to its route tables`), known(r.address), r.address);
            break;
          }
          if (String(r.values.vpc_endpoint_type ?? "Gateway") !== "Gateway") break;
          const ids = arr(r.values.route_table_ids);
          if (!isUnknown(r, ["route_table_ids"]) && ids.every((v, i) => typeof v === "string" && !isUnknown(r, ["route_table_ids", i]))) {
            // Known IDs, including a VPC's default or main route table ID.
            for (const id of ids as string[]) {
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
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_endpoint_route_table_association
          const ep = this.refTo(r, "vpc_endpoint_id", "aws_vpc_endpoint");
          this.gatewayEndpoints.add(this.target(r, "route_table_id"), known(ep.ok ? ep.value : `the endpoint of ${r.address}`), r.address);
          break;
        }
        case "aws_ec2_managed_prefix_list_entry": {
          // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ec2_managed_prefix_list_entry
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
  private eniEip(r: Resource, attr: string): void {
    const eni = this.refTo(r, attr, "aws_network_interface");
    if (eni.ok) this.eniEips.add(known(eni.value), known(r.address), r.address);
    else this.eips.add(unknown(`${r.address} is associated with a network interface that is not an aws_network_interface in this plan (${eni.reason})`), known(r.address), r.address);
  }

  private addSgRule(r: Resource, item: Known<SgRule | null>, egress: boolean): void {
    const key = this.target(r, "security_group_id");
    if (item.ok && item.value === null) return; // No IPv4 address and no group: IPv6 only.
    (egress ? this.sgEgress : this.sgRules).add(key, item as Known<SgRule>, r.address);
  }

  /** Groups a rule resource references: `attr` (another group) and `self` (its own group). */
  private ruleGroups(r: Resource, attr: string, self: boolean): { keys: Key[]; unresolved?: string } {
    const keys: Key[] = [];
    const reasons: string[] = [];
    const take = (k: Known<Key | null>) => {
      if (!k.ok) reasons.push(k.reason);
      else if (k.value !== null) keys.push(k.value); // A known ID outside the plan: no member is in the plan.
    };
    if (self) take(this.target(r, "security_group_id"));
    take(this.target(r, attr));
    return { keys: [...new Set(keys)].toSorted(cmp), ...(reasons.length ? { unresolved: reasons.join("; ") } : {}) };
  }

  /**
   * A customer-managed prefix list in the plan, expanded to its IPv4 CIDRs: inline
   * `entry` blocks and aws_ec2_managed_prefix_list_entry resources. A list of the IPv6
   * family has no IPv4 addresses.
   * https://docs.aws.amazon.com/vpc/latest/userguide/managed-prefix-lists.html
   */
  private prefixList(address: string): Known<{ cidr: string; set: IntervalSet }[]> {
    const r = this.get(address);
    if (!r || r.type !== "aws_ec2_managed_prefix_list") return unknown(`${address} is not a prefix list in this plan`);
    if (isUnknown(r, ["address_family"])) return unknown(`${address}: address_family is unknown until apply`);
    if (String(r.values.address_family) === "IPv6") return known([]);
    if (isUnknown(r, ["entry"])) {
      if (r.configured.has("entry")) return unknown(`${address}: entry is unknown until apply`);
    } else if (arr(r.values.entry).some((_, i) => hasUnknown(r, ["entry", i, "cidr"]))) return unknown(`${address}: an entry is unknown until apply`);
    const cidrs = isUnknown(r, ["entry"]) ? [] : arr(r.values.entry).map((e) => (isObj(e) ? str(e.cidr) : undefined));
    const extra = this.plEntries.get(address);
    if (!extra.ok) return unknown(extra.reason);
    const out: { cidr: string; set: IntervalSet }[] = [];
    for (const c of [...cidrs, ...extra.value]) {
      const set = c ? cidrToSet(c) : undefined;
      if (!c || !set) return unknown(`${address} has an entry the engine cannot read`);
      out.push({ cidr: c, set });
    }
    return known(out.toSorted((a, b) => cmp(a.cidr, b.cidr)));
  }

  /** Prefix lists from references: expanded when in the plan, else a reason (AWS-managed lists cannot be expanded offline). */
  private listsOf(refs: Ref[]): Lists {
    const out: Lists = { set: [], entries: [], names: [] };
    const reasons: string[] = [];
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
  private ruleList(r: Resource): Lists {
    return isNull(r, "prefix_list_id") ? NO_LISTS : this.listsOf(resolveRefs(this.snap, r, "prefix_list_id", "aws_ec2_managed_prefix_list"));
  }

  /** Prefix list IDs inside a block (`ingress[0].prefix_list_ids`): known IDs only. */
  private blockLists(r: Resource, path: (string | number)[], ids: unknown): Lists {
    if (isUnknown(r, path)) return { ...NO_LISTS, unresolved: `${r.address}: ${path.join(".")} is unknown until apply` };
    const refs: Ref[] = arr(ids).map((id, j): Ref => {
      if (isUnknown(r, [...path, j]) || typeof id !== "string") return { kind: "unknown", reason: `${r.address}: a prefix list ID is unknown until apply` };
      const a = this.snap.byId.get(id);
      return a ? { kind: "resource", address: a } : { kind: "external", id };
    });
    return this.listsOf(refs);
  }

  private sgRuleOf(r: Resource, egress: boolean, protocolValue: unknown, from: unknown, to: unknown, cidrs: string[], lists: Lists, groups: { keys: Key[]; unresolved?: string }, fields: string[], cidrs6: string[] = []): Known<SgRule | null> {
    if (fields.some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    if (!cidrs.length && !cidrs6.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) return known(null);
    const protocol = normalizeProtocol(protocolValue);
    if (protocol === "other") return known(null); // ICMP and others never match TCP or UDP traffic.
    const ports = portSet(protocol, from, to);
    const sets = cidrs.map((c) => cidrToSet(c));
    const sets6 = cidrs6.map((c) => cidr6ToSet(c));
    if (!ports || sets.some((s) => !s) || sets6.some((s) => !s)) return unknown(`${r.address} has a value the engine cannot read`);
    return known(this.rule(r.address, egress, protocol, ports, (sets as IntervalSet[]).flat(), cidrs, groups, describePorts(protocol, from, to), lists, cidrs6));
  }

  private rule(address: string, egress: boolean, protocol: RuleProtocol, ports: IntervalSet, ranges: IntervalSet, cidrs: string[], groups: { keys: Key[]; unresolved?: string }, portText: string, lists: Lists = NO_LISTS, cidrs6: string[] = []): SgRule {
    const sources6 = fromRanges6(cidrs6.flatMap((c) => cidr6ToSet(c) ?? []));
    const peers = [...cidrs, ...cidrs6, ...lists.names.map((n) => `prefix list ${n}`), ...(lists.unresolved && !lists.names.length ? ["a prefix list that is unknown until apply"] : []), ...groups.keys.map(groupLabel), ...(groups.unresolved ? ["a security group that is unknown until apply"] : [])];
    return { protocol, ports, sources: fromRanges([...ranges, ...lists.set]), ...(sources6.length ? { sources6 } : {}), groups: groups.keys, ...(groups.unresolved ? { unresolved: groups.unresolved } : {}), ...(lists.unresolved ? { listUnresolved: lists.unresolved } : {}), resource: address, text: `${address} ${egress ? "egress" : "ingress"} ${portText} ${egress ? "to" : "from"} ${peers.join(", ")}` };
  }

  private naclRuleOf(r: Resource): Known<{ egress: boolean; rule: NaclRule }> {
    if (["egress", "rule_number", "protocol", "rule_action", "cidr_block", "ipv6_cidr_block", "from_port", "to_port"].some((f) => hasUnknown(r, [f]))) return unknown(`${r.address} has values that are unknown until apply`);
    const egress = r.values.egress === true;
    const key = egress ? "egress" : "ingress";
    const cidr6 = str(r.values.ipv6_cidr_block);
    const cidr = str(r.values.cidr_block) ?? cidr6;
    const protocol = normalizeProtocol(r.values.protocol);
    // ICMP and other protocols never match TCP or UDP traffic; their ports are not read.
    if (protocol === "other") return known({ egress, rule: { ruleNo: num(r.values.rule_number) ?? 0, allow: false, protocol, ports: [], cidr: [], text: `${r.address} (${String(r.values.protocol)})` } });
    const ports = portSet(protocol, r.values.from_port, r.values.to_port);
    const set6 = cidr6 ? cidr6ToSet(cidr6) : undefined;
    const set = cidr6 ? (set6 ? [] : undefined) : cidr ? cidrToSet(cidr) : undefined;
    const ruleNo = num(r.values.rule_number);
    if (!cidr || !ports || !set || ruleNo === undefined) return unknown(`${r.address} has a value the engine cannot read`);
    const allow = String(r.values.rule_action).toLowerCase() === "allow";
    return known({ egress, rule: { ruleNo, allow, protocol, ports, cidr: set, ...(set6 ? { cidr6: set6 } : {}), text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, r.values.from_port, r.values.to_port)} ${egress ? "to" : "from"} ${cidr}` } });
  }

  private gatewayTarget(r: Resource, gw: Known<string | null>, text: string): RouteTarget {
    if (!gw.ok) return { kind: "unknown", reason: gw.reason };
    if (gw.value === null) return { kind: "unknown", reason: `${text}: gateway is not in this plan` };
    const t = typeOf(gw.value);
    if (t === "aws_internet_gateway") return { kind: "igw", address: gw.value };
    // Older configurations put a NAT gateway ID in gateway_id.
    if (t === "aws_nat_gateway") return dropOf("nat_gateway_id") as RouteTarget;
    return { kind: "other", text: t.replace(/^aws_/, "").replaceAll("_", " ") };
  }

  /**
   * Routes for a prefix list destination: one per entry, each with its own length, so
   * longest prefix match works per entry. A list that cannot be expanded gives one route
   * with no CIDR and a reason. Static routes win ties over prefix list routes; the engine
   * reports a tie as unknown instead.
   * https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
   */
  private listRoutes(lists: Lists, target: RouteTarget, label: string): Route[] {
    const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
    const out: Route[] = lists.entries.map((e) => ({ cidr: e.set, prefix: cidrPrefixLength(e.cidr) ?? 0, target, text: `${label} ${e.cidr} (prefix list ${lists.names.join(", ")}) -> ${to}` }));
    if (lists.unresolved) out.push({ cidr: [], prefix: 0, target, text: `${label} prefix list ${lists.names.join(", ") || "(unknown)"} -> ${to}`, listUnresolved: lists.unresolved });
    return out;
  }

  private routeOf(r: Resource): Known<Route[]> {
    if (hasUnknown(r, ["destination_cidr_block"])) return unknown(`${r.address}: destination is unknown until apply`);
    const cidr = str(r.values.destination_cidr_block);
    const listed = !cidr && (str(r.values.destination_prefix_list_id) || (isUnknown(r, ["destination_prefix_list_id"]) && r.configured.has("destination_prefix_list_id")));
    const c6 = str(r.values.destination_ipv6_cidr_block);
    if (!cidr && !listed && !c6) {
      if (isUnknown(r, ["destination_ipv6_cidr_block"]) && r.configured.has("destination_ipv6_cidr_block")) return unknown(`${r.address}: the IPv6 destination is unknown until apply`);
      return known([]);
    }
    const set = cidr ? cidrToSet(cidr) : [];
    const prefix = cidr ? cidrPrefixLength(cidr) : 0;
    if (!set || prefix === undefined) return unknown(`${r.address}: destination ${cidr ?? ""} cannot be read`);
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
      target = other ? (dropOf(other) ?? { kind: "other", text: other.replace(/_id$|_arn$/, "").replaceAll("_", " ") }) : { kind: "unknown", reason: `${r.address} has no target the engine can read` };
      if (other === "vpc_peering_connection_id" && target.kind === "drop") {
        const id = r.values.vpc_peering_connection_id;
        target = { ...target, peering: !isUnknown(r, ["vpc_peering_connection_id"]) && typeof id === "string" ? this.peeringById(r, id) : this.refTo(r, "vpc_peering_connection_id", "aws_vpc_peering_connection") };
      }
      if (other === "transit_gateway_id" && target.kind === "other") {
        const id = r.values.transit_gateway_id;
        target = { ...target, tgw: !isUnknown(r, ["transit_gateway_id"]) && typeof id === "string" ? this.tgwById(r, id) : this.refTo(r, "transit_gateway_id", "aws_ec2_transit_gateway") };
      }
    }
    // A route whose target was deleted keeps its entry with state "blackhole".
    // https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
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

  vpc(address: string): Known<Vpc> {
    const r = this.get(address);
    if (!r || r.type !== "aws_vpc") return unknown(`${address} is not an aws_vpc in this plan`);
    const cidr = str(r.values.cidr_block);
    const set = cidr ? cidrToSet(cidr) : undefined;
    const extra = this.ofType("aws_vpc_ipv4_cidr_block_association").filter((a) => {
      const v = this.refTo(a, "vpc_id", "aws_vpc");
      return !v.ok || v.value === address;
    });
    // Secondary blocks join the VPC range. An IPAM-allocated block has no CIDR before apply.
    // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
    const blocks: string[] = cidr ? [cidr] : [];
    let cidrs: Known<IntervalSet> = isUnknown(r, ["cidr_block"]) || !set ? unknown(`${address}: cidr_block is unknown`) : known(set);
    for (const a of extra) {
      const c = str(a.values.cidr_block);
      const s2 = c && !isUnknown(a, ["cidr_block"]) ? cidrToSet(c) : undefined;
      if (!c || !s2) {
        cidrs = unknown(`${a.address}: cidr_block is unknown until apply (an IPAM pool or a computed value), so the VPC range is not known`);
        break;
      }
      blocks.push(c);
      if (cidrs.ok) cidrs = known(fromRanges([...cidrs.value, ...s2]));
    }

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
    return known({ address, cidrs, ...(blocks.length && cidrs.ok ? { blocks } : {}), igw, peerings: this.peeringsOf(address), ipv6: this.vpcIpv6(r), via: [...this.igwAttach.sources(address), ...extra.map((a) => a.address)].toSorted(cmp) });
  }

  /**
   * A VPC's IPv6 block: `ipv6_cidr_block`, an Amazon-provided block
   * (`assign_generated_ipv6_cidr_block`), or an IPAM pool. The provided block is known only
   * after apply.
   * https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
   */
  private vpcIpv6(r: Resource): Known<{ cidrs?: Set6 } | undefined> {
    if (this.ofType("aws_vpc_ipv6_cidr_block_association").length) return unknown(`${r.address} may have IPv6 blocks from aws_vpc_ipv6_cidr_block_association, which is not modeled yet`);
    const cidr = str(r.values.ipv6_cidr_block);
    if (!isUnknown(r, ["ipv6_cidr_block"]) && cidr) {
      const set = cidr6ToSet(cidr);
      return set ? known({ cidrs: set }) : unknown(`${r.address}: ipv6_cidr_block ${cidr} cannot be read`);
    }
    for (const k of ["assign_generated_ipv6_cidr_block", "ipv6_ipam_pool_id"]) {
      if (isUnknown(r, [k]) && r.configured.has(k)) return unknown(`${r.address}: ${k} is unknown until apply`);
    }
    if (r.values.assign_generated_ipv6_cidr_block === true || !isNull(r, "ipv6_ipam_pool_id") || (isUnknown(r, ["ipv6_cidr_block"]) && r.configured.has("ipv6_cidr_block"))) return known({});
    return known(undefined);
  }

  /** A security group by key, with inline rules and rule resources merged. */
  private securityGroup(key: Key): SecurityGroup {
    return { ...this.securityGroupOf(key), via: [...new Set([...this.sgRules.sources(key), ...this.sgEgress.sources(key)])].toSorted(cmp) };
  }

  private securityGroupOf(key: Key): SecurityGroup {
    const extraIn = this.sgRules.get(key);
    const extraOut = this.sgEgress.get(key);
    if (key.startsWith("default-sg:")) {
      const address = groupLabel(key);
      const managed = this.managedDefault(key, "aws_default_security_group");
      if (!managed.ok) return { address, key, ingress: unknown(managed.reason), egress: unknown(managed.reason) };
      if (!managed.value) {
        // The default security group allows inbound traffic only from itself, and all
        // outbound traffic. The engine assumes it was not changed outside Terraform.
        // https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
        const fromItself = this.rule(address, false, "all", ALL_PORTS, [], [], { keys: [key] }, "all traffic");
        const toAll = this.rule(address, true, "all", ALL_PORTS, ALL_IPV4, ["0.0.0.0/0"], { keys: [] }, "all traffic");
        const def = (r: SgRule): SgRule => ({ ...r, text: `${r.text} (AWS default)` });
        return { address, key, ingress: extraIn.ok ? known([def(fromItself), ...extraIn.value]) : extraIn, egress: extraOut.ok ? known([def(toAll), ...extraOut.value]) : extraOut };
      }
      // Terraform removes every rule of the default group when it adopts it, then adds
      // the configured ones.
      // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/default_security_group
      return this.inlineSg(managed.value, key, extraIn, extraOut);
    }
    const r = this.get(key);
    if (!r) return { address: key, key, ingress: unknown(`${key} is not in this plan`), egress: unknown(`${key} is not in this plan`) };
    return this.inlineSg(r, key, extraIn, extraOut);
  }

  private inlineSg(r: Resource, key: Key, extraIn: Known<SgRule[]>, extraOut: Known<SgRule[]>): SecurityGroup {
    return { address: r.address, key, ingress: this.inlineRules(r, "ingress", key, extraIn), egress: this.inlineRules(r, "egress", key, extraOut) };
  }

  /**
   * Inline `ingress` or `egress` blocks merged with rule resources. A group created by
   * Terraform with no `egress` has no outbound rules: Terraform removes the AWS default.
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group
   */
  private inlineRules(r: Resource, dir: "ingress" | "egress", key: Key, extra: Known<SgRule[]>): Known<SgRule[]> {
    const address = r.address;
    if (!extra.ok) return extra;
    if (isUnknown(r, [dir])) {
      // A security group with rule resources and no inline rules has a computed block list.
      if (!r.configured.has(dir)) return extra;
      return unknown(`${address}: ${dir} is unknown until apply`);
    }
    const blocks = arr(r.values[dir]);
    const rules: SgRule[] = [];
    for (const [i, raw] of blocks.entries()) {
      if (!isObj(raw)) continue;
      // Unknown group IDs are resolved below; any other unknown value makes the list unknown.
      if (["protocol", "from_port", "to_port", "cidr_blocks", "ipv6_cidr_blocks", "self"].some((f) => hasUnknown(r, [dir, i, f]))) return unknown(`${address}: ${dir} rule ${i} has values that are unknown until apply`);
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue; // ICMP and others never match TCP or UDP traffic.
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      const cidrs = arr(raw.cidr_blocks).map(String);
      const lists = arr(raw.prefix_list_ids).length || isUnknown(r, [dir, i, "prefix_list_ids"]) ? this.blockLists(r, [dir, i, "prefix_list_ids"], raw.prefix_list_ids) : NO_LISTS;
      const cidrs6 = arr(raw.ipv6_cidr_blocks).map(String);
      const sets = cidrs.map((c) => cidrToSet(c));
      if (!ports || sets.some((s) => !s) || cidrs6.some((c) => !cidr6ToSet(c))) return unknown(`${address}: ${dir} rule ${i} has a value the engine cannot read`);
      const groups = this.inlineGroups(r, dir, i, blocks, key);
      if (!cidrs.length && !cidrs6.length && !lists.names.length && !lists.unresolved && !groups.keys.length && !groups.unresolved) continue;
      rules.push(this.rule(address, dir === "egress", protocol, ports, (sets as IntervalSet[]).flat(), cidrs, groups, describePorts(protocol, raw.from_port, raw.to_port), lists, cidrs6));
    }
    return known([...rules, ...extra.value]);
  }

  /**
   * Groups an inline block references: `self`, and `security_groups` by ID. IDs that are
   * unknown until apply come from the configuration, which merges the references of all
   * blocks; they are matched only when this is the one block that lists groups.
   */
  private inlineGroups(r: Resource, dir: string, i: number, blocks: unknown[], own: Key): { keys: Key[]; unresolved?: string } {
    const raw = blocks[i] as Obj;
    const keys: Key[] = raw.self === true ? [own] : [];
    const reasons: string[] = [];
    const listUnknown = isUnknown(r, [dir, i, "security_groups"]);
    const known_: Key[] = [];
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
      const found = withGroups === 1 && !r.otherRefs.has(dir) ? this.configGroups(r, dir) : undefined;
      // Each unknown element must match one group the configuration names and the known
      // IDs do not already cover. When the whole list is unknown, its length is unknown too.
      const extra = found?.filter((k) => !known_.includes(k));
      if (!extra || (!listUnknown && extra.length !== pending) || (listUnknown && !extra.length)) reasons.push(fail);
      else keys.push(...extra);
    }
    return { keys: [...new Set(keys)].toSorted(cmp), ...(reasons.length ? { unresolved: reasons.join("; ") } : {}) };
  }

  /**
   * Security groups that the configuration of `attr` names: group resources, managed
   * default groups, and `aws_vpc.<name>.default_security_group_id`. Undefined when a
   * reference is something else, except a subnet or VPC CIDR used by `cidr_blocks`.
   */
  private configGroups(r: Resource, attr: string): Key[] | undefined {
    const out = new Set<Key>();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) return undefined;
      const base = instanceOf(this.snap, m[1] as string);
      if (!base) return undefined;
      const type = typeOf(base);
      const part = m[2];
      if ((type === "aws_security_group" || type === "aws_default_security_group") && (part === undefined || part === "id")) {
        const k = this.canonical(base);
        if (!k.ok) return undefined;
        out.add(k.value);
      } else if (type === "aws_vpc" && part === "default_security_group_id") out.add(`default-sg:${base}`);
      else if (type === "aws_vpc" && part === undefined) continue; // The bare reference that comes with `aws_vpc.x.attr`.
      else if ((type === "aws_subnet" || type === "aws_vpc") && part === "cidr_block") continue;
      else if (part === undefined && fullRefsHasAttr(r.fullRefs[attr] ?? [], ref)) continue;
      else return undefined;
    }
    return [...out].toSorted(cmp);
  }

  private inlineNaclRules(r: Resource, key: "ingress" | "egress"): Known<NaclRule[]> {
    if (isUnknown(r, [key])) return r.configured.has(key) ? unknown(`${r.address}: ${key} is unknown until apply`) : known([]);
    const rules: NaclRule[] = [];
    for (const [i, raw] of arr(r.values[key]).entries()) {
      if (!isObj(raw)) continue;
      if (hasUnknown(r, [key, i])) return unknown(`${r.address}: ${key} rule ${i} has values that are unknown until apply`);
      const protocol = normalizeProtocol(raw.protocol);
      if (protocol === "other") continue; // ICMP and others never match TCP or UDP traffic.
      const ports = portSet(protocol, raw.from_port, raw.to_port);
      // An IPv6 entry (`ipv6_cidr_block`) has an empty IPv4 set, so it never matches IPv4 traffic.
      const cidr6 = str(raw.ipv6_cidr_block);
      const set6 = cidr6 ? cidr6ToSet(cidr6) : undefined;
      const cidr = cidr6 ?? str(raw.cidr_block);
      const set = cidr6 ? (set6 ? [] : undefined) : cidr ? cidrToSet(cidr) : undefined;
      const ruleNo = num(raw.rule_no);
      if (!ports || !set || ruleNo === undefined) return unknown(`${r.address}: ${key} rule ${i} has a value the engine cannot read`);
      const allow = String(raw.action).toLowerCase() === "allow";
      rules.push({ ruleNo, allow, protocol, ports, cidr: set, ...(set6 ? { cidr6: set6 } : {}), text: `${r.address} ${key} rule ${ruleNo}: ${allow ? "allow" : "deny"} ${describePorts(protocol, raw.from_port, raw.to_port)} ${key === "ingress" ? "from" : "to"} ${cidr}` });
    }
    return known(rules);
  }

  /** A NACL by key, with the rule resources that shaped it. */
  private nacl(key: Key): Nacl {
    return { ...this.naclOf(key), via: this.naclRules.sources(key) };
  }

  /** A NACL by key: inline rules (or the AWS default) merged with aws_network_acl_rule resources. */
  private naclOf(key: Key): Nacl {
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
        // With an IPv6 block, the default NACL also allows all IPv6 traffic (rule 101).
        const v = this.vpc(vpc);
        const ipv6 = v.ok && v.value.ipv6?.ok ? v.value.ipv6.value !== undefined : false;
        const all = (dir: string): NaclRule[] => [
          { ruleNo: 100, allow: true, protocol: "all", ports: ALL_PORTS, cidr: ALL_IPV4, text: `default NACL of ${vpc} ${dir} rule 100: allow all traffic (AWS default)` },
          ...(ipv6 ? [{ ruleNo: 101, allow: true, protocol: "all" as const, ports: ALL_PORTS, cidr: [], cidr6: IPV6_ALL, text: `default NACL of ${vpc} ${dir} rule 101: allow all IPv6 traffic (AWS default)` }] : []),
        ];
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
    const nacl = this.nacl([...claims][0] ?? `default-nacl:${vpc}`);
    return known({ ...nacl, via: [...(nacl.via ?? []), ...this.naclAssoc.sources(subnet)] });
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
      if (str(raw[key]) || isUnknown(r, [...path, key])) {
        const d = dropOf(key);
        if (d?.kind === "drop" && key === "vpc_peering_connection_id") return { ...d, peering: this.inlinePeering(r, raw, path) };
        if (key === "transit_gateway_id") {
          const id = raw.transit_gateway_id;
          const refs = r.otherRefs.has("route") ? [] : fromConfig(this.snap, r, "route", "aws_ec2_transit_gateway");
          const tgw = !isUnknown(r, [...path, "transit_gateway_id"]) && typeof id === "string" ? this.tgwById(r, id) : refs.length === 1 && refs[0]?.kind === "resource" ? known(refs[0].address) : unknown<string>(`${r.address}: the transit gateway of a route is unknown until apply`);
          return { kind: "other", text: "transit gateway", tgw };
        }
        return d ?? { kind: "other", text: key.replace(/_id$|_arn$/, "").replaceAll("_", " ") };
      }
    }
    return { kind: "unknown", reason: `${r.address}: route has no target the engine can read` };
  }

  /** The peering connection of an inline route: by known ID, else the one the `route` blocks reference. */
  private inlinePeering(r: Resource, raw: Obj, path: (string | number)[]): Known<string> {
    const id = raw.vpc_peering_connection_id;
    if (!isUnknown(r, [...path, "vpc_peering_connection_id"]) && typeof id === "string") return this.peeringById(r, id);
    const refs = r.otherRefs.has("route") ? [] : fromConfig(this.snap, r, "route", "aws_vpc_peering_connection");
    return refs.length === 1 && refs[0]?.kind === "resource" ? known(refs[0].address) : unknown(`${r.address}: the peering connection of a route is unknown until apply`);
  }

  /** The aws_vpc_peering_connection with this ID. Its accepter resource has the same ID, so `byId` may name the accepter. */
  private peeringById(r: Resource, id: string): Known<string> {
    const found = this.ofType("aws_vpc_peering_connection").filter((p) => p.values.id === id && !isUnknown(p, ["id"]));
    return found.length === 1 ? known((found[0] as Resource).address) : unknown(`${r.address}: peering connection ${id} is not in this plan`);
  }

  /**
   * Peering connections of a VPC. A connection carries traffic once active: the accepter
   * accepts it (`auto_accept`, or aws_vpc_peering_connection_accepter), or its state shows
   * `active`.
   * https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html
   */
  private peeringsOf(vpc: string): Known<Peering[]> {
    const out: Peering[] = [];
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

  private peeringActive(p: Resource): Known<string> {
    // auto_accept works only in one account and Region; across them an accepter must accept.
    // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_peering_connection
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
  private tgwById(r: Resource, id: string): Known<string> {
    const found = this.ofType("aws_ec2_transit_gateway").filter((g) => g.values.id === id && !isUnknown(g, ["id"]));
    return found.length === 1 ? known((found[0] as Resource).address) : unknown(`${r.address}: transit gateway ${id} is not in this plan`);
  }

  /**
   * An `enable`/`disable` option. A value the provider computes (unknown and not in the
   * configuration) is AWS's default.
   */
  private option(r: Resource, attr: string, dflt: boolean): Known<boolean> {
    if (isUnknown(r, [attr])) return r.configured.has(attr) ? unknown(`${r.address}: ${attr} is unknown until apply`) : known(dflt);
    const v = r.values[attr];
    if (v === null || v === undefined || v === "") return known(dflt);
    if (v === "enable" || v === true) return known(true);
    if (v === "disable" || v === false) return known(false);
    return unknown(`${r.address}: ${attr} = ${String(v)} cannot be read`);
  }

  /** The key of a transit gateway route table: its address, or `tgw-default-rt:<gateway>`. */
  private tgwTableKey(r: Resource, attr: string): Known<string> {
    const v = r.values[attr];
    const gateways = this.ofType("aws_ec2_transit_gateway");
    if (!isUnknown(r, [attr]) && typeof v === "string" && v) {
      const a = this.snap.byId.get(v);
      if (a && typeOf(a) === "aws_ec2_transit_gateway_route_table") return known(a);
      const g = gateways.find((x) => TGW_DEFAULTS.some((k) => !isUnknown(x, [k]) && x.values[k] === v));
      return g ? known(`tgw-default-rt:${g.address}`) : unknown(`${r.address}: transit gateway route table ${v} is not in this plan`);
    }
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: ${attr} uses values that are unknown until apply`);
    const bases = new Map<string, string | undefined>();
    for (const ref of r.fullRefs[attr] ?? []) {
      const m = /^(.*?aws_\w+\.[\w-]+(?:\[[^\]]+\])?)(?:\.(\w+))?$/.exec(localize(r.address, ref));
      if (!m) continue;
      const base = m[1] as string;
      if (m[2] || !bases.has(base)) bases.set(base, m[2] ?? bases.get(base));
    }
    const [entry] = [...bases.entries()];
    const address = bases.size === 1 && entry ? instanceOf(this.snap, entry[0]) : undefined;
    if (address && typeOf(address) === "aws_ec2_transit_gateway_route_table") return known(address);
    if (address && typeOf(address) === "aws_ec2_transit_gateway" && entry && TGW_DEFAULTS.includes(entry[1] ?? "")) return known(`tgw-default-rt:${address}`);
    return unknown(`${r.address}: ${attr} is unknown until apply and cannot be matched to one transit gateway route table`);
  }

  private transitCache: Known<Transit> | undefined;

  /** Transit gateways in the plan, built once. */
  private transit(): Known<Transit> {
    this.transitCache ??= this.buildTransit();
    return this.transitCache;
  }

  /**
   * Transit gateways, their VPC attachments, associations, and route tables.
   * Rules and sources: docs/semantics/transit-gateway.md.
   * https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html
   */
  private buildTransit(): Known<Transit> {
    for (const type of UNMODELED_TGW) {
      const r = this.ofType(type)[0];
      if (r) return unknown(`${r.address} (${type}) changes transit gateway routing, and ${type} is not modeled yet`);
    }
    const gateways = new Map<string, { sgRefs: Known<boolean>; assoc: Known<boolean>; prop: Known<boolean> }>();
    for (const g of this.ofType("aws_ec2_transit_gateway").toSorted((a, b) => cmp(a.address, b.address))) {
      // Defaults: association and propagation `enable`, security group referencing `disable`.
      // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ec2_transit_gateway
      gateways.set(g.address, { sgRefs: this.option(g, "security_group_referencing_support", false), assoc: this.option(g, "default_route_table_association", true), prop: this.option(g, "default_route_table_propagation", true) });
    }
    // "if either route propagation or route table association is enabled, AWS then creates a
    // default route table". The provider then associates (and propagates) each attachment
    // whose transit_gateway_default_route_table_* flag is true, whatever the gateway's own
    // default_route_table_* option says, and removes the association when the flag is false.
    // https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html
    // https://github.com/hashicorp/terraform-provider-aws/blob/v6.72.0/internal/service/ec2/transitgateway_vpc_attachment.go
    const hasDefault = (gw: { assoc: Known<boolean>; prop: Known<boolean> }): Known<boolean> => {
      if (gw.assoc.ok && gw.assoc.value) return known(true);
      if (gw.prop.ok && gw.prop.value) return known(true);
      if (!gw.assoc.ok) return gw.assoc;
      if (!gw.prop.ok) return gw.prop;
      return known(false);
    };
    const names = new Map<string, string>();
    for (const g of gateways.keys()) names.set(`tgw-default-rt:${g}`, `default route table of ${g}`);
    for (const t of this.ofType("aws_ec2_transit_gateway_route_table")) names.set(t.address, t.address);

    const attachRef = (r: Resource): Known<string> => {
      const v = r.values.transit_gateway_attachment_id;
      if (!isUnknown(r, ["transit_gateway_attachment_id"]) && typeof v === "string") {
        const a = this.snap.byId.get(v);
        return a && typeOf(a) === "aws_ec2_transit_gateway_vpc_attachment" ? known(a) : unknown(`${r.address}: attachment ${v} is not a VPC attachment in this plan`);
      }
      return this.refTo(r, "transit_gateway_attachment_id", "aws_ec2_transit_gateway_vpc_attachment");
    };

    // Explicit associations and propagations.
    const assocOf = new Map<string, { table: string; replace: boolean; address: string }[]>();
    const propsOf = new Map<string, string[]>();
    for (const r of this.ofType("aws_ec2_transit_gateway_route_table_association")) {
      const att = attachRef(r);
      const table = this.tgwTableKey(r, "transit_gateway_route_table_id");
      if (!att.ok) return unknown(att.reason);
      if (!table.ok) return unknown(table.reason);
      assocOf.set(att.value, [...(assocOf.get(att.value) ?? []), { table: table.value, replace: r.values.replace_existing_association === true, address: r.address }]);
    }
    for (const r of this.ofType("aws_ec2_transit_gateway_route_table_propagation")) {
      const att = attachRef(r);
      const table = this.tgwTableKey(r, "transit_gateway_route_table_id");
      if (!att.ok) return unknown(att.reason);
      if (!table.ok) return unknown(table.reason);
      propsOf.set(table.value, [...(propsOf.get(table.value) ?? []), att.value]);
    }

    const attachments: TgwAttachment[] = [];
    for (const a of this.ofType("aws_ec2_transit_gateway_vpc_attachment").toSorted((x, y) => cmp(x.address, y.address))) {
      const tgw = this.refTo(a, "transit_gateway_id", "aws_ec2_transit_gateway");
      if (!tgw.ok) return unknown(tgw.reason);
      const vpcRef = this.refTo(a, "vpc_id", "aws_vpc");
      if (!vpcRef.ok) return unknown(vpcRef.reason);
      const gw = gateways.get(tgw.value) as { sgRefs: Known<boolean>; assoc: Known<boolean>; prop: Known<boolean> };
      const vpc = this.vpc(vpcRef.value);
      let subnets: Known<TgwSubnet[]>;
      if (!vpc.ok) subnets = unknown(vpc.reason);
      else {
        const list: TgwSubnet[] = [];
        let why: string | undefined;
        for (const ref of resolveRefs(this.snap, a, "subnet_ids", "aws_subnet")) {
          const s = ref.kind === "resource" ? this.get(ref.address) : undefined;
          if (!s) {
            why = ref.kind === "unknown" ? ref.reason : `${a.address}: subnet ${ref.kind === "external" ? ref.id : ""} is not in this plan`;
            break;
          }
          list.push({ address: s.address, az: azOf(s), table: this.subnetRouteTable(s.address, vpc.value) });
        }
        subnets = why ? unknown(why) : known(list.toSorted((x, y) => cmp(x.address, y.address)));
      }
      // One associated route table: an explicit association, else the default one.
      const explicit = assocOf.get(a.address) ?? [];
      const table = hasDefault(gw);
      const byDefault = !table.ok ? table : table.value ? this.option(a, "transit_gateway_default_route_table_association", true) : known(false);
      let association: Known<string | null>;
      if (explicit.length > 1) association = unknown(`${a.address} has ${explicit.length} route table associations`);
      else if (explicit[0] && (explicit[0].replace || (byDefault.ok && !byDefault.value))) association = known(explicit[0].table);
      else if (explicit[0]) association = unknown(byDefault.ok ? `${a.address} has the default association and ${explicit[0].address} without replace_existing_association` : byDefault.reason);
      else association = byDefault.ok ? known(byDefault.value ? `tgw-default-rt:${tgw.value}` : null) : unknown(byDefault.reason);
      attachments.push({ address: a.address, tgw: tgw.value, vpc: vpcRef.value, subnets, association, sgRefs: this.option(a, "security_group_referencing_support", true) });
    }

    // Default propagation into the default route table.
    for (const att of attachments) {
      const gw = gateways.get(att.tgw);
      const r = this.get(att.address) as Resource;
      const has = gw ? hasDefault(gw) : known(false);
      const prop = !has.ok ? has : !has.value ? known(false) : this.option(r, "transit_gateway_default_route_table_propagation", true);
      const key = `tgw-default-rt:${att.tgw}`;
      if (prop && !prop.ok) propsOf.set(key, [...(propsOf.get(key) ?? []), `unknown:${prop.reason}`]);
      else if (prop?.value) propsOf.set(key, [...(propsOf.get(key) ?? []), att.address]);
    }

    const routes = new Map<string, Known<TgwRoute[]>>();
    const add = (key: string, item: Known<TgwRoute>) => {
      const cur = routes.get(key) ?? known<TgwRoute[]>([]);
      if (!cur.ok) return;
      routes.set(key, item.ok ? known([...cur.value, item.value]) : unknown(item.reason));
    };
    for (const key of names.keys()) routes.set(key, known([]));
    // Static routes. https://docs.aws.amazon.com/vpc/latest/tgw/tgw-route-tables.html
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
      if (!set || prefix === undefined) continue; // An IPv6 destination never matches an IPv4 subnet.
      if (!isUnknown(r, ["blackhole"]) && r.values.blackhole === true) {
        add(key.value, known({ cidr: set, prefix, static: true, target: { kind: "blackhole" }, text: `${r.address} ${cidr} -> blackhole (in ${name})` }));
        continue;
      }
      const att = attachRef(r);
      add(key.value, known({ cidr: set, prefix, static: true, target: att.ok ? { kind: "attachment", address: att.value } : { kind: "unknown", reason: att.reason }, text: `${r.address} ${cidr} -> ${att.ok ? att.value : "an attachment outside the plan"} (in ${name})` }));
    }
    // Propagated routes: the VPC's CIDR blocks.
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
          if (set && prefix !== undefined) add(key, known({ cidr: set, prefix, static: false, target: { kind: "attachment", address: att }, from: att, text: `${name} ${b} propagated from ${att}` }));
        }
      }
    }
    return known({ gateways: new Map([...gateways].map(([k, v]) => [k, { sgRefs: v.sgRefs }])), attachments, routes, names });
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
        const pl = isUnknown(r, ["route", i, "destination_prefix_list_id"]) || str(raw.destination_prefix_list_id);
        if (pl) routes.push(...this.listRoutes(this.blockLists(r, ["route", i, "destination_prefix_list_id"], [raw.destination_prefix_list_id]), this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways), `${r.address} route`));
        const c6 = str(raw.ipv6_cidr_block);
        if (c6 || isUnknown(r, ["route", i, "ipv6_cidr_block"])) {
          const set6 = c6 ? cidr6ToSet(c6) : undefined;
          if (!set6 || !c6) return unknown(`${r.address}: route ${i} has an IPv6 destination the engine cannot read`);
          const target = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
          const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
          routes.push({ cidr: [], cidr6: set6, prefix: prefixLength6(c6) ?? 0, target, text: `${r.address} route ${c6} -> ${to}` });
        }
        continue;
      }
      const set = cidrToSet(cidr);
      const prefix = cidrPrefixLength(cidr);
      if (!set || prefix === undefined) return unknown(`${r.address}: route ${i} has destination ${cidr}, which the engine cannot read`);
      const target = this.routeTarget(r, raw, ["route", i], unknownGateways, knownGateways);
      const to = target.kind === "igw" ? target.address : target.kind === "other" || target.kind === "drop" ? target.text : target.kind;
      routes.push({ cidr: set, prefix, target, text: `${r.address} route ${cidr} -> ${to}` });
    }
    return known(routes);
  }

  /** A route table by key, with the route and main-association resources that shaped it. */
  private routeTable(key: Key, vpc: Vpc, isMain: boolean): RouteTable {
    return { ...this.routeTableOf(key, vpc, isMain), via: [...this.routes.sources(key), ...this.gatewayEndpoints.sources(key), ...(isMain ? this.mainAssoc.sources(vpc.address) : [])] };
  }

  /** A route table by key: local routes, inline routes, and aws_route resources. */
  private routeTableOf(key: Key, vpc: Vpc, isMain: boolean): RouteTable {
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
    // Gateway endpoints: a route to the service's AWS-managed prefix list, which cannot be expanded offline.
    const gw = this.gatewayEndpoints.get(key);
    if (!gw.ok) return { resource, routes: unknown(gw.reason) };
    const endpointRoutes: Route[] = [...new Set(gw.value)].toSorted(cmp).map((e) => ({ cidr: [], prefix: 0, target: { kind: "other", text: "vpc endpoint" }, text: `${resource} route to the prefix list of gateway endpoint ${e} -> vpc endpoint`, listUnresolved: `the service prefix list of ${e} is managed by AWS and cannot be expanded offline`, awsService: true }));
    const local6: Route[] = vpc.ipv6?.ok && vpc.ipv6.value?.cidrs ? vpc.ipv6.value.cidrs.map((r) => ({ cidr: [], cidr6: [r], prefix: 128 - (r[1] - r[0] + 1n).toString(2).length + 1, target: { kind: "local" }, text: `${resource} local route (IPv6)` })) : [];
    return { resource, routes: known([...localRoutes(vpc, resource, vpc.cidrs.value), ...local6, ...base.value, ...extra.value.filter((x) => x.cidr.length || x.cidr6 || x.listUnresolved), ...endpointRoutes]) };
  }

  /**
   * The route table of a subnet: an explicit association, else the VPC's main route table.
   * https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html
   */
  subnetRouteTable(subnet: string, vpc: Vpc): Known<RouteTable> {
    const assoc = new Set<Key>();
    const assocVia: string[] = [];
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
      return known({ ...table, via: [...(table.via ?? []), ...assocVia] });
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
  endpoints(): Endpoint[] {
    return [
      ...this.ofType("aws_instance").map((r) => this.instance(r)),
      ...this.ofType("aws_db_instance").flatMap((r) => this.dbInstance(r)),
      ...this.ofType("aws_lb").flatMap((r) => this.loadBalancer(r)),
      ...this.ofType("aws_rds_cluster_instance").flatMap((r) => this.auroraInstance(r)),
      ...this.ofType("aws_ecs_service").flatMap((r) => this.ecsService(r)),
      ...this.ofType("aws_elb").flatMap((r) => this.classicLoadBalancer(r)),
      ...this.ofType("aws_vpc_endpoint").flatMap((r) => this.interfaceEndpoint(r)),
    ];
  }

  private fail(r: Resource, reason: string): Endpoint {
    return { address: r.address, type: r.type, vpc: unknown(reason), subnet: unknown(reason), subnetCidr: unknown(reason), publicIp: unknown(reason), securityGroups: unknown(reason), nacl: unknown(reason), routeTable: unknown(reason) };
  }

  /** An endpoint for `r` placed in `subnet`. */
  private place(r: Resource, subnet: string, publicIp: (s: Resource) => Known<string | undefined>, groups: (vpc: string) => Known<SecurityGroup[]>, placement?: string, via: string[] = [], publicIp6: (s: Resource) => Known<string | undefined> = () => known(undefined)): Endpoint {
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
      ...(placement ? { placement } : {}),
      via,
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
    return this.groupsOf(r, resolveRefs(this.snap, r, attr, ["aws_security_group", "aws_default_security_group"]), vpc);
  }

  /** Security groups from resolved references; a known ID outside the plan is unknown, except the VPC's default group. */
  private groupsOf(r: Resource, refs: Ref[], vpc: string): Known<SecurityGroup[]> {
    const keys: Key[] = [];
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

  private instance(r: Resource): Endpoint {
    const touched = this.touched(r.address, UNMODELED_INSTANCE);
    if (touched) return this.fail(r, touched);
    const nics = arr(r.values.network_interface);
    if (nics.length) return this.instanceWithInterface(r, nics);
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
    // IPv6 addresses in AWS are global unicast, so an instance with one can be addressed
    // from the internet: ipv6_address_count, ipv6_addresses, or the subnet's
    // assign_ipv6_address_on_creation.
    // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html
    const publicIp6 = (s: Resource): Known<string | undefined> => {
      const count = r.values.ipv6_address_count;
      if (isUnknown(r, ["ipv6_address_count"]) && r.configured.has("ipv6_address_count")) return unknown(`${r.address}: ipv6_address_count is unknown until apply`);
      if (isUnknown(r, ["ipv6_addresses"]) && r.configured.has("ipv6_addresses")) return unknown(`${r.address}: ipv6_addresses is unknown until apply`);
      if (typeof count === "number" && count > 0) return known(`${r.address} ipv6_address_count = ${count}`);
      if (arr(r.values.ipv6_addresses).length) return known(`${r.address} has ipv6_addresses`);
      if (isUnknown(s, ["assign_ipv6_address_on_creation"]) && s.configured.has("assign_ipv6_address_on_creation")) return unknown(`${s.address}: assign_ipv6_address_on_creation is unknown until apply`);
      if (s.values.assign_ipv6_address_on_creation === true) return known(`${s.address} assign_ipv6_address_on_creation = true`);
      return known(undefined);
    };
    return this.place(r, subnet.value, publicIp, (vpc) => {
      const g = this.groups(r, "vpc_security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    }, undefined, this.eips.sources(r.address), publicIp6);
  }

  /**
   * An instance launched with an existing network interface (a `network_interface` block).
   * The interface decides the subnet and the security groups; "The public IP address can
   * only be assigned to a network interface for eth0, and can only be assigned to a new
   * network interface, not an existing one", so a public IPv4 address comes only from an
   * Elastic IP on the interface. Only the primary interface (device index 0) is modeled.
   * https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_InstanceNetworkInterfaceSpecification.html
   */
  private instanceWithInterface(r: Resource, nics: unknown[]): Endpoint {
    const nic = nics[0];
    if (nics.length > 1) return this.fail(r, `${r.address} has more than one network interface; paths through secondary interfaces are not modeled yet`);
    if (!isObj(nic) || hasUnknown(r, ["network_interface", 0, "device_index"]) || num(nic.device_index) !== 0) return this.fail(r, `${r.address}: only the primary network interface (device_index 0) is modeled`);
    const id = nic.network_interface_id;
    let eni: Resource | undefined;
    if (!isUnknown(r, ["network_interface", 0, "network_interface_id"]) && typeof id === "string") {
      const a = this.snap.byId.get(id);
      eni = a ? this.get(a) : undefined;
      if (!eni) return this.fail(r, `${r.address}: network interface ${id} is not in this plan`);
    } else {
      const refs = r.otherRefs.has("network_interface") ? [] : fromConfig(this.snap, r, "network_interface", "aws_network_interface");
      const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.get(refs[0].address) : undefined;
      if (!one) return this.fail(r, `${r.address}: its network interface is unknown until apply and cannot be matched to one aws_network_interface`);
      eni = one;
    }
    const e = eni;
    const subnet = this.refTo(e, "subnet_id", "aws_subnet");
    if (!subnet.ok) return this.fail(r, subnet.reason);
    // An Elastic IP associated with the instance goes to its primary interface, which is
    // this one (device index 0), so both kinds of association count.
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
    const publicIp = (): Known<string | undefined> => {
      const onEni = this.eniEips.get(e.address);
      if (!onEni.ok) return unknown(onEni.reason);
      const onInstance = this.eips.get(r.address);
      if (!onInstance.ok) return unknown(onInstance.reason);
      const texts = [
        ...(onEni.value.length ? [`${onEni.value.toSorted(cmp).join(", ")} is associated with ${e.address}`] : []),
        ...(onInstance.value.length ? [`${onInstance.value.toSorted(cmp).join(", ")} is associated with ${r.address}`] : []),
      ];
      return known(texts.length ? texts.join("; ") : undefined);
    };
    const publicIp6 = (): Known<string | undefined> => {
      if ((isUnknown(e, ["ipv6_address_count"]) && e.configured.has("ipv6_address_count")) || (isUnknown(e, ["ipv6_addresses"]) && e.configured.has("ipv6_addresses"))) return unknown(`${e.address}: its IPv6 addresses are unknown until apply`);
      const count = e.values.ipv6_address_count;
      return (typeof count === "number" && count > 0) || arr(e.values.ipv6_addresses).length ? known(`${e.address} has IPv6 addresses`) : known(undefined);
    };
    const groups = (vpc: string): Known<SecurityGroup[]> => {
      const own = this.groups(e, "security_groups", vpc, false);
      const extra = this.eniGroups.get(e.address);
      if (own !== "empty" && !own.ok) return own;
      if (!extra.ok) return unknown(extra.reason);
      const mine = own === "empty" ? [] : own.value;
      const keys = [...new Set([...mine.map((g) => g.key), ...extra.value])].toSorted(cmp);
      return known(keys.length ? keys.map((k) => mine.find((g) => g.key === k) ?? this.securityGroup(k)) : [this.securityGroup(`default-sg:${vpc}`)]);
    };
    return this.place(r, subnet.value, publicIp, groups, undefined, [e.address, ...this.eniEips.sources(e.address), ...this.eips.sources(r.address), ...this.eniGroups.sources(e.address)], publicIp6);
  }

  /**
   * RDS: the DB instance gets a public address only when publicly_accessible is true, and
   * "Amazon RDS chooses a subnet and an IP address within that subnet group".
   * https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
   */
  private dbInstance(r: Resource): Endpoint[] {
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
  private auroraInstance(r: Resource): Endpoint[] {
    const cluster = this.clusterOf(r);
    if (!cluster.ok) {
      // A cluster instance known to be private is blocked at the public IP hop wherever it is.
      const private_ = !isUnknown(r, ["publicly_accessible"]) && r.values.publicly_accessible !== true;
      return [private_ ? { ...this.fail(r, cluster.reason), publicIp: known(undefined) } : this.fail(r, cluster.reason)];
    }
    const c = cluster.value;
    return this.rds(r, isNull(r, "db_subnet_group_name") ? c : r, c, [c.address]);
  }

  /** The aws_rds_cluster a cluster instance belongs to, by identifier or configuration reference. */
  private clusterOf(r: Resource): Known<Resource> {
    const id = r.values.cluster_identifier;
    if (!isUnknown(r, ["cluster_identifier"]) && typeof id === "string") {
      const found = this.ofType("aws_rds_cluster").filter((c) => !isUnknown(c, ["cluster_identifier"]) && c.values.cluster_identifier === id);
      if (found.length === 1) return known(found[0] as Resource);
      // A known identifier that no cluster in the plan has: do not guess from the configuration.
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
  private rds(r: Resource, subnetsOf: Resource, groupsOf: Resource, extraVia: string[] = []): Endpoint[] {
    let subnets: Known<string[]>;
    let groupVia: string[] = [...extraVia];
    const groupName = subnetsOf.values.db_subnet_group_name;
    if (isNull(subnetsOf, "db_subnet_group_name")) subnets = unknown(`${subnetsOf.address} uses the default DB subnet group, which is not in this plan`);
    else {
      let group: Resource | undefined;
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
        const g = this.groups(groupsOf, "vpc_security_group_ids", vpc);
        return g === "empty" ? known([]) : g;
      }, "the result depends on the subnet that RDS chooses from the DB subnet group", groupVia),
    );
  }

  /**
   * References in one attribute of a block (`network_configuration[0].subnets`). Known IDs
   * resolve by value. Unknown ones come from the configuration of the block, which merges
   * all its attributes, so only references of `types` count, and only for a single block.
   */
  private blockRefs(r: Resource, block: string, key: string, types: string[]): Ref[] {
    const blocks = arr(r.values[block]);
    const raw = blocks[0];
    if (blocks.length !== 1 || !isObj(raw)) return [{ kind: "unknown", reason: `${r.address}: ${block} is not one block` }];
    const listUnknown = isUnknown(r, [block, 0, key]);
    const items = listUnknown ? [] : arr(raw[key]);
    const out: Ref[] = [];
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
    const known_ = new Set(out.flatMap((x) => (x.kind === "resource" ? [x.address] : [])));
    const rest = fromCfg.filter((x) => !(x.kind === "resource" && known_.has(x.address)));
    if (!rest.length || rest.some((x) => x.kind !== "resource") || (!listUnknown && rest.length !== items.length - out.length)) {
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
  private ecsService(r: Resource): Endpoint[] {
    // Without network_configuration the service uses bridge or host networking: the tasks
    // share the container instance's interface, which is not modeled yet (a note says so).
    if (!r.configured.has("network_configuration") && !arr(r.values.network_configuration).length) return [];
    if (isUnknown(r, ["network_configuration"])) return [this.fail(r, `${r.address}: network_configuration is unknown until apply`)];
    const subnetRefs = this.blockRefs(r, "network_configuration", "subnets", ["aws_subnet"]);
    const bad = subnetRefs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    if (!subnetRefs.length) return [this.fail(r, `${r.address} has no subnets`)];
    const net = arr(r.values.network_configuration)[0] as Obj;
    const publicIp = (): Known<string | undefined> => {
      if (isUnknown(r, ["network_configuration", 0, "assign_public_ip"])) return unknown(`${r.address}: assign_public_ip is unknown until apply`);
      if (net.assign_public_ip !== true) return known(undefined);
      // launch_type is computed when unset, so an unknown value decides only when configured.
      if (isUnknown(r, ["capacity_provider_strategy"]) && r.configured.has("capacity_provider_strategy")) return unknown(`${r.address}: capacity_provider_strategy is unknown until apply`);
      const providers = arr(r.values.capacity_provider_strategy).map((x) => (isObj(x) ? String(x.capacity_provider) : ""));
      if (!providers.length && isUnknown(r, ["launch_type"]) && r.configured.has("launch_type")) return unknown(`${r.address}: launch_type is unknown until apply`);
      if (!providers.length && isUnknown(r, ["launch_type"])) return unknown(`${r.address}: neither launch_type nor capacity providers are set, so the cluster's default capacity provider decides`);
      const fargate = providers.length ? providers.every((x) => x === "FARGATE" || x === "FARGATE_SPOT") : r.values.launch_type === "FARGATE";
      if (fargate) return known(`${r.address} runs on Fargate with assign_public_ip = true`);
      if (!providers.length && (r.values.launch_type === "EC2" || r.values.launch_type === "EXTERNAL")) return known(undefined);
      return unknown(`${r.address}: capacity providers ${providers.join(", ") || "(none)"} may not be Fargate`);
    };
    const groups = (vpc: string): Known<SecurityGroup[]> => {
      if (isUnknown(r, ["network_configuration", 0, "security_groups"]) || arr(net.security_groups).length) {
        return this.groupsOf(r, this.blockRefs(r, "network_configuration", "security_groups", ["aws_security_group", "aws_default_security_group"]), vpc);
      }
      return known([this.securityGroup(`default-sg:${vpc}`)]);
    };
    return subnetRefs.map((x) => this.place(r, (x as { address: string }).address, publicIp, groups, "the result depends on the subnet ECS places a task in"));
  }

  /**
   * Interface VPC endpoint: "For each subnet that you specify from your VPC, we create an
   * endpoint network interface in the subnet and assign it a private IP address from the
   * subnet address range." Security groups: "By default, we associate the default security
   * group for the VPC." It has no public address, so it matters for paths inside the VPC.
   * https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html
   */
  private interfaceEndpoint(r: Resource): Endpoint[] {
    if (isUnknown(r, ["vpc_endpoint_type"])) return [this.fail(r, `${r.address}: vpc_endpoint_type is unknown until apply`)];
    if (String(r.values.vpc_endpoint_type ?? "Gateway") !== "Interface") return [];
    const refs = resolveRefs(this.snap, r, "subnet_ids", "aws_subnet");
    const bad = refs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    const groups = (vpc: string): Known<SecurityGroup[]> => {
      const g = this.groups(r, "security_group_ids", vpc);
      return g === "empty" ? known([]) : g;
    };
    return refs.map((x) => this.place(r, (x as { address: string }).address, () => known(undefined), groups, "the result differs between the endpoint's subnets"));
  }

  /**
   * Classic Load Balancer in a VPC: a node in each of `subnets`, internet-facing unless
   * `internal`. "If you use the AWS CLI or API create a load balancer in a nondefault
   * VPC, but you don't specify a security group, your load balancer is automatically
   * associated with the default security group for the VPC."
   * https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/elb-vpc-security-groups.html
   */
  private classicLoadBalancer(r: Resource): Endpoint[] {
    if (!arr(r.values.subnets).length && !isUnknown(r, ["subnets"])) return [this.fail(r, `${r.address} uses availability_zones, not subnets: a load balancer outside a VPC in this plan is not modeled`)];
    const refs = resolveRefs(this.snap, r, "subnets", "aws_subnet");
    const bad = refs.find((x) => x.kind !== "resource");
    if (bad) return [this.fail(r, bad.kind === "unknown" ? bad.reason : `${r.address}: a subnet is not managed in this plan`)];
    // Unset, `internal` is computed: "By default, Elastic Load Balancing creates an
    // Internet-facing load balancer."
    // https://docs.aws.amazon.com/elasticloadbalancing/2012-06-01/APIReference/API_CreateLoadBalancer.html
    const publicIp = (): Known<string | undefined> => {
      if (isUnknown(r, ["internal"]) && r.configured.has("internal")) return unknown(`${r.address}: internal is unknown until apply`);
      if (!isUnknown(r, ["internal"]) && r.values.internal === true) return known(undefined);
      return known(isUnknown(r, ["internal"]) ? `${r.address} is internet-facing (internal is not set; the AWS default)` : `${r.address} is internet-facing (internal = false)`);
    };
    const groups = (vpc: string): Known<SecurityGroup[]> => {
      const g = this.groups(r, "security_groups", vpc);
      return g === "empty" ? known([]) : g;
    };
    return refs.map((x) => this.place(r, (x as { address: string }).address, publicIp, groups, "the result differs between the load balancer's subnets"));
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
    // Dual-stack internet-facing load balancers also get IPv6 addresses.
    // https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
    const publicIp6 = (): Known<string | undefined> => {
      if (isUnknown(r, ["internal"]) || (isUnknown(r, ["ip_address_type"]) && r.configured.has("ip_address_type"))) return unknown(`${r.address}: internal or ip_address_type is unknown until apply`);
      const ipType = isUnknown(r, ["ip_address_type"]) ? "ipv4" : String(r.values.ip_address_type ?? "ipv4");
      return r.values.internal !== true && ipType.startsWith("dualstack") ? known(`${r.address} is internet-facing with ip_address_type = ${ipType}`) : known(undefined);
    };
    return subnets.value.map((sub) => this.place(r, sub, publicIp, groups, "the result differs between the load balancer's subnets", [], publicIp6));
  }

  /** Listener ports of a load balancer without security groups, as allow rules from anywhere. */
  private listenerGroup(lb: Resource): Known<SecurityGroup[]> {
    if (lb.values.load_balancer_type === "gateway") return unknown(`${lb.address}: Gateway Load Balancers are not modeled yet`);
    const rules: SgRule[] = [];
    const via: string[] = [];
    for (const l of this.ofType("aws_lb_listener")) {
      const target = this.optionalRefTo(l, "load_balancer_arn", "aws_lb");
      if (!target.ok) return unknown(target.reason);
      if (target.value !== lb.address) continue;
      const port = num(l.values.port);
      const proto = String(l.values.protocol ?? "").toUpperCase();
      if (port === undefined || isUnknown(l, ["port"]) || isUnknown(l, ["protocol"])) return unknown(`${l.address}: port or protocol is unknown until apply`);
      const protocols: RuleProtocol[] = proto === "UDP" ? ["udp"] : proto === "TCP_UDP" ? ["tcp", "udp"] : ["tcp"];
      via.push(l.address);
      for (const protocol of protocols) rules.push({ protocol, ports: [[port, port]], sources: ALL_IPV4, groups: [], resource: l.address, text: `${l.address} listens on ${protocol} ${port} (${lb.address} has no security groups)` });
    }
    // With no security groups, the targets see the client's address, not the load
    // balancer's, so it is not modeled as the source of a path inside the VPC.
    return known([{ address: `listeners of ${lb.address}`, key: `listeners:${lb.address}`, ingress: known(rules), egress: unknown(`${lb.address} has no security groups`), via }]);
  }
}
