import { describe, expect, it } from "vitest";
import { analyze, PlanError, toJson, type Path } from "./index.js";

type Values = Record<string, unknown>;
interface Res {
  type: string;
  name: string;
  before?: Values | null;
  after?: Values | null;
  unknown?: Values;
}

/** A minimal `terraform show -json` plan. Resources link through known IDs. */
function plan(resources: Res[]): unknown {
  return {
    format_version: "1.2",
    resource_changes: resources.map((r) => {
      const before = r.before === undefined ? r.after : r.before;
      const after = r.after === undefined ? r.before : r.after;
      const actions = !before ? ["create"] : !after ? ["delete"] : JSON.stringify(before) === JSON.stringify(after) ? ["no-op"] : ["update"];
      return { address: `${r.type}.${r.name}`, mode: "managed", type: r.type, name: r.name, change: { actions, before, after, after_unknown: r.unknown ?? {} } };
    }),
    configuration: { root_module: { resources: [] } },
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
});
