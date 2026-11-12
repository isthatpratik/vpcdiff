// Azure resources for internet paths to virtual machines. Rules and sources:
// docs/semantics/azure.md (ADR 0011).
import { PUBLIC_IPV4 } from "../evaluate.js";
import { ALL_PORTS, cidrToSet, contains, fromRanges, intersect, isEmpty, subtract, union, EMPTY, type IntervalSet, type Range } from "../intervals.js";
import type { Known, RuleProtocol } from "../model.js";
import { cmp, fromConfig, hasUnknown, isObj, isUnknown, resolveRefs, type Resource, type Snapshot } from "../plan.js";

const known = <T>(value: T): Known<T> => ({ ok: true, value });
const unknown = <T>(reason: string): Known<T> => ({ ok: false, reason });

/** One NSG rule as it applies to one VM. `doubt`: why its sources or destination cannot be decided. */
export interface AzRule {
  priority: number;
  allow: boolean;
  protocol: RuleProtocol;
  ports: IntervalSet;
  sources: IntervalSet;
  doubt?: string;
  text: string;
}

export interface AzNsg {
  resource: string;
  /** Inbound rules in priority order, the default rules last. */
  rules: Known<AzRule[]>;
}

export interface AzRoute {
  cidr: IntervalSet;
  prefix: number;
  hop: string;
  user: boolean;
  text: string;
}

export interface AzVm {
  address: string;
  type: string;
  publicIp: Known<string | undefined>;
  subnetNsg: Known<AzNsg | null>;
  nicNsg: Known<AzNsg | null>;
  routes: Known<AzRoute[]>;
  /** Internet sources for this VM: public IPv4 outside every virtual network, without the platform address. */
  universe: IntervalSet;
}

const VMS = ["azurerm_linux_virtual_machine", "azurerm_windows_virtual_machine"];
const PLATFORM = cidrToSet("168.63.129.16/32") ?? EMPTY;
// System routes that drop public ranges (rule 8).
const DROPPED = ["157.59.0.0/16", "104.147.0.0/16", "104.146.0.0/17"];

const strs = (...vs: unknown[]): string[] => vs.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((x): x is string => typeof x === "string" && x !== "");
const setOf = (cidrs: string[]): IntervalSet | undefined => {
  let out: IntervalSet = EMPTY;
  for (const c of cidrs) {
    const s = cidrToSet(c.includes("/") ? c : `${c}/32`);
    if (!s) return undefined;
    out = union(out, s);
  }
  return out;
};
const prefixOf = (c: string) => Number(c.split("/")[1] ?? 32);

/** "22", "1000-2000", or "*". */
function portsOf(list: string[]): IntervalSet | undefined {
  if (!list.length || list.includes("*")) return ALL_PORTS;
  const ranges: Range[] = [];
  for (const p of list) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim());
    if (!m) return undefined;
    ranges.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return fromRanges(ranges);
}

const protocolOf = (p: unknown): RuleProtocol => {
  const s = String(p).toLowerCase();
  return s === "*" ? "all" : s === "tcp" ? "tcp" : s === "udp" ? "udp" : "other";
};

export class AzureModel {
  private readonly vnetSpace: Known<IntervalSet>;

  constructor(private readonly snap: Snapshot) {
    let space: IntervalSet = EMPTY;
    let why: string | undefined;
    for (const n of this.ofType("azurerm_virtual_network")) {
      if (hasUnknown(n, ["address_space"])) why ??= `${n.address}: address_space is unknown until apply`;
      const s = setOf(strs(n.values.address_space));
      if (!s) why ??= `${n.address}: address_space cannot be read`;
      else space = union(space, s);
    }
    this.vnetSpace = why ? unknown(why) : known(space);
  }

  private ofType(type: string): Resource[] {
    return [...this.snap.resources.values()].filter((r) => r.type === type).toSorted((a, b) => cmp(a.address, b.address));
  }

  /** A resource that an ID attribute names: a known ID, else one configuration reference. */
  private byRef(r: Resource, attr: string, value: unknown, unknownValue: boolean, type: string): Known<Resource> {
    if (!unknownValue && typeof value === "string" && value) {
      const a = this.snap.byId.get(value);
      const found = a ? this.snap.resources.get(a) : undefined;
      return found && found.type === type ? known(found) : unknown(`${r.address}: ${value} is not a ${type} in this plan`);
    }
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: ${attr} uses values that are unknown until apply`);
    const refs = fromConfig(this.snap, r, attr, type);
    const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.snap.resources.get(refs[0].address) : undefined;
    return one ? known(one) : unknown(`${r.address}: its ${type} is unknown until apply and cannot be matched to one resource`);
  }

  /** A resource named by `name` and `resource_group_name` (rule resources), else one configuration reference. */
  private byName(r: Resource, attr: string, type: string): Known<Resource> {
    const name = r.values[attr];
    const rg = r.values.resource_group_name;
    if (!isUnknown(r, [attr]) && typeof name === "string" && !isUnknown(r, ["resource_group_name"]) && typeof rg === "string") {
      const found = this.ofType(type).filter((x) => x.values.name === name && x.values.resource_group_name === rg && !isUnknown(x, ["name"]));
      if (found.length === 1) return known(found[0] as Resource);
    }
    const refs = fromConfig(this.snap, r, attr, type);
    const one = refs.length === 1 && refs[0]?.kind === "resource" ? this.snap.resources.get(refs[0].address) : undefined;
    return one ? known(one) : unknown(`${r.address}: ${attr} cannot be matched to one ${type} in this plan`);
  }

  vms(): AzVm[] {
    return VMS.flatMap((t) => this.ofType(t)).toSorted((a, b) => cmp(a.address, b.address)).map((r) => this.vm(r));
  }

  private vm(r: Resource): AzVm {
    // System routes drop three public ranges for every subnet, so a client there never gets a response (rule 8).
    const universe = subtract(subtract(subtract(PUBLIC_IPV4, PLATFORM), DROPPED_SET), this.vnetSpace.ok ? this.vnetSpace.value : EMPTY);
    const fail = (reason: string): AzVm => ({ address: r.address, type: r.type, publicIp: unknown(reason), subnetNsg: unknown(reason), nicNsg: unknown(reason), routes: unknown(reason), universe });
    if (!this.vnetSpace.ok) return fail(this.vnetSpace.reason);
    const nics = resolveRefs(this.snap, r, "network_interface_ids", "azurerm_network_interface");
    if (nics.length !== 1) return fail(`${r.address} has ${nics.length} network interfaces; only VMs with one are modeled`);
    const ref = nics[0];
    if (ref?.kind !== "resource") return fail(ref?.kind === "unknown" ? ref.reason : `${r.address}: its network interface is not in this plan`);
    const nic = this.snap.resources.get(ref.address) as Resource;
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
      universe,
    };
  }

  /** Rules 1 and 2: a Standard public IP on the interface's IP configuration. */
  private publicIp(nic: Resource, ipc: Record<string, unknown>): Known<string | undefined> {
    const path = ["ip_configuration", 0, "public_ip_address_id"];
    if (!isUnknown(nic, path) && (ipc.public_ip_address_id === null || ipc.public_ip_address_id === undefined || ipc.public_ip_address_id === "")) return known(undefined);
    const pip = this.byRef(nic, "ip_configuration", ipc.public_ip_address_id, isUnknown(nic, path), "azurerm_public_ip");
    if (!pip.ok) return unknown(pip.reason);
    const p = pip.value;
    if (isUnknown(p, ["sku"]) && p.configured.has("sku")) return unknown(`${p.address}: sku is unknown until apply`);
    // The provider's default SKU is Standard.
    const sku = typeof p.values.sku === "string" ? p.values.sku : "Standard";
    if (sku !== "Standard") return unknown(`${p.address} has the ${sku} SKU; Basic public IPs are retired and open by default, which is not modeled`);
    return known(`${p.address} (Standard) is on ${nic.address}`);
  }

  /** The NSG an association resource attaches to `target` (a subnet or an interface), or null. */
  private associated(type: string, attr: string, targetType: string, target: Resource, subnet: IntervalSet): Known<AzNsg | null> {
    const found: Resource[] = [];
    for (const a of this.ofType(type)) {
      const t = this.byRef(a, attr, a.values[attr], isUnknown(a, [attr]), targetType);
      if (!t.ok) return unknown(t.reason);
      if (t.value.address !== target.address) continue;
      const nsg = this.byRef(a, "network_security_group_id", a.values.network_security_group_id, isUnknown(a, ["network_security_group_id"]), "azurerm_network_security_group");
      if (!nsg.ok) return unknown(nsg.reason);
      found.push(nsg.value);
    }
    if (found.length > 1) return unknown(`${target.address} has ${found.length} network security group associations`);
    const nsg = found[0];
    return known(nsg ? { resource: nsg.address, rules: this.rules(nsg, subnet) } : null);
  }

  /** The NSG's inbound rules for a VM in `subnet` (rules 4 to 6), with the default rules. */
  private rules(nsg: Resource, subnet: IntervalSet): Known<AzRule[]> {
    // Without inline blocks, the provider computes security_rule from the separate rule
    // resources, which are read below.
    if (hasUnknown(nsg, ["security_rule"]) && nsg.configured.has("security_rule")) return unknown(`${nsg.address}: security_rule is unknown until apply`);
    const raw: { values: Record<string, unknown>; label: string }[] = [];
    for (const b of !isUnknown(nsg, ["security_rule"]) && Array.isArray(nsg.values.security_rule) ? nsg.values.security_rule : []) if (isObj(b)) raw.push({ values: b, label: `${nsg.address} rule ${String(b.name)}` });
    for (const r of this.ofType("azurerm_network_security_rule")) {
      const owner = this.byName(r, "network_security_group_name", "azurerm_network_security_group");
      if (!owner.ok) return unknown(owner.reason);
      if (owner.value.address !== nsg.address) continue;
      if (anyUnknown(r, ["priority", "direction", "access", "protocol", "source_address_prefix", "source_address_prefixes", "destination_address_prefix", "destination_address_prefixes", "destination_port_range", "destination_port_ranges", "source_port_range", "source_port_ranges", "destination_application_security_group_ids", "source_application_security_group_ids"])) return unknown(`${r.address}: a field is unknown until apply`);
      raw.push({ values: r.values, label: r.address });
    }
    const vnet = this.vnetSpace.ok ? this.vnetSpace.value : EMPTY;
    const out: AzRule[] = [];
    for (const { values: v, label } of raw) {
      if (String(v.direction) !== "Inbound") continue;
      const priority = typeof v.priority === "number" ? v.priority : NaN;
      if (!Number.isFinite(priority)) return unknown(`${label}: priority cannot be read`);
      const ports = portsOf(strs(v.destination_port_range, v.destination_port_ranges));
      if (!ports) return unknown(`${label}: destination ports cannot be read`);
      const text = `${label} priority ${priority}: ${String(v.access).toLowerCase()} ${String(v.protocol)} ${strs(v.destination_port_range, v.destination_port_ranges).join(", ") || "*"} from ${strs(v.source_address_prefix, v.source_address_prefixes).join(", ") || "application security groups"}`;
      const doubts: string[] = [];
      // Source ports: the client's port is unknown, so only "*" decides.
      const srcPorts = strs(v.source_port_range, v.source_port_ranges);
      if (srcPorts.length && !srcPorts.includes("*")) doubts.push("its source ports depend on the client");
      // Destination: the VM's private address is somewhere in its subnet (rule 5).
      if (strs(v.destination_application_security_group_ids).length) doubts.push("its destination is an application security group, which is not modeled yet");
      else {
        let covers = false;
        for (const d of strs(v.destination_address_prefix, v.destination_address_prefixes)) {
          if (["*", "Any", "VirtualNetwork", "0.0.0.0/0"].includes(d)) covers = true;
          else if (d === "Internet" || d.includes(":") || /^[A-Za-z]/.test(d)) continue;
          else {
            const set = setOf([d]);
            if (!set) return unknown(`${label}: destination ${d} cannot be read`);
            if (contains(set, subnet)) covers = true;
            else if (!isEmpty(intersect(set, subnet))) doubts.push(`its destination ${d} covers only part of the subnet, and the VM's address is not known before apply`);
          }
        }
        if (!covers && !doubts.length) continue;
        if (covers) doubts.splice(0, doubts.length, ...doubts.filter((d) => d.startsWith("its source ports")));
      }
      // Sources (rule 6). Application security groups hold interfaces, never internet addresses.
      let sources: IntervalSet = EMPTY;
      for (const src of strs(v.source_address_prefix, v.source_address_prefixes)) {
        if (["*", "Any", "Internet", "0.0.0.0/0"].includes(src)) sources = ALL_IPV4_SET;
        else if (src === "AzureLoadBalancer") sources = union(sources, PLATFORM);
        else if (src === "VirtualNetwork") {
          if (!isEmpty(intersect(vnet, PUBLIC_IPV4))) doubts.push("VirtualNetwork includes a public address space");
          sources = union(sources, vnet);
        } else if (src.includes(":")) continue; // An IPv6 source never matches an IPv4 client.
        else if (/^[A-Za-z]/.test(src)) doubts.push(`its source is the service tag ${src}, whose addresses are not in the plan`);
        else {
          const set = setOf([src]);
          if (!set) return unknown(`${label}: source ${src} cannot be read`);
          sources = union(sources, set);
        }
      }
      out.push({ priority, allow: String(v.access) === "Allow", protocol: protocolOf(v.protocol), ports, sources, text, ...(doubts.length ? { doubt: `${label}: ${doubts.join("; ")}` } : {}) });
    }
    out.push(
      { priority: 65000, allow: true, protocol: "all", ports: ALL_PORTS, sources: vnet, text: `${nsg.address} default rule AllowVnetInBound (65000): allow from VirtualNetwork` },
      { priority: 65001, allow: true, protocol: "all", ports: ALL_PORTS, sources: PLATFORM, text: `${nsg.address} default rule AllowAzureLoadBalancerInBound (65001): allow from AzureLoadBalancer` },
      { priority: 65500, allow: false, protocol: "all", ports: ALL_PORTS, sources: ALL_IPV4_SET, text: `${nsg.address} default rule DenyAllInbound (65500): deny all` },
    );
    return known(out.toSorted((a, b) => a.priority - b.priority || cmp(a.text, b.text)));
  }

  /** The subnet's routes: system routes and the user-defined routes of its route table (rule 8). */
  private routes(s: Resource): Known<AzRoute[]> {
    const system: AzRoute[] = [
      { cidr: cidrToSet("0.0.0.0/0") ?? EMPTY, prefix: 0, hop: "Internet", user: false, text: "system route 0.0.0.0/0 -> Internet" },
      ...DROPPED.map((c) => ({ cidr: cidrToSet(c) ?? EMPTY, prefix: prefixOf(c), hop: "None", user: false, text: `system route ${c} -> None` })),
    ];
    const tables: Resource[] = [];
    for (const a of this.ofType("azurerm_subnet_route_table_association")) {
      const t = this.byRef(a, "subnet_id", a.values.subnet_id, isUnknown(a, ["subnet_id"]), "azurerm_subnet");
      if (!t.ok) return unknown(t.reason);
      if (t.value.address !== s.address) continue;
      const table = this.byRef(a, "route_table_id", a.values.route_table_id, isUnknown(a, ["route_table_id"]), "azurerm_route_table");
      if (!table.ok) return unknown(table.reason);
      tables.push(table.value);
    }
    if (tables.length > 1) return unknown(`${s.address} has ${tables.length} route table associations`);
    const table = tables[0];
    if (!table) return known(system);
    if (hasUnknown(table, ["route"]) && table.configured.has("route")) return unknown(`${table.address}: route is unknown until apply`);
    const user: { v: Record<string, unknown>; label: string }[] = (!isUnknown(table, ["route"]) && Array.isArray(table.values.route) ? table.values.route : []).filter(isObj).map((v) => ({ v, label: `${table.address} route ${String(v.name)}` }));
    for (const r of this.ofType("azurerm_route")) {
      const owner = this.byName(r, "route_table_name", "azurerm_route_table");
      if (!owner.ok) return unknown(owner.reason);
      if (owner.value.address !== table.address) continue;
      if (anyUnknown(r, ["address_prefix", "next_hop_type"])) return unknown(`${r.address}: address_prefix or next_hop_type is unknown until apply`);
      user.push({ v: r.values, label: r.address });
    }
    const out: AzRoute[] = [];
    for (const { v, label } of user) {
      const c = typeof v.address_prefix === "string" ? v.address_prefix : "";
      if (c.includes(":")) continue; // An IPv6 prefix never matches an IPv4 client.
      if (/^[A-Za-z]/.test(c)) return unknown(`${label}: a service tag prefix (${c}) is not modeled yet`);
      const set = cidrToSet(c);
      if (!set) continue; // An IPv6 prefix never matches an IPv4 client.
      out.push({ cidr: set, prefix: prefixOf(c), hop: String(v.next_hop_type), user: true, text: `${label} ${c} -> ${String(v.next_hop_type)}` });
    }
    // A user-defined route overrides a system route with the same prefix.
    return known([...out, ...system.filter((x) => !out.some((u) => u.prefix === x.prefix && contains(u.cidr, x.cidr) && contains(x.cidr, u.cidr)))]);
  }
}

/** Any of the attributes, or any element inside them, is unknown until apply. */
const anyUnknown = (r: Resource, attrs: string[]) => attrs.some((a) => hasUnknown(r, [a]));

const ALL_IPV4_SET: IntervalSet = cidrToSet("0.0.0.0/0") ?? EMPTY;
const DROPPED_SET: IntervalSet = DROPPED.reduce<IntervalSet>((acc, c) => union(acc, cidrToSet(c) ?? EMPTY), EMPTY);
export const DROPPED_TEXT = `system routes drop ${DROPPED.join(", ")}`;
