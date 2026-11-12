// Azure: internet to virtual machines (issue #96). Spec: docs/semantics/azure.md.
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "../index.js";
import { plan, type Res, type Values } from "../testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const ID = "/subscriptions/00000000-0000-0000-0000-00000000000c/resourceGroups/rg/providers/Microsoft.Network";
const rule = (name: string, priority: number, over: Values = {}): Values => ({ name, priority, direction: "Inbound", access: "Allow", protocol: "Tcp", source_port_range: "*", source_port_ranges: [], destination_port_range: "22", destination_port_ranges: [], source_address_prefix: "*", source_address_prefixes: [], destination_address_prefix: "*", destination_address_prefixes: [], source_application_security_group_ids: [], destination_application_security_group_ids: [], ...over });

const base = (o: { nsgRules?: Values[] | null; nicNsgRules?: Values[] | null; sku?: string; pip?: boolean; routes?: Values[] | null } = {}): Res[] => {
  const out: Res[] = [
    res("azurerm_virtual_network", "main", { id: `${ID}/virtualNetworks/main`, name: "main", address_space: ["10.60.0.0/16"] }),
    res("azurerm_subnet", "web", { id: `${ID}/virtualNetworks/main/subnets/web`, name: "web", address_prefixes: ["10.60.1.0/24"], virtual_network_name: "main" }),
    res("azurerm_network_interface", "web", { id: `${ID}/networkInterfaces/web`, name: "web", ip_configuration: [{ name: "primary", primary: true, subnet_id: `${ID}/virtualNetworks/main/subnets/web`, public_ip_address_id: o.pip === false ? null : `${ID}/publicIPAddresses/web` }] }),
    res("azurerm_linux_virtual_machine", "web", { id: "vm1", name: "web", network_interface_ids: [`${ID}/networkInterfaces/web`] }),
  ];
  if (o.pip !== false) out.push(res("azurerm_public_ip", "web", { id: `${ID}/publicIPAddresses/web`, name: "web", sku: o.sku ?? "Standard", ip_address: null }));
  if (o.nsgRules !== null) {
    out.push(res("azurerm_network_security_group", "subnet", { id: `${ID}/networkSecurityGroups/subnet`, name: "subnet", resource_group_name: "rg", security_rule: o.nsgRules ?? [rule("ssh", 100)] }));
    out.push(res("azurerm_subnet_network_security_group_association", "web", { id: "a1", subnet_id: `${ID}/virtualNetworks/main/subnets/web`, network_security_group_id: `${ID}/networkSecurityGroups/subnet` }));
  }
  if (o.nicNsgRules) {
    out.push(res("azurerm_network_security_group", "nic", { id: `${ID}/networkSecurityGroups/nic`, name: "nic", resource_group_name: "rg", security_rule: o.nicNsgRules }));
    out.push(res("azurerm_network_interface_security_group_association", "web", { id: "a2", network_interface_id: `${ID}/networkInterfaces/web`, network_security_group_id: `${ID}/networkSecurityGroups/nic` }));
  }
  if (o.routes) {
    out.push(res("azurerm_route_table", "web", { id: `${ID}/routeTables/web`, name: "web", resource_group_name: "rg", route: o.routes }));
    out.push(res("azurerm_subnet_route_table_association", "web", { id: "a3", subnet_id: `${ID}/virtualNetworks/main/subnets/web`, route_table_id: `${ID}/routeTables/web` }));
  }
  return out;
};
const azure = (r: Res[]): Path[] => analyze(plan(r)).paths.filter((p) => p.provider === "azure");
const one = (r: Res[]): Path => {
  const p = azure(r);
  expect(p).toHaveLength(1);
  return p[0] as Path;
};

describe("Azure VMs from the internet", () => {
  it("allows a port that the subnet NSG opens, through a Standard public IP", () => {
    const p = one(base());
    expect(p).toMatchObject({ id: "internet->azurerm_linux_virtual_machine.web:tcp:22", provider: "azure", ports: "22" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.after.hops.map((h) => [h.hop, h.decision])).toEqual([["public-ip", "allow"], ["nsg", "allow"], ["route", "allow"]]);
  });

  it("needs both NSGs to allow: the NIC NSG's DenyAllInbound blocks", () => {
    const p = one(base({ nicNsgRules: [] }));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "nsg", decision: "deny" });
    expect(p.after.reason).toMatch(/DenyAllInbound/);
    expect(one(base({ nicNsgRules: [rule("ssh", 200)] })).after.verdict).toBe("allowed");
  });

  it("stops at the first matching priority", () => {
    const deny = rule("deny-range", 100, { access: "Deny", source_address_prefix: "198.51.100.0/24" });
    const p = one(base({ nsgRules: [rule("ssh", 110), deny] }));
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops[1]?.decision).toBe("partial");
    expect(p.after.sources).not.toContain("198.51.100.0/24");
  });

  it("reads the Internet tag, port lists, and ranges", () => {
    const r = rule("web", 100, { source_address_prefix: "Internet", destination_port_range: null, destination_port_ranges: ["80", "8000-8080"] });
    expect(azure(base({ nsgRules: [r] })).map((p) => p.ports)).toEqual(["80", "8000-8080"]);
  });

  it("blocks without a public IP, and a Standard public IP without any NSG", () => {
    expect(one(base({ pip: false })).after.hops[0]).toMatchObject({ hop: "public-ip", decision: "deny" });
    // The plan removes the subnet's NSG: a Standard public IP without any NSG is closed.
    const removed = base().map((x) => (x.type.includes("security_group") ? { ...x, before: x.after ?? null, after: null } : x));
    const p = one(removed);
    expect(p.change).toBe("removed");
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/secure by default/);
  });

  it("returns unknown for a Basic SKU public IP", () => {
    expect(one(base({ sku: "Basic" })).after.verdict).toBe("unknown");
  });

  it("blocks direct access when 0.0.0.0/0 goes to a virtual appliance, and drops a None route", () => {
    const nva = one(base({ routes: [{ name: "all", address_prefix: "0.0.0.0/0", next_hop_type: "VirtualAppliance", next_hop_in_ip_address: "10.60.9.4" }] }));
    expect(nva.after.verdict).toBe("blocked");
    expect(nva.after.hops.at(-1)).toMatchObject({ hop: "route", decision: "deny" });
    const drop = one(base({ routes: [{ name: "drop", address_prefix: "203.0.113.0/24", next_hop_type: "None", next_hop_in_ip_address: null }] }));
    expect(drop.after.verdict).toBe("allowed");
    expect(drop.after.hops.at(-1)?.decision).toBe("partial");
  });

  it("leaves out the public ranges that system routes drop", () => {
    const p = one(base());
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.after.hops.at(-1)?.rule).toMatch(/157\.59\.0\.0\/16/);
  });

  it("returns unknown for an unknown service tag source and a partial destination", () => {
    expect(azure(base({ nsgRules: [rule("x", 100, { source_address_prefix: "AzureCloud" })] })).every((p) => p.after.verdict === "unknown")).toBe(true);
    expect(azure(base({ nsgRules: [rule("x", 100, { destination_address_prefix: "10.60.1.0/25" })] })).every((p) => p.after.verdict === "unknown")).toBe(true);
  });

  it("matches rules from azurerm_network_security_rule by NSG name and resource group", () => {
    const extra = res("azurerm_network_security_rule", "http", { ...rule("http", 110, { destination_port_range: "80" }), id: "r1", network_security_group_name: "subnet", resource_group_name: "rg" });
    expect(azure([...base(), extra]).map((p) => p.ports)).toEqual(["22", "80"]);
  });

  it("reads rule resources when the provider computes the NSG's inline rules", () => {
    const r = base({ nsgRules: [] }).map((x) => (x.type === "azurerm_network_security_group" ? { ...x, after: { ...x.after, security_rule: null }, unknown: { security_rule: true } } : x));
    const extra = res("azurerm_network_security_rule", "ssh", { ...rule("ssh", 100), id: "r2", network_security_group_name: "subnet", resource_group_name: "rg" });
    expect(one([...r, extra]).after.verdict).toBe("allowed");
    const configured = r.map((x) => (x.type === "azurerm_network_security_group" ? { ...x, config: { security_rule: ["var.rules"] } } : x));
    expect(azure([...configured, extra]).every((p) => p.after.verdict === "unknown")).toBe(true);
  });

  it("keeps a more specific Internet route next to 0.0.0.0/0 to an appliance", () => {
    const p = one(base({ routes: [{ name: "all", address_prefix: "0.0.0.0/0", next_hop_type: "VirtualAppliance", next_hop_in_ip_address: "10.60.9.4" }, { name: "office", address_prefix: "198.51.100.0/24", next_hop_type: "Internet", next_hop_in_ip_address: null }] }));
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["198.51.100.0/24"]);
  });

  it("returns unknown for a separate rule whose destination ASG is unknown until apply", () => {
    const asg = res("azurerm_network_security_rule", "asg", { ...rule("asg", 100, { destination_address_prefix: null, destination_application_security_group_ids: [null] }), id: "r3", network_security_group_name: "subnet", resource_group_name: "rg" }, { unknown: { destination_application_security_group_ids: [true] } });
    const paths = azure([...base({ nsgRules: [] }), asg]);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.after.verdict === "unknown")).toBe(true);
  });

  it("returns unknown for more than one network interface", () => {
    const r = base().map((x) => (x.type === "azurerm_linux_virtual_machine" ? { ...x, after: { ...x.after, network_interface_ids: [`${ID}/networkInterfaces/web`, `${ID}/networkInterfaces/other`] } } : x));
    expect(azure(r).every((p) => p.after.verdict === "unknown")).toBe(true);
  });
});
