// Google Cloud: internet to Compute Engine VMs (issue #95). Spec: docs/semantics/gcp.md.
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "../index.js";
import { plan, type Res, type Values } from "../testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const NET = "projects/demo-project/global/networks/main";

const network = (over: Values = {}) => res("google_compute_network", "main", { id: NET, name: "main", self_link: `https://www.googleapis.com/compute/v1/${NET}`, delete_default_routes_on_create: false, auto_create_subnetworks: false, ...over });
const fw = (name: string, over: Values = {}) =>
  res("google_compute_firewall", name, { id: `projects/demo-project/global/firewalls/${name}`, name, network: "main", direction: "INGRESS", priority: 1000, allow: [{ protocol: "tcp", ports: ["22"] }], deny: [], source_ranges: ["0.0.0.0/0"], source_tags: null, source_service_accounts: null, target_tags: null, target_service_accounts: null, disabled: false, ...over });
const vm = (over: Values = {}, nic: Values = {}) =>
  res("google_compute_instance", "web", { id: "projects/demo-project/zones/us-central1-a/instances/web", name: "web", tags: ["web"], service_account: [], network_interface: [{ network: "main", subnetwork: null, access_config: [{ nat_ip: "", network_tier: "PREMIUM" }], ...nic }], ...over });

const gcp = (r: Res[]): Path[] => analyze(plan(r)).paths.filter((p) => p.provider === "gcp");
const one = (r: Res[]): Path => {
  const p = gcp(r);
  expect(p).toHaveLength(1);
  return p[0] as Path;
};

describe("Google Cloud VMs from the internet", () => {
  it("allows a port that a firewall rule opens to 0.0.0.0/0 on a VM with an external IP", () => {
    const p = one([network(), fw("ssh"), vm()]);
    expect(p).toMatchObject({ id: "internet->google_compute_instance.web:tcp:22", provider: "gcp", from: "internet", to: "google_compute_instance.web", ports: "22", change: "unchanged" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.after.hops.map((h) => [h.hop, h.decision])).toEqual([
      ["public-ip", "allow"],
      ["firewall", "allow"],
      ["route", "allow"],
    ]);
    expect(p.after.hops[1]?.rule).toMatch(/google_compute_firewall\.ssh/);
  });

  it("blocks a VM without an access_config", () => {
    const p = one([network(), fw("ssh"), vm({}, { access_config: [] })]);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops[0]).toMatchObject({ hop: "public-ip", decision: "deny" });
  });

  it("lets a deny win a tie, and a lower priority number win over a higher one", () => {
    const deny = fw("deny-ssh", { allow: [], deny: [{ protocol: "tcp", ports: ["22"] }] });
    expect(one([network(), fw("ssh"), deny, vm()]).after.verdict).toBe("blocked");
    expect(one([network(), fw("ssh", { priority: 100 }), deny, vm()]).after.verdict).toBe("allowed");
  });

  it("applies target tags and ignores source tags and disabled rules", () => {
    expect(gcp([network(), fw("ssh", { target_tags: ["db"] }), vm()])).toHaveLength(0);
    expect(one([network(), fw("ssh", { target_tags: ["web"] }), vm()]).after.verdict).toBe("allowed");
    expect(gcp([network(), fw("ssh", { source_ranges: [], source_tags: ["bastion"] }), vm()])).toHaveLength(0);
    expect(gcp([network(), fw("ssh", { disabled: true }), vm()])).toHaveLength(0);
  });

  it("uses the API defaults for direction, priority, and disabled when the provider computes them", () => {
    const rule = fw("ssh", { direction: null, disabled: null, priority: 1000 });
    const p = one([network(), { ...rule, unknown: { direction: true, disabled: true } }, vm()]);
    expect(p.after.verdict).toBe("allowed");
    const set = { ...rule, unknown: { direction: true }, config: { direction: ["var.direction"] } };
    expect(new Set(gcp([network(), set, vm()]).map((x) => x.after.verdict))).toEqual(new Set(["unknown"]));
  });

  it("keeps unknown elements inside lists and blocks unknown, never empty", () => {
    const verdicts = (r: Res[]) => [...new Set(gcp(r).map((x) => x.after.verdict))];
    const ranges = fw("ssh", { source_ranges: [null] });
    expect(verdicts([network(), { ...ranges, unknown: { source_ranges: [true] } }, vm()])).toEqual(["unknown"]);
    const ports = fw("ssh", { allow: [{ protocol: "tcp", ports: [null] }] });
    expect(verdicts([network(), { ...ports, unknown: { allow: [{ ports: [true] }] } }, vm()])).toEqual(["unknown"]);
    const proto = fw("ssh", { allow: [{ protocol: null, ports: ["22"] }] });
    expect(verdicts([network(), { ...proto, unknown: { allow: [{ protocol: true }] } }, vm()])).toEqual(["unknown"]);
    const targets = fw("ssh", { target_tags: [null] });
    expect(verdicts([network(), { ...targets, unknown: { target_tags: [true] } }, vm()])).toEqual(["unknown"]);
    const tagged = vm({ tags: [null] });
    expect(verdicts([network(), fw("ssh", { target_tags: ["web"] }), { ...tagged, unknown: { tags: [true] } }])).toEqual(["unknown"]);
  });

  it("resolves a subnetwork named by a literal value through google_compute_subnetwork", () => {
    const other = res("google_compute_network", "other", { id: "projects/demo-project/global/networks/other", name: "other", delete_default_routes_on_create: false });
    const sub = res("google_compute_subnetwork", "main", { id: "projects/demo-project/regions/us-central1/subnetworks/main", name: "main", network: "other" });
    // The subnetwork "main" is in network "other", which has no rule: no path, not the rules of network "main".
    expect(gcp([network(), other, sub, fw("ssh"), vm({}, { network: null, subnetwork: "main" })])).toHaveLength(0);
  });

  it("gives partial sources for a narrow range", () => {
    const p = one([network(), fw("ssh", { source_ranges: ["203.0.113.0/24"] }), vm()]);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["203.0.113.0/24"]);
    expect(p.after.hops[1]?.decision).toBe("partial");
  });

  it("reads all protocols and port ranges", () => {
    const p = gcp([network(), fw("all", { allow: [{ protocol: "all", ports: [] }] }), vm()]);
    expect(p.map((x) => `${x.protocol}:${x.ports}`)).toEqual(["tcp:0-65535", "udp:0-65535"]);
    const range = one([network(), fw("web", { allow: [{ protocol: "tcp", ports: ["8000-8080"] }] }), vm()]);
    expect(range.ports).toBe("8000-8080");
  });

  it("reports the diff when the plan opens a port", () => {
    const opened = fw("ssh");
    const p = one([network(), { ...opened, before: { ...opened.after, source_ranges: ["10.0.0.0/8"] } }, vm()]);
    expect(p.change).toBe("added");
    expect(p.before.verdict).toBe("blocked");
    expect(p.after.verdict).toBe("allowed");
  });

  it("returns unknown for a network outside the plan, such as default", () => {
    // Unknown rules make every port a candidate, so both protocols are reported (ADR 0003).
    const p = gcp([fw("ssh", { network: "default" }), vm({}, { network: "default" })]);
    expect(p.map((x) => [x.protocol, x.ports, x.after.verdict])).toEqual([["tcp", "0-65535", "unknown"], ["udp", "0-65535", "unknown"]]);
    expect(p[0]?.after.reason).toMatch(/default/);
  });

  it("returns unknown when the VM's tags are unknown and a tagged rule could apply", () => {
    const v = vm({ tags: null });
    const p = gcp([network(), fw("ssh", { target_tags: ["web"] }), { ...v, unknown: { tags: true }, config: { tags: ["var.tags"] } }]);
    expect(p.map((x) => x.after.verdict)).toEqual(["unknown", "unknown"]);
  });

  it("returns unknown for more than one network interface", () => {
    const v = vm();
    const nics = [...((v.after as Values).network_interface as Values[]), { network: "main", subnetwork: null, access_config: [] }];
    const p = gcp([network(), fw("ssh"), { ...v, after: { ...v.after, network_interface: nics } }]);
    expect(p.map((x) => x.after.verdict)).toEqual(["unknown", "unknown"]);
  });

  it("returns unknown when a firewall policy is in the plan", () => {
    const policy = res("google_compute_network_firewall_policy_association", "p", { id: "a1", attachment_target: NET, firewall_policy: "pol" });
    const p = gcp([network(), fw("ssh"), vm(), policy]);
    expect(p.map((x) => x.after.verdict)).toEqual(["unknown", "unknown"]);
    expect(p[0]?.after.reason).toMatch(/not modeled yet/);
  });

  it("returns unknown for the route when the default route is deleted, and allows a custom default route", () => {
    const deleted = one([network({ delete_default_routes_on_create: true }), fw("ssh"), vm()]);
    expect(deleted.after.verdict).toBe("unknown");
    expect(deleted.after.hops.at(-1)?.hop).toBe("route");
    const custom = res("google_compute_route", "default", { id: "r1", name: "default-out", network: "main", dest_range: "0.0.0.0/0", next_hop_gateway: "default-internet-gateway", priority: 1000, tags: null });
    expect(one([network({ delete_default_routes_on_create: true }), fw("ssh"), vm(), custom]).after.verdict).toBe("allowed");
  });

  it("returns unknown when a custom route sends public addresses elsewhere", () => {
    const route = res("google_compute_route", "appliance", { id: "r2", name: "via-appliance", network: "main", dest_range: "0.0.0.0/0", next_hop_ip: "10.0.0.5", priority: 100, tags: null });
    expect(one([network(), fw("ssh"), vm(), route]).after.verdict).toBe("unknown");
  });

  it("resolves the network through a configuration reference", () => {
    const v = vm({}, { network: null });
    const p = one([network(), fw("ssh"), { ...v, unknown: { network_interface: [{ network: true }] }, config: { network_interface: ["google_compute_network.main"] } }]);
    expect(p.after.verdict).toBe("allowed");
  });

  it("leaves AWS paths without a provider", () => {
    const r = analyze(plan([network(), fw("ssh"), vm()]));
    expect(r.paths.every((p) => p.provider === "gcp")).toBe(true);
    expect(r.notes).toEqual([]);
  });
});

describe("Cloud SQL from the internet", () => {
  const sql = (ip: Values = {}, over: Values = {}) =>
    res("google_sql_database_instance", "db", { id: "db", name: "db", database_version: "POSTGRES_16", settings: [{ ip_configuration: [{ ipv4_enabled: true, authorized_networks: [{ name: "office", value: "203.0.113.0/24", expiration_time: "" }], ...ip }] }], ...over });

  it("allows the engine's port from the authorized networks only", () => {
    const p = one([sql()]);
    expect(p).toMatchObject({ id: "internet->google_sql_database_instance.db:tcp:5432", provider: "gcp", ports: "5432" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["203.0.113.0/24"]);
    expect(p.after.hops.map((h) => h.hop)).toEqual(["public-ip", "firewall"]);
  });

  it("uses the port of the database engine", () => {
    expect(one([sql({}, { database_version: "MYSQL_8_0" })]).ports).toBe("3306");
    expect(one([sql({}, { database_version: "SQLSERVER_2022_STANDARD" })]).ports).toBe("1433");
  });

  it("reports the whole internet for 0.0.0.0/0, and the diff when the plan adds it", () => {
    const open = sql({ authorized_networks: [{ name: "all", value: "0.0.0.0/0", expiration_time: "" }] });
    const p = one([{ ...open, before: sql().after as Values }]);
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.change).toBe("changed");
  });

  it("blocks without a public IP, and refuses everything without authorized networks", () => {
    const off = one([{ ...sql({ ipv4_enabled: false }), before: sql().after as Values }]);
    expect(off.after.verdict).toBe("blocked");
    expect(off.after.hops[0]).toMatchObject({ hop: "public-ip", decision: "deny" });
    const none = one([{ ...sql({ authorized_networks: [] }), before: sql().after as Values }]);
    expect(none.after.verdict).toBe("blocked");
    expect(none.after.hops.at(-1)).toMatchObject({ hop: "firewall", decision: "deny" });
  });

  it("returns unknown for an authorized network or version unknown until apply", () => {
    const u = sql({ authorized_networks: [{ name: "x", value: null, expiration_time: "" }] });
    expect(gcp([{ ...u, unknown: { settings: [{ ip_configuration: [{ authorized_networks: [{ value: true }] }] }] } }]).map((x) => x.after.verdict)).toEqual(["unknown", "unknown"]);
    const v = sql({}, { database_version: null });
    expect(gcp([{ ...v, unknown: { database_version: true } }]).map((x) => x.after.verdict)).toEqual(["unknown", "unknown"]);
  });
});
