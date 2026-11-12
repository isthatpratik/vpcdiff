// Internet to an Azure VM, hop by hop. Rules and sources: docs/semantics/azure.md.
import { ALL_PORTS, contains, equals, formatPorts, intersect, isEmpty, setToCidrs, subtract, union, EMPTY, type IntervalSet, type Range } from "../intervals.js";
import type { Hop, Outcome, Protocol } from "../types.js";
import { DROPPED_TEXT, type AzNsg, type AzVm } from "./model.js";

const DOC = {
  "public-ip": "https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses",
  nsg: "https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works",
  route: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview",
} as const;

const absent: Outcome = { verdict: "absent", sources: [], hops: [], reason: "the resource does not exist on this side of the plan" };
const protoMatches = (rule: string, p: Protocol) => rule === "all" || rule === p;

/** One NSG for `addrs`: the first matching rule by priority decides (rule 4). */
function nsgEval(nsg: AzNsg, addrs: IntervalSet, p: Protocol, ports: Range): { allowed: IntervalSet; texts: string[]; doubt?: string } | { error: string } {
  if (!nsg.rules.ok) return { error: nsg.rules.reason };
  let remaining = addrs;
  let allowed: IntervalSet = EMPTY;
  const texts: string[] = [];
  for (const rule of nsg.rules.value) {
    if (isEmpty(remaining)) break;
    if (!protoMatches(rule.protocol, p) || !contains(rule.ports, [ports])) continue;
    if (rule.doubt) return { allowed, texts, doubt: rule.doubt };
    const m = intersect(remaining, rule.sources);
    if (isEmpty(m)) continue;
    if (rule.allow) allowed = union(allowed, m);
    texts.push(rule.text);
    remaining = subtract(remaining, m);
  }
  return { allowed, texts };
}

export function evaluateAzure(vm: AzVm | undefined, p: Protocol, ports: Range): Outcome {
  if (!vm) return absent;
  const hops: Hop[] = [];
  const add = (hop: keyof typeof DOC, resource: string, decision: Hop["decision"], rule: string) => hops.push({ hop, resource, decision, rule, doc: DOC[hop] });
  const stop = (verdict: "blocked" | "unknown", reason: string): Outcome => ({ verdict, sources: [], hops, reason });
  const unknownAt = (hop: keyof typeof DOC, resource: string, reason: string) => {
    add(hop, resource, "unknown", reason);
    return stop("unknown", reason);
  };
  const portText = `${p}/${formatPorts([ports])}`;
  const universe = vm.universe;

  // 1. Public IP (rules 1 and 2).
  if (!vm.publicIp.ok) return unknownAt("public-ip", vm.address, vm.publicIp.reason);
  if (!vm.publicIp.value) {
    add("public-ip", vm.address, "deny", `${vm.address} has no public IP address on its network interface`);
    return stop("blocked", `${vm.address} has no public IP address`);
  }
  add("public-ip", vm.address, "allow", vm.publicIp.value);

  // 2. The subnet's NSG, then the interface's NSG; both must allow (rule 3).
  if (!vm.subnetNsg.ok) return unknownAt("nsg", vm.address, vm.subnetNsg.reason);
  if (!vm.nicNsg.ok) return unknownAt("nsg", vm.address, vm.nicNsg.reason);
  const levels = [vm.subnetNsg.value, vm.nicNsg.value].filter((n): n is AzNsg => n !== null);
  const names = levels.map((n) => n.resource).join(", ");
  if (!levels.length) {
    const why = `no network security group is associated with the subnet or the network interface of ${vm.address}; a Standard public IP is secure by default and closed to inbound traffic`;
    add("nsg", vm.address, "deny", why);
    return stop("blocked", why);
  }
  let sources = universe;
  const texts: string[] = [];
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

  // 3. The response: longest prefix match in the subnet's routes (rule 8). NSGs are stateful (rule 7).
  if (!vm.routes.ok) return unknownAt("route", vm.address, vm.routes.reason);
  const routes = vm.routes.value.toSorted((a, b) => b.prefix - a.prefix || Number(b.user) - Number(a.user));
  let remaining = sources;
  let out: IntervalSet = EMPTY;
  const routeTexts: string[] = [];
  const undecided: string[] = [];
  let defaultAway: string | undefined;
  for (const route of routes) {
    const m = intersect(remaining, route.cidr);
    if (isEmpty(m)) continue;
    routeTexts.push(route.text);
    remaining = subtract(remaining, m);
    if (route.hop === "Internet") out = union(out, m);
    else if (route.hop === "None") continue;
    // A more specific Internet route still carries its clients' responses; only the rest is cut off.
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

/** Ports an allow rule opens to an internet address, in any NSG of the VM. Every port when they are unknown (ADR 0003). */
export function azureExposed(vm: AzVm | undefined, p: Protocol): IntervalSet {
  if (!vm) return EMPTY;
  if (!vm.subnetNsg.ok || !vm.nicNsg.ok) return ALL_PORTS;
  let out: IntervalSet = EMPTY;
  for (const nsg of [vm.subnetNsg.value, vm.nicNsg.value]) {
    if (!nsg) continue;
    if (!nsg.rules.ok) return ALL_PORTS;
    for (const r of nsg.rules.value) if ((r.allow || r.doubt) && protoMatches(r.protocol, p) && (r.doubt || !isEmpty(intersect(r.sources, vm.universe)))) out = union(out, r.ports);
  }
  return out;
}

export function azureCuts(vm: AzVm | undefined): IntervalSet[] {
  const cuts: IntervalSet[] = [];
  for (const n of vm?.subnetNsg.ok && vm.nicNsg.ok ? [vm.subnetNsg.value, vm.nicNsg.value] : []) if (n?.rules.ok) cuts.push(...n.rules.value.map((r) => r.ports));
  return cuts;
}
