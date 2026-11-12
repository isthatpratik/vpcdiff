// Google Cloud resources for internet paths to Compute Engine VMs. Rules and sources:
// docs/semantics/gcp.md (ADR 0011).
import { ALL_PORTS, cidrToSet, fromRanges, type IntervalSet, type Range } from "../intervals.js";
import type { Known, RuleProtocol } from "../model.js";
import { normalizeProtocol } from "../model.js";
import { cmp, fromConfig, hasUnknown, isObj, isUnknown, type Resource, type Snapshot } from "../plan.js";

const known = <T>(value: T): Known<T> => ({ ok: true, value });
const unknown = <T>(reason: string): Known<T> => ({ ok: false, reason });

/** One protocol entry of a firewall rule's `allow` or `deny` block. */
export interface FwRule {
  resource: string;
  priority: number;
  allow: boolean;
  protocol: RuleProtocol;
  ports: IntervalSet;
  /** Internet-relevant sources: `source_ranges` only (rule 6). */
  sources: IntervalSet;
  text: string;
}

export interface GcpRoute {
  /** Allows the response; otherwise the reason it cannot be decided. */
  ok: boolean;
  resource: string;
  text: string;
}

export interface GcpVm {
  address: string;
  type: string;
  network: Known<string>;
  externalIp: Known<string | undefined>;
  /** Ingress rules that apply to this VM, ordered by priority with deny first on a tie. */
  firewall: Known<FwRule[]>;
  route: Known<GcpRoute>;
}

const UNMODELED_POLICIES = ["google_compute_network_firewall_policy_association", "google_compute_region_network_firewall_policy_association", "google_compute_firewall_policy_association"];
const UNMODELED_ROUTES = ["google_network_connectivity_policy_based_route"];

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The last path segment of a network name, ID, or self link (`projects/p/global/networks/main`). */
const lastSegment = (v: string) => v.split("/").at(-1) ?? v;

/**
 * Ports of a firewall protocol entry: "22", "8000-8080". No ports means all ports;
 * `all` matches every port.
 */
function portsOf(protocol: RuleProtocol, ports: unknown): IntervalSet | undefined {
  const list = strList(ports);
  if (protocol === "all" || !list.length) return ALL_PORTS;
  const ranges: [number, number][] = [];
  for (const p of list) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim());
    if (!m) return undefined;
    ranges.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return fromRanges(ranges);
}

export class GcpModel {
  constructor(private readonly snap: Snapshot) {}

  private ofType(type: string): Resource[] {
    return [...this.snap.resources.values()].filter((r) => r.type === type).toSorted((a, b) => cmp(a.address, b.address));
  }

  /** The google_compute_network a value names (name, ID, or self link), or one configuration reference. */
  private networkOf(r: Resource, attr: string, value: unknown, unknownValue: boolean): Known<string> {
    if (!unknownValue && typeof value === "string" && value) {
      const name = lastSegment(value);
      const found = this.ofType("google_compute_network").filter((n) => !isUnknown(n, ["name"]) && n.values.name === name);
      if (found.length === 1) return known((found[0] as Resource).address);
      return unknown(`${r.address}: network ${value} is not in this plan; its firewall rules (for the default network, rules that allow incoming connections) are not known`);
    }
    if (r.otherRefs.has(attr)) return unknown(`${r.address}: its network uses values that are unknown until apply`);
    const refs = fromConfig(this.snap, r, attr, "google_compute_network");
    if (refs.length === 1 && refs[0]?.kind === "resource") return known(refs[0].address);
    // A subnetwork reference names its network.
    const subs = fromConfig(this.snap, r, attr, "google_compute_subnetwork");
    const sub = subs.length === 1 && subs[0]?.kind === "resource" ? this.snap.resources.get(subs[0].address) : undefined;
    if (sub) return this.networkOf(sub, "network", sub.values.network, isUnknown(sub, ["network"]));
    return unknown(`${r.address}: its network is unknown until apply and cannot be matched to one google_compute_network`);
  }

  /** The network of the subnetwork a VM interface names: a known value by its name, else a configuration reference. */
  private subnetNetwork(r: Resource, value: unknown, unknownValue: boolean): Known<string> {
    if (!unknownValue && typeof value === "string" && value) {
      const name = lastSegment(value);
      const found = this.ofType("google_compute_subnetwork").filter((n) => !isUnknown(n, ["name"]) && n.values.name === name);
      if (found.length !== 1) return unknown(`${r.address}: subnetwork ${value} is not one google_compute_subnetwork in this plan`);
      const sub = found[0] as Resource;
      return this.networkOf(sub, "network", sub.values.network, isUnknown(sub, ["network"]));
    }
    return this.networkOf(r, "network_interface", value, true);
  }

  vms(): GcpVm[] {
    return this.ofType("google_compute_instance").map((r) => this.vm(r));
  }

  private vm(r: Resource): GcpVm {
    const fail = (reason: string): GcpVm => ({ address: r.address, type: r.type, network: unknown(reason), externalIp: unknown(reason), firewall: unknown(reason), route: unknown(reason) });
    if (isUnknown(r, ["network_interface"])) return fail(`${r.address}: network_interface is unknown until apply`);
    const nics = Array.isArray(r.values.network_interface) ? r.values.network_interface : [];
    if (nics.length !== 1) return fail(`${r.address} has ${nics.length} network interfaces; only VMs with one are modeled`);
    const nic = nics[0];
    if (!isObj(nic)) return fail(`${r.address}: network_interface cannot be read`);
    const netUnknown = isUnknown(r, ["network_interface", 0, "network"]);
    const net = netUnknown || (typeof nic.network === "string" && nic.network) ? this.networkOf(r, "network_interface", nic.network, netUnknown) : this.subnetNetwork(r, nic.subnetwork, isUnknown(r, ["network_interface", 0, "subnetwork"]));

    // Rule 1: an access_config block gives the interface an external IPv4 address.
    let externalIp: Known<string | undefined>;
    if (isUnknown(r, ["network_interface", 0, "access_config"])) externalIp = unknown(`${r.address}: access_config is unknown until apply`);
    else {
      const configs = Array.isArray(nic.access_config) ? nic.access_config : [];
      const ip = configs.length && isObj(configs[0]) && typeof configs[0].nat_ip === "string" && configs[0].nat_ip ? configs[0].nat_ip : undefined;
      externalIp = known(configs.length ? (ip ? `${r.address} has the external IP address ${ip}` : `${r.address} has an external IP address (access_config)`) : undefined);
    }
    if (!net.ok) return { address: r.address, type: r.type, network: net, externalIp, firewall: unknown(net.reason), route: unknown(net.reason) };
    return { address: r.address, type: r.type, network: net, externalIp, firewall: this.firewall(r, net.value), route: this.route(r, net.value) };
  }

  /** Whether `target_tags` / `target_service_accounts` select the VM (rule 5). */
  private targets(rule: Resource, vm: Resource): Known<boolean> {
    for (const attr of ["target_tags", "target_service_accounts"]) if (hasUnknown(rule, [attr])) return unknown(`${rule.address}: ${attr} is unknown until apply`);
    const tags = strList(rule.values.target_tags);
    const accounts = strList(rule.values.target_service_accounts);
    if (!tags.length && !accounts.length) return known(true);
    if (tags.length) {
      if (hasUnknown(vm, ["tags"])) return unknown(`${vm.address}: tags are unknown until apply, and ${rule.address} applies to tags ${tags.join(", ")}`);
      return known(strList(vm.values.tags).some((t) => tags.includes(t)));
    }
    if (hasUnknown(vm, ["service_account"])) return unknown(`${vm.address}: service_account is unknown until apply, and ${rule.address} applies to service accounts`);
    const sa = Array.isArray(vm.values.service_account) ? vm.values.service_account : [];
    const emails: string[] = [];
    for (const [i, s] of sa.entries()) {
      if (isUnknown(vm, ["service_account", i, "email"])) return unknown(`${vm.address}: its service account email is unknown until apply, and ${rule.address} applies to service accounts`);
      if (isObj(s) && typeof s.email === "string") emails.push(s.email);
    }
    return known(emails.some((e) => accounts.includes(e)));
  }

  /**
   * The network's ingress rules that apply to the VM, in evaluation order: lower priority
   * number first, deny before allow on a tie (rule 3).
   */
  private firewall(vm: Resource, network: string): Known<FwRule[]> {
    for (const type of UNMODELED_POLICIES) {
      const p = this.ofType(type)[0];
      if (p) return unknown(`${p.address} (${type}) adds firewall policy rules, and ${type} is not modeled yet`);
    }
    const out: FwRule[] = [];
    for (const r of this.ofType("google_compute_firewall")) {
      const net = this.networkOf(r, "network", r.values.network, isUnknown(r, ["network"]));
      if (!net.ok) {
        // A rule whose network cannot be resolved may belong to this network.
        return unknown(net.reason);
      }
      if (net.value !== network) continue;
      for (const attr of ["allow", "deny", "source_ranges", "source_tags", "source_service_accounts"]) if (hasUnknown(r, [attr])) return unknown(`${r.address}: ${attr} is unknown until apply`);
      // Unset, the provider leaves these to the API: direction INGRESS, enabled, priority 1000.
      const direction = valueOr(r, "direction", "INGRESS");
      const disabled = valueOr(r, "disabled", false);
      const prio = valueOr(r, "priority", 1000);
      for (const v of [direction, disabled, prio]) if (!v.ok) return unknown(v.reason);
      if (String(direction.ok && direction.value) !== "INGRESS" || (disabled.ok && disabled.value === true)) continue;
      const target = this.targets(r, vm);
      if (!target.ok) return target;
      if (!target.value) continue;
      const priority = prio.ok && typeof prio.value === "number" ? prio.value : 1000;
      const ranges = strList(r.values.source_ranges);
      // An ingress rule without any source uses 0.0.0.0/0 (the API default).
      const anySource = !ranges.length && !strList(r.values.source_tags).length && !strList(r.values.source_service_accounts).length;
      const sources: Range[] = [];
      for (const c of anySource ? ["0.0.0.0/0"] : ranges) {
        if (c.includes(":")) continue; // IPv6 ranges never match an IPv4 source.
        const set = cidrToSet(c);
        if (!set) return unknown(`${r.address}: source range ${c} cannot be read`);
        sources.push(...set);
      }
      for (const action of ["deny", "allow"] as const) {
        for (const block of Array.isArray(r.values[action]) ? (r.values[action] as unknown[]) : []) {
          if (!isObj(block)) continue;
          const protocol = normalizeProtocol(block.protocol);
          const ports = portsOf(protocol, block.ports);
          if (!ports) return unknown(`${r.address}: ports ${strList(block.ports).join(", ")} cannot be read`);
          const portText = protocol === "all" ? "all traffic" : `${String(block.protocol)} ${strList(block.ports).join(", ") || "all ports"}`;
          out.push({ resource: r.address, priority, allow: action === "allow", protocol, ports, sources: fromRanges(sources), text: `${r.address} priority ${priority}: ${action} ${portText} from ${anySource ? "0.0.0.0/0" : ranges.join(", ") || "tagged instances only"}` });
        }
      }
    }
    return known(out.toSorted((a, b) => a.priority - b.priority || Number(a.allow) - Number(b.allow) || cmp(a.text, b.text)));
  }

  /** Whether the response can use the default internet gateway (rule 9). */
  private route(vm: Resource, network: string): Known<GcpRoute> {
    for (const type of UNMODELED_ROUTES) {
      const p = this.ofType(type)[0];
      if (p) return unknown(`${p.address} (${type}) can change routing, and ${type} is not modeled yet`);
    }
    const n = this.snap.resources.get(network) as Resource;
    if (isUnknown(n, ["delete_default_routes_on_create"])) return unknown(`${network}: delete_default_routes_on_create is unknown until apply`);
    let viaGateway: string | undefined = n.values.delete_default_routes_on_create === true ? undefined : `${network} system default route 0.0.0.0/0 -> default internet gateway`;
    for (const r of this.ofType("google_compute_route")) {
      const net = this.networkOf(r, "network", r.values.network, isUnknown(r, ["network"]));
      if (!net.ok) return unknown(net.reason);
      if (net.value !== network) continue;
      if (hasAnyUnknown(r, ["dest_range", "tags", "next_hop_gateway"])) return unknown(`${r.address}: its destination, tags, or next hop are unknown until apply`);
      const tags = strList(r.values.tags);
      if (tags.length) {
        if (hasUnknown(vm, ["tags"])) return unknown(`${vm.address}: tags are unknown until apply, and ${r.address} applies to tags ${tags.join(", ")}`);
        if (!strList(vm.values.tags).some((t) => tags.includes(t))) continue;
      }
      const dest = typeof r.values.dest_range === "string" ? r.values.dest_range : "";
      const gw = typeof r.values.next_hop_gateway === "string" ? r.values.next_hop_gateway : "";
      const toGateway = gw !== "" && lastSegment(gw) === "default-internet-gateway";
      // Private destinations never match a public client address.
      const set = cidrToSet(dest);
      if (!set) return unknown(`${r.address}: destination ${dest} cannot be read`);
      if (isPrivate(set)) continue;
      if (toGateway && dest === "0.0.0.0/0") viaGateway ??= `${r.address} 0.0.0.0/0 -> default internet gateway`;
      else if (!toGateway) return unknown(`${r.address} sends ${dest} to another next hop, so responses to some internet clients may not use the default internet gateway; custom routes are not modeled yet`);
    }
    if (!viaGateway) return unknown(`${network} has no default route to the default internet gateway (delete_default_routes_on_create = true); whether a response needs it is not documented`);
    return known({ ok: true, resource: network, text: viaGateway });
  }
}

/** A value, or the API default when the configuration leaves it unset and the provider computes it. */
function valueOr(r: Resource, attr: string, dflt: unknown): Known<unknown> {
  if (isUnknown(r, [attr])) return r.configured.has(attr) ? unknown(`${r.address}: ${attr} is unknown until apply`) : known(dflt);
  const v = r.values[attr];
  return known(v === null || v === undefined ? dflt : v);
}

// Any element of a list or block (`tags = [unknown]` is `[true]` in after_unknown).
const hasAnyUnknown = (r: Resource, attrs: string[]) => attrs.some((a) => hasUnknown(r, [a]));

// Private-use and shared address space (RFC 1918, RFC 6598) is never an internet client.
const PRIVATE: IntervalSet = fromRanges(["10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16"].flatMap((c) => cidrToSet(c) ?? []));
const isPrivate = (set: IntervalSet) => set.every(([lo, hi]) => PRIVATE.some(([plo, phi]) => lo >= plo && hi <= phi));
