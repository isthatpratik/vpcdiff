// Paths inside the VPC (issue #32, docs/semantics/internal-paths.md).
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "./index.js";
import { naclRule, network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values | null, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const allOut = [sgRule(0, 0, ["0.0.0.0/0"], "-1")];
const fromWeb = { ...sgRule(8080, 8080, []), security_groups: ["sg-web"] };

/**
 * Two instances: web in subnet-1 (10.0.1.0/24) and app in subnet-2 (10.0.2.0/24),
 * both private (no public IP), so the only paths are inside the VPC.
 */
function twoTier(over: { web?: Values; app?: Values; webSg?: Values | null; appSg?: Values | null; appSgBefore?: Values | null } = {}, extra: Res[] = []): Res[] {
  const appSg = over.appSg === undefined ? { id: "sg-app", ingress: [fromWeb], egress: allOut } : over.appSg;
  return network(
    {
      sg: res("aws_security_group", "web", over.webSg === undefined ? { id: "sg-web", ingress: [], egress: allOut } : over.webSg),
      instance: res("aws_instance", "web", { id: "i-web", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-web"], associate_public_ip_address: false, network_interface: [], ...over.web }),
    },
    [
      res("aws_subnet", "b", { id: "subnet-2", vpc_id: "vpc-1", cidr_block: "10.0.2.0/24", map_public_ip_on_launch: false }),
      res("aws_security_group", "app", appSg, over.appSgBefore !== undefined ? { before: over.appSgBefore } : {}),
      res("aws_instance", "app", { id: "i-app", subnet_id: "subnet-2", vpc_security_group_ids: ["sg-app"], associate_public_ip_address: false, network_interface: [], ...over.app }),
      ...extra,
    ],
  );
}
const internal = (resources: Res[]): Path[] => analyze(plan(resources)).paths.filter((p) => p.from !== "internet");
const hop = (o: Path["after"], kind: string) => o.hops.find((h) => h.hop === kind);

describe("paths inside the VPC", () => {
  it("allows web to app when the app group references the web group", () => {
    const p = only(internal(twoTier()));
    expect(p).toMatchObject({ id: "aws_instance.web->aws_instance.app:tcp:8080", from: "aws_instance.web", fromType: "aws_instance", to: "aws_instance.app", protocol: "tcp", ports: "8080" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["aws_instance.web"]);
    expect(p.after.hops.map((h) => h.hop)).toEqual(["source-security-group", "source-route", "source-nacl-outbound", "target-nacl-inbound", "security-group", "target-nacl-outbound", "source-nacl-inbound", "target-route"]);
    expect(hop(p.after, "security-group")?.rule).toBe("aws_security_group.app ingress tcp 8080 from aws_security_group.web");
  });

  it("reports a path the plan opens", () => {
    const p = only(internal(twoTier({ appSgBefore: { id: "sg-app", ingress: [], egress: allOut } })));
    expect(p.change).toBe("added");
    expect(p.before.verdict).toBe("blocked");
    expect(hop(p.before, "security-group")?.decision).toBe("deny");
  });

  it("reports a path the plan cuts by removing the reference", () => {
    const p = only(internal(twoTier({ appSg: { id: "sg-app", ingress: [], egress: allOut }, appSgBefore: { id: "sg-app", ingress: [fromWeb], egress: allOut } })));
    expect(p.change).toBe("removed");
    expect(p.after.reason).toBe("no ingress rule of aws_security_group.app allows tcp/8080 from aws_instance.web");
  });

  it("blocks at the source when its group has no outbound rule", () => {
    const p = only(internal(twoTier({ webSg: { id: "sg-web", ingress: [], egress: [] } })));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)?.hop).toBe("source-security-group");
  });

  it("allows an outbound rule to the target's group", () => {
    const p = only(internal(twoTier({ webSg: { id: "sg-web", ingress: [], egress: [{ ...sgRule(8080, 8080, []), security_groups: ["sg-app"] }] } })));
    expect(p.after.verdict).toBe("allowed");
  });

  it("returns unknown when an outbound CIDR covers only part of the target's subnet", () => {
    const p = only(internal(twoTier({ webSg: { id: "sg-web", ingress: [], egress: [sgRule(8080, 8080, ["10.0.2.0/25"])] } })));
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.reason).toMatch(/covers only part of the subnet of aws_instance.app/);
  });

  it("blocks when the target subnet's NACL denies the source subnet", () => {
    const acl = res("aws_network_acl", "b", { id: "acl-2", subnet_ids: ["subnet-2"], ingress: [naclRule(100, "deny", "tcp", 8080, 8080, "10.0.1.0/24"), naclRule(200, "allow", "-1", 0, 0)], egress: [naclRule(100, "allow", "-1", 0, 0)] });
    const p = only(internal(twoTier({}, [acl])));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)?.hop).toBe("target-nacl-inbound");
  });

  it("returns unknown when the reply is allowed for some ephemeral ports only", () => {
    const acl = res("aws_network_acl", "b", { id: "acl-2", subnet_ids: ["subnet-2"], ingress: [naclRule(100, "allow", "-1", 0, 0)], egress: [naclRule(100, "allow", "tcp", 32768, 65535)] });
    const p = only(internal(twoTier({}, [acl])));
    expect(p.after.verdict).toBe("unknown");
    expect(hop(p.after, "target-nacl-outbound")?.decision).toBe("unknown");
  });

  it("skips NACLs inside one subnet", () => {
    const acl = res("aws_network_acl", "deny", { id: "acl-2", subnet_ids: ["subnet-1"], ingress: [], egress: [] });
    const p = only(internal(twoTier({ app: { subnet_id: "subnet-1" } }, [acl])));
    expect(p.after.verdict).toBe("allowed");
    expect(hop(p.after, "source-nacl-outbound")?.rule).toBe("same subnet: no network ACL applies");
  });

  it("gives one path each way for a self reference", () => {
    const shared = { id: "sg-app", ingress: [{ ...sgRule(5432, 5432, []), self: true }], egress: allOut };
    const paths = internal(twoTier({ web: { vpc_security_group_ids: ["sg-app"] }, webSg: null, appSg: shared }));
    expect(paths.map((p) => `${p.id} ${p.after.verdict}`)).toEqual(["aws_instance.app->aws_instance.web:tcp:5432 allowed", "aws_instance.web->aws_instance.app:tcp:5432 allowed"]);
  });

  it("checks groups that reference each other once in each direction", () => {
    const web = { id: "sg-web", ingress: [{ ...sgRule(9000, 9000, []), security_groups: ["sg-app"] }], egress: allOut };
    expect(internal(twoTier({ webSg: web })).map((p) => p.id)).toEqual(["aws_instance.app->aws_instance.web:tcp:9000", "aws_instance.web->aws_instance.app:tcp:8080"]);
  });

  it("returns unknown for endpoints in different VPCs", () => {
    const vpc2 = res("aws_vpc", "other", { id: "vpc-2", cidr_block: "10.9.0.0/16", default_network_acl_id: "acl-9" });
    const subnet = res("aws_subnet", "c", { id: "subnet-9", vpc_id: "vpc-2", cidr_block: "10.9.1.0/24", map_public_ip_on_launch: false });
    const p = only(internal(twoTier({ app: { subnet_id: "subnet-9" } }, [vpc2, subnet])));
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.reason).toMatch(/different VPCs/);
  });

  it("returns unknown when a route more specific than local covers the target subnet", () => {
    const rt = res("aws_route_table", "a", { id: "rtb-1", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }, { cidr_block: "10.0.2.0/24", network_interface_id: "eni-fw" }] });
    const p = only(internal(twoTier({}, []).map((r) => (r.type === "aws_route_table" ? rt : r))));
    expect(p.after.verdict).toBe("unknown");
    expect(hop(p.after, "source-route")?.decision).toBe("unknown");
  });

  it("notes a rule whose group is unknown until apply", () => {
    const appSg = { id: "sg-app", ingress: [fromWeb, { ...sgRule(22, 22, []), security_groups: null }], egress: allOut };
    const result = analyze(plan(twoTier({ appSg }).map((r) => (r.name === "app" && r.type === "aws_security_group" ? { ...r, unknown: { ingress: [{}, { security_groups: true }] }, config: { ingress: ["var.bastion"] } } : r))));
    expect(result.notes.find((n) => n.resource === "aws_security_group.app")?.message).toMatch(/paths inside the VPC to aws_instance.app from security groups that cannot be resolved are not checked/);
    expect(only(result.paths.filter((p) => p.from !== "internet")).after.verdict).toBe("allowed");
  });

  it("notes an endpoint whose security groups are unknown, instead of hiding its paths", () => {
    const resources = twoTier({ app: { vpc_security_group_ids: null } }).map((r) => (r.type === "aws_instance" && r.name === "app" ? { ...r, unknown: { vpc_security_group_ids: true }, config: { vpc_security_group_ids: ["var.groups"] } } : r));
    const result = analyze(plan(resources));
    expect(result.paths.filter((p) => p.from !== "internet")).toEqual([]);
    expect(result.notes.find((n) => n.resource === "aws_instance.app")?.message).toMatch(/its security groups are unknown .*paths inside the VPC to aws_instance.app/);
  });

  it("names every endpoint that shares a group with an unresolved rule in one note", () => {
    const appSg = { id: "sg-app", ingress: [{ ...sgRule(22, 22, []), security_groups: null }], egress: allOut };
    const second = res("aws_instance", "app2", { id: "i-app2", subnet_id: "subnet-2", vpc_security_group_ids: ["sg-app"], associate_public_ip_address: false, network_interface: [] });
    const resources = twoTier({ appSg }, [second]).map((r) => (r.name === "app" && r.type === "aws_security_group" ? { ...r, unknown: { ingress: [{ security_groups: true }] }, config: { ingress: ["var.bastion"] } } : r));
    const notes = analyze(plan(resources)).notes.filter((n) => n.resource === "aws_security_group.app");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toMatch(/to aws_instance.app, aws_instance.app2 from/);
  });

  it("does not list a path from a group outside the plan", () => {
    expect(internal(twoTier({ appSg: { id: "sg-app", ingress: [{ ...sgRule(8080, 8080, []), security_groups: ["sg-elsewhere"] }], egress: allOut } }))).toEqual([]);
  });
});
