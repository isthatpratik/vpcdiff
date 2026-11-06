import { describe, expect, it } from "vitest";
import { analyze, PlanError, toJson, type Path } from "./index.js";

type Values = Record<string, unknown>;
interface Res {
  type: string;
  name: string;
  before?: Values | null;
  after?: Values | null;
  unknown?: Values;
  /** Configuration expressions: attribute name to referenced names (resources, var., local.). */
  config?: Record<string, string[]>;
  /** Module call and instance key, for example ["net", '["a"]']. */
  module?: [string, string];
}

/** A minimal `terraform show -json` plan. Resources link through known IDs or `config`. */
function plan(resources: Res[]): unknown {
  const root: { resources: unknown[]; module_calls: Record<string, { module: { resources: unknown[] } }> } = { resources: [], module_calls: {} };
  for (const r of resources) {
    const expressions = Object.fromEntries(Object.entries(r.config ?? {}).map(([k, refs]) => [k, { references: refs.flatMap((x) => (/^(var|local)\./.test(x) ? [x] : [`${x}.id`, x])) }]));
    const entry = { address: `${r.type}.${r.name}`, mode: "managed", type: r.type, name: r.name, expressions };
    if (r.module) (root.module_calls[r.module[0]] ??= { module: { resources: [] } }).module.resources.push(entry);
    else root.resources.push(entry);
  }
  return {
    format_version: "1.2",
    resource_changes: resources.map((r) => {
      const before = r.before === undefined ? r.after : r.before;
      const after = r.after === undefined ? r.before : r.after;
      const actions = !before ? ["create"] : !after ? ["delete"] : JSON.stringify(before) === JSON.stringify(after) ? ["no-op"] : ["update"];
      const prefix = r.module ? `module.${r.module[0]}${r.module[1]}.` : "";
      return { address: `${prefix}${r.type}.${r.name}`, mode: "managed", type: r.type, name: r.name, change: { actions, before, after, after_unknown: r.unknown ?? {} } };
    }),
    configuration: { root_module: root },
  };
}

const sgRule = (from: number, to: number, cidrs: string[], protocol = "tcp") => ({ protocol, from_port: from, to_port: to, cidr_blocks: cidrs, ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: [], self: false });

/** One public instance in a public subnet. `over` replaces whole resources by name. */
function network(over: Partial<Record<"vpc" | "igw" | "subnet" | "rt" | "assoc" | "sg" | "instance", Res | null>> = {}, extra: Res[] = []): Res[] {
  const base: Record<string, Res> = {
    vpc: { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1" } },
    igw: { type: "aws_internet_gateway", name: "main", after: { id: "igw-1", vpc_id: "vpc-1" } },
    subnet: { type: "aws_subnet", name: "a", after: { id: "subnet-1", vpc_id: "vpc-1", cidr_block: "10.0.1.0/24", map_public_ip_on_launch: false } },
    rt: { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] } },
    assoc: { type: "aws_route_table_association", name: "a", after: { id: "rtbassoc-1", subnet_id: "subnet-1", route_table_id: "rtb-1" } },
    sg: { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] } },
    instance: { type: "aws_instance", name: "app", after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: true, network_interface: [] } },
  };
  const out: Res[] = [];
  for (const [k, v] of Object.entries(base)) {
    const o = over[k as keyof typeof over];
    if (o === null) continue;
    out.push(o ?? v);
  }
  return [...out, ...extra];
}

const only = (paths: Path[]) => {
  expect(paths).toHaveLength(1);
  return paths[0] as Path;
};

const nacl = (ingress: Values[], egress: Values[]): Res => ({ type: "aws_network_acl", name: "a", after: { id: "acl-2", subnet_ids: ["subnet-1"], ingress, egress } });
const naclRule = (rule_no: number, action: string, protocol: string, from: number, to: number, cidr = "0.0.0.0/0") => ({ rule_no, action, protocol, from_port: from, to_port: to, cidr_block: cidr, ipv6_cidr_block: "" });

describe("analyze", () => {
  it("allows a public instance with an open security group", () => {
    const p = only(analyze(plan(network())).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.change).toBe("unchanged");
  });

  it("blocks at the public IP hop when the instance has no public address", () => {
    const res = analyze(plan(network({ instance: { type: "aws_instance", name: "app", after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false } } })));
    const p = only(res.paths);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)?.hop).toBe("public-ip");
  });

  it("blocks at the route hop when the subnet uses the main route table", () => {
    const p = only(analyze(plan(network({ assoc: null }))).paths);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "route", resource: "main route table of aws_vpc.main", decision: "deny" });
  });

  it("blocks when no internet gateway is attached", () => {
    const p = only(analyze(plan(network({ igw: null, rt: { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [] } } }))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "internet-gateway", decision: "deny" });
  });

  it("returns unknown when the NACL allows the response only to some ephemeral ports", () => {
    const acl = nacl([naclRule(100, "allow", "-1", 0, 0)], [naclRule(100, "allow", "tcp", 32768, 65535)]);
    const p = only(analyze(plan(network({}, [acl]))).paths);
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.hops.at(-1)?.hop).toBe("nacl-outbound");
    expect(p.after.reason).toContain("client's operating system");
  });

  it("splits ports where a NACL deny rule cuts an all-traffic security group rule", () => {
    const acl = nacl([naclRule(50, "deny", "tcp", 22, 22), naclRule(100, "allow", "-1", 0, 0)], [naclRule(100, "allow", "-1", 0, 0)]);
    const sg: Res = { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [sgRule(0, 0, ["0.0.0.0/0"], "-1")] } };
    const paths = analyze(plan(network({ sg }, [acl]))).paths;
    expect(paths.map((p) => `${p.protocol}:${p.ports}:${p.after.verdict}`)).toEqual(["tcp:0-21:allowed", "tcp:22:blocked", "tcp:23-65535:allowed", "udp:0-65535:allowed"]);
  });

  it("reports only the allowed source CIDRs when the rule is narrower than the internet", () => {
    const sg: Res = { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [sgRule(443, 443, ["203.0.113.0/24"])] } };
    expect(only(analyze(plan(network({ sg }))).paths).after.sources).toEqual(["203.0.113.0/24"]);
  });

  it("returns unknown for a security group changed by an unmodeled rule resource", () => {
    const rule: Res = { type: "aws_security_group_rule", name: "extra", after: { id: "sgrule-1", security_group_id: "sg-1", type: "ingress", from_port: 22, to_port: 22, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] } };
    const paths = analyze(plan(network({}, [rule]))).paths;
    expect(paths.map((p) => `${p.protocol}:${p.ports}:${p.after.verdict}`)).toEqual(["tcp:0-65535:unknown", "udp:0-65535:unknown"]);
    expect(paths[0]?.after.reason).toContain("aws_security_group_rule");
  });

  it("returns unknown when a security group rule is unknown until apply", () => {
    const sg: Res = { type: "aws_security_group", name: "app", before: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] }, after: { id: "sg-1", ingress: [sgRule(443, 443, [])] }, unknown: { ingress: [{ cidr_blocks: true }] } };
    const p = analyze(plan(network({ sg }))).paths.find((x) => x.protocol === "tcp" && x.ports === "443");
    expect(p?.before.verdict).toBe("allowed");
    expect(p?.after.verdict).toBe("unknown");
    expect(p?.change).toBe("unknown");
  });

  it("reports a removed path", () => {
    const sg: Res = { type: "aws_security_group", name: "app", before: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] }, after: { id: "sg-1", ingress: [sgRule(443, 443, ["10.0.0.0/8"])] } };
    const res = analyze(plan(network({ sg })));
    expect(only(res.paths).change).toBe("removed");
    expect(res.summary.removed).toBe(1);
  });

  it("notes resource types it does not model", () => {
    const db: Res = { type: "aws_db_instance", name: "db", after: { id: "db-1", publicly_accessible: true } };
    expect(analyze(plan(network({}, [db]))).notes).toEqual([{ resource: "aws_db_instance.db", message: expect.stringContaining("not modeled yet") }]);
  });

  it("gives the same bytes for the same input in any resource order", () => {
    const resources = network({}, [nacl([naclRule(100, "allow", "-1", 0, 0)], [naclRule(100, "allow", "-1", 0, 0)])]);
    expect(toJson(analyze(plan(resources)))).toBe(toJson(analyze(plan(resources.toReversed()))));
  });

  it("rejects input that is not a plan", () => {
    expect(() => analyze({ hello: "world" })).toThrow(PlanError);
  });

  describe("review findings", () => {
    const sgRuleRes = (cidr: string): Values => ({ id: "sgrule-1", security_group_id: "sg-1", type: "ingress", from_port: 443, to_port: 443, protocol: "tcp", cidr_blocks: [cidr] });
    const igwRoutes = (extra: Values[]): Res => ({ type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }, ...extra] } });

    it("1: reports unknown, not unchanged, when an unmodeled rule changes on both sides", () => {
      const rule: Res = { type: "aws_security_group_rule", name: "web", before: sgRuleRes("10.0.0.0/8"), after: sgRuleRes("0.0.0.0/0") };
      const res = analyze(plan(network({}, [rule])));
      expect(res.paths.every((p) => p.change === "unknown")).toBe(true);
      expect(res.summary.unchanged).toBe(0);
    });

    it("2: reports the part of the sources whose response route is unresolved", () => {
      const p = only(analyze(plan(network({ rt: igwRoutes([{ cidr_block: "198.51.100.0/24", gateway_id: "igw-elsewhere" }]) }))).paths);
      expect(p.after.verdict).toBe("allowed");
      expect(p.after.reason).toContain("198.51.100.0/24");
      expect(p.after.hops.at(-1)?.decision).toBe("partial");
    });

    it("3: reports sources whose response is allowed only for some ephemeral ports", () => {
      const acl = nacl([naclRule(100, "allow", "-1", 0, 0)], [naclRule(50, "deny", "tcp", 40000, 65535, "198.51.100.0/24"), naclRule(100, "allow", "tcp", 1024, 65535)]);
      const p = only(analyze(plan(network({}, [acl]))).paths);
      expect(p.after.verdict).toBe("allowed");
      expect(p.after.reason).toContain("198.51.100.0/24");
    });

    it("4: returns unknown when a security group list mixes a resource and a variable", () => {
      const instance: Res = { type: "aws_instance", name: "app", before: null, after: { subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1", null], associate_public_ip_address: true, network_interface: [] }, unknown: { id: true, vpc_security_group_ids: [false, true] }, config: { vpc_security_group_ids: ["aws_security_group.app", "var.extra_sg"] } };
      const paths = analyze(plan(network({ instance })));
      expect(paths.paths.every((p) => p.after.verdict === "unknown")).toBe(true);
    });

    it("5: does not take another route's gateway reference for an unknown gateway", () => {
      const rt: Res = { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }, { cidr_block: "192.0.2.0/24", gateway_id: null }] }, unknown: { route: [{}, { gateway_id: true }] }, config: { route: ["aws_internet_gateway.main", "var.gw"] } };
      const p = only(analyze(plan(network({ rt }))).paths);
      expect(p.after.reason).toContain("192.0.2.0/24");
      expect(p.after.sources).not.toContain("192.0.2.0/24");
    });

    it("6: finds a managed default NACL for a VPC in a keyed module", () => {
      const mod: [string, string] = ["net", '["a"]'];
      const inModule = network().map((r): Res => ({ ...r, module: mod }));
      const vpc = inModule.find((r) => r.type === "aws_vpc") as Res;
      vpc.after = { ...vpc.after, default_network_acl_id: null };
      vpc.unknown = { default_network_acl_id: true };
      const def: Res = { type: "aws_default_network_acl", name: "d", module: mod, before: null, after: { default_network_acl_id: null, subnet_ids: [], ingress: [], egress: [] }, unknown: { default_network_acl_id: true, id: true }, config: { default_network_acl_id: ["aws_vpc.main"] } };
      const p = only(analyze(plan([...inModule, def])).paths);
      expect(p.after.hops.find((h) => h.hop === "nacl-inbound")?.decision).toBe("deny");
    });

    it("7: returns unknown, not blocked, when the internet gateway is outside the plan", () => {
      const p = only(analyze(plan(network({ igw: null, rt: igwRoutes([]) }))).paths);
      expect(p.after.verdict).toBe("unknown");
      expect(p.after.hops.at(-1)?.hop).toBe("internet-gateway");
    });

    it("8: returns unknown when associate_public_ip_address is set to a value unknown until apply", () => {
      const instance: Res = { type: "aws_instance", name: "app", after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: null, network_interface: [] }, unknown: { associate_public_ip_address: true }, config: { associate_public_ip_address: ["var.public"] } };
      expect(only(analyze(plan(network({ instance }))).paths).after.hops.at(-1)).toMatchObject({ hop: "public-ip", decision: "unknown" });
    });

    it("9: returns unknown when a VPN gateway can add more specific routes", () => {
      const prop: Res = { type: "aws_vpn_gateway_route_propagation", name: "p", after: { id: "p-1", route_table_id: "rtb-1", vpn_gateway_id: "vgw-1" } };
      expect(only(analyze(plan(network({}, [prop]))).paths).after.verdict).toBe("unknown");
      const rt: Res = { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", propagating_vgws: ["vgw-1"], route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] } };
      expect(only(analyze(plan(network({ rt }))).paths).after.verdict).toBe("unknown");
    });

    it("11: orders security groups the same way on both sides", () => {
      const sg = (name: string, id: string): Res => ({ type: "aws_security_group", name, after: { id, ingress: [sgRule(443, 443, ["0.0.0.0/0"])] } });
      const instance: Res = { type: "aws_instance", name: "app", before: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-a", "sg-b"], associate_public_ip_address: true, network_interface: [] }, after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: null, associate_public_ip_address: true, network_interface: [] }, unknown: { vpc_security_group_ids: true }, config: { vpc_security_group_ids: ["aws_security_group.a", "aws_security_group.b"] } };
      const p = only(analyze(plan(network({ sg: null, instance }, [sg("a", "sg-b"), sg("b", "sg-a")]))).paths);
      expect(p.change).toBe("unchanged");
    });
  });
});
