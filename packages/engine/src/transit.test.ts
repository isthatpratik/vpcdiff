// Paths inside the VPC between VPCs through a transit gateway (issue #94).
// Spec: docs/semantics/transit-gateway.md.
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "./index.js";
import { plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const all = [sgRule(0, 0, ["0.0.0.0/0"], "-1")];
const fromWeb = { ...sgRule(5432, 5432, []), security_groups: ["sg-web"] };

interface Over {
  tgw?: Values;
  attA?: Values;
  attB?: Values;
  routeA?: Values[];
  routeB?: Values[];
  vpcB?: Values;
  subnetA?: Values;
  dbIngress?: Values[];
  webEgress?: Values[];
}

/** web in VPC A (10.0.0.0/16) reaches db in VPC B (10.1.0.0/16) on 5432 through tgw-1 and its default route table. */
function transit(over: Over = {}, extra: Res[] = []): Res[] {
  return [
    res("aws_vpc", "a", { id: "vpc-a", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-a" }),
    res("aws_vpc", "b", { id: "vpc-b", cidr_block: "10.1.0.0/16", default_network_acl_id: "acl-b", ...over.vpcB }),
    res("aws_subnet", "a", { id: "subnet-a", vpc_id: "vpc-a", cidr_block: "10.0.1.0/24", availability_zone: "us-east-1a", map_public_ip_on_launch: false, ...over.subnetA }),
    res("aws_subnet", "b", { id: "subnet-b", vpc_id: "vpc-b", cidr_block: "10.1.1.0/24", availability_zone: "us-east-1a", map_public_ip_on_launch: false }),
    res("aws_ec2_transit_gateway", "hub", { id: "tgw-1", default_route_table_association: "enable", default_route_table_propagation: "enable", association_default_route_table_id: "tgw-rtb-default", propagation_default_route_table_id: "tgw-rtb-default", security_group_referencing_support: "enable", ...over.tgw }),
    res("aws_ec2_transit_gateway_vpc_attachment", "a", { id: "tgw-attach-a", transit_gateway_id: "tgw-1", vpc_id: "vpc-a", subnet_ids: ["subnet-a"], transit_gateway_default_route_table_association: true, transit_gateway_default_route_table_propagation: true, security_group_referencing_support: "enable", ...over.attA }),
    res("aws_ec2_transit_gateway_vpc_attachment", "b", { id: "tgw-attach-b", transit_gateway_id: "tgw-1", vpc_id: "vpc-b", subnet_ids: ["subnet-b"], transit_gateway_default_route_table_association: true, transit_gateway_default_route_table_propagation: true, security_group_referencing_support: "enable", ...over.attB }),
    res("aws_route_table", "a", { id: "rtb-a", vpc_id: "vpc-a", route: over.routeA ?? [{ cidr_block: "10.1.0.0/16", transit_gateway_id: "tgw-1" }] }),
    res("aws_route_table", "b", { id: "rtb-b", vpc_id: "vpc-b", route: over.routeB ?? [{ cidr_block: "10.0.0.0/16", transit_gateway_id: "tgw-1" }] }),
    res("aws_route_table_association", "a", { id: "ra", subnet_id: "subnet-a", route_table_id: "rtb-a" }),
    res("aws_route_table_association", "b", { id: "rb", subnet_id: "subnet-b", route_table_id: "rtb-b" }),
    res("aws_security_group", "web", { id: "sg-web", vpc_id: "vpc-a", ingress: [], egress: over.webEgress ?? all }),
    res("aws_security_group", "db", { id: "sg-db", vpc_id: "vpc-b", ingress: over.dbIngress ?? [fromWeb], egress: all }),
    res("aws_instance", "web", { id: "i-web", subnet_id: "subnet-a", vpc_security_group_ids: ["sg-web"], associate_public_ip_address: false, network_interface: [] }),
    res("aws_instance", "db", { id: "i-db", subnet_id: "subnet-b", vpc_security_group_ids: ["sg-db"], associate_public_ip_address: false, network_interface: [] }),
    ...extra,
  ];
}
const inside = (r: Res[]): Path => {
  const paths = analyze(plan(r)).paths.filter((p) => p.from === "aws_instance.web" && p.to === "aws_instance.db");
  expect(paths).toHaveLength(1);
  return paths[0] as Path;
};
const hop = (p: Path, kind: string) => p.after.hops.find((h) => h.hop === kind);

describe("paths between VPCs through a transit gateway", () => {
  it("allows a path through the default route table with propagated routes", () => {
    const p = inside(transit());
    expect(p.after.verdict).toBe("allowed");
    expect(hop(p, "source-route")?.rule).toMatch(/aws_ec2_transit_gateway\.hub/);
    expect(hop(p, "source-route")?.rule).toMatch(/propagated from aws_ec2_transit_gateway_vpc_attachment\.b/);
    expect(hop(p, "target-route")?.rule).toMatch(/propagated from aws_ec2_transit_gateway_vpc_attachment\.a/);
  });

  it("does not match a group reference when the transit gateway has referencing turned off", () => {
    const off = inside(transit({ tgw: { security_group_referencing_support: "disable" } }));
    expect(off.after.verdict).toBe("blocked");
    expect(hop(off, "security-group")?.decision).toBe("deny");
    expect(off.after.reason).toMatch(/security group referencing/);
    const cidr = inside(transit({ tgw: { security_group_referencing_support: "disable" }, dbIngress: [fromWeb, sgRule(5432, 5432, ["10.0.1.0/24"])] }));
    expect(cidr.after.verdict).toBe("allowed");
  });

  it("returns unknown when referencing on an attachment is unknown until apply", () => {
    const att = { security_group_referencing_support: null };
    const p = analyze(plan(transit({}, []).map((r) => (r.name === "a" && r.type === "aws_ec2_transit_gateway_vpc_attachment" ? { ...r, after: { ...r.after, ...att }, unknown: { security_group_referencing_support: true }, config: { security_group_referencing_support: ["var.refs"] } } : r))));
    const path = p.paths.find((x) => x.from === "aws_instance.web" && x.to === "aws_instance.db");
    expect(path?.after.verdict).toBe("unknown");
    expect(path?.after.reason).toMatch(/security_group_referencing_support/);
  });

  it("uses the attachment default for referencing when the plan leaves it to the provider", () => {
    const p = analyze(plan(transit({ attA: { security_group_referencing_support: null } }).map((r) => (r.name === "a" && r.type === "aws_ec2_transit_gateway_vpc_attachment" ? { ...r, unknown: { security_group_referencing_support: true } } : r))));
    expect(p.paths.find((x) => x.from === "aws_instance.web" && x.to === "aws_instance.db")?.after.verdict).toBe("allowed");
  });

  it("never matches an outbound rule that names a group across a transit gateway", () => {
    const p = inside(transit({ webEgress: [{ ...sgRule(5432, 5432, []), security_groups: ["sg-db"] }] }));
    expect(p.after.verdict).toBe("blocked");
    expect(hop(p, "source-security-group")?.decision).toBe("deny");
    expect(p.after.reason).toMatch(/outbound rules cannot reference/);
  });

  it("blocks at a blackhole route; a static route wins over a propagated one", () => {
    const hole = res("aws_ec2_transit_gateway_route", "hole", { id: "r1", destination_cidr_block: "10.1.0.0/16", blackhole: true, transit_gateway_attachment_id: null, transit_gateway_route_table_id: "tgw-rtb-default" });
    const p = inside(transit({}, [hole]));
    expect(p.after.verdict).toBe("blocked");
    expect(hop(p, "source-route")?.decision).toBe("deny");
    expect(p.after.reason).toMatch(/blackhole/);
  });

  it("blocks when a static route sends the subnet to a third VPC", () => {
    const c = [
      res("aws_vpc", "c", { id: "vpc-c", cidr_block: "10.2.0.0/16", default_network_acl_id: "acl-c" }),
      res("aws_subnet", "c", { id: "subnet-c", vpc_id: "vpc-c", cidr_block: "10.2.1.0/24", availability_zone: "us-east-1a", map_public_ip_on_launch: false }),
      res("aws_ec2_transit_gateway_vpc_attachment", "c", { id: "tgw-attach-c", transit_gateway_id: "tgw-1", vpc_id: "vpc-c", subnet_ids: ["subnet-c"], transit_gateway_default_route_table_association: true, transit_gateway_default_route_table_propagation: true, security_group_referencing_support: "enable" }),
      res("aws_ec2_transit_gateway_route", "wrong", { id: "r2", destination_cidr_block: "10.1.0.0/16", blackhole: false, transit_gateway_attachment_id: "tgw-attach-c", transit_gateway_route_table_id: "tgw-rtb-default" }),
    ];
    const p = inside(transit({}, c));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/aws_ec2_transit_gateway_vpc_attachment\.c/);
  });

  it("blocks an attachment without a route table association", () => {
    const p = inside(transit({ attA: { transit_gateway_default_route_table_association: false } }));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/not associated with a transit gateway route table/);
  });

  it("follows the attachment flags when the gateway turns off auto-association but has a default table", () => {
    // The provider associates and propagates each attachment whose flags are true.
    expect(inside(transit({ tgw: { default_route_table_association: "disable" } })).after.verdict).toBe("allowed");
    const none = inside(transit({ tgw: { default_route_table_association: "disable", default_route_table_propagation: "disable" } }));
    expect(none.after.verdict).toBe("blocked");
    expect(none.after.reason).toMatch(/not associated/);
  });

  it("keeps an outbound rule with a group and an unresolved prefix list unknown", () => {
    const egress = { ...sgRule(5432, 5432, []), security_groups: ["sg-db"], prefix_list_ids: ["pl-elsewhere"] };
    const p = inside(transit({ webEgress: [egress] }));
    expect(p.after.verdict).toBe("unknown");
    expect(hop(p, "source-security-group")?.decision).toBe("unknown");
  });

  it("follows explicit associations and propagations; an isolated table blocks the response", () => {
    const explicit = { transit_gateway_default_route_table_association: false, transit_gateway_default_route_table_propagation: false };
    const tables = [
      res("aws_ec2_transit_gateway_route_table", "a", { id: "tgw-rtb-a", transit_gateway_id: "tgw-1" }),
      res("aws_ec2_transit_gateway_route_table", "b", { id: "tgw-rtb-b", transit_gateway_id: "tgw-1" }),
      res("aws_ec2_transit_gateway_route_table_association", "a", { id: "as-a", transit_gateway_attachment_id: "tgw-attach-a", transit_gateway_route_table_id: "tgw-rtb-a", replace_existing_association: false }),
      res("aws_ec2_transit_gateway_route_table_association", "b", { id: "as-b", transit_gateway_attachment_id: "tgw-attach-b", transit_gateway_route_table_id: "tgw-rtb-b", replace_existing_association: false }),
      res("aws_ec2_transit_gateway_route_table_propagation", "b-to-a", { id: "pr-1", transit_gateway_attachment_id: "tgw-attach-b", transit_gateway_route_table_id: "tgw-rtb-a" }),
    ];
    const oneWay = inside(transit({ attA: explicit, attB: explicit }, tables));
    expect(oneWay.after.verdict).toBe("blocked");
    expect(hop(oneWay, "source-route")?.decision).toBe("allow");
    expect(hop(oneWay, "target-route")?.decision).toBe("deny");
    const back = res("aws_ec2_transit_gateway_route_table_propagation", "a-to-b", { id: "pr-2", transit_gateway_attachment_id: "tgw-attach-a", transit_gateway_route_table_id: "tgw-rtb-b" });
    expect(inside(transit({ attA: explicit, attB: explicit }, [...tables, back])).after.verdict).toBe("allowed");
  });

  it("blocks a source in an Availability Zone without an attachment subnet; unknown zone is unknown", () => {
    // The attachment uses its own subnet in us-east-1a; the source subnet moves to us-east-1b.
    const tgwSubnet = res("aws_subnet", "a_tgw", { id: "subnet-a-tgw", vpc_id: "vpc-a", cidr_block: "10.0.9.0/28", availability_zone: "us-east-1a", map_public_ip_on_launch: false });
    const other = inside(transit({ subnetA: { availability_zone: "us-east-1b" }, attA: { subnet_ids: ["subnet-a-tgw"] } }, [tgwSubnet]));
    expect(other.after.verdict).toBe("blocked");
    expect(other.after.reason).toMatch(/us-east-1b/);
    const r = transit().map((x) => (x.type === "aws_subnet" && x.name === "a" ? { ...x, after: { ...x.after, availability_zone: null }, unknown: { availability_zone: true } } : x));
    expect(inside(r).after.verdict).toBe("unknown");
  });

  it("returns unknown for overlapping VPC CIDR blocks", () => {
    const p = inside(transit({ vpcB: { cidr_block: "10.0.0.0/16" } }));
    expect(p.after.verdict).toBe("unknown");
  });

  it("returns unknown for a transit gateway outside the plan", () => {
    const p = inside(transit({ routeA: [{ cidr_block: "10.1.0.0/16", transit_gateway_id: "tgw-elsewhere" }] }));
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.reason).toMatch(/tgw-elsewhere/);
  });

  it("returns unknown when an unmodeled resource changes the transit gateway's routing", () => {
    const d = res("aws_ec2_transit_gateway_default_route_table_association", "x", { id: "d1", transit_gateway_id: "tgw-1", transit_gateway_route_table_id: "tgw-rtb-other" });
    const p = inside(transit({}, [d]));
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.reason).toMatch(/not modeled yet/);
  });

  it("resolves the default route table through a configuration reference", () => {
    const hole = res("aws_ec2_transit_gateway_route", "hole", { id: null, destination_cidr_block: "10.1.0.0/16", blackhole: true, transit_gateway_attachment_id: null, transit_gateway_route_table_id: null }, { unknown: { id: true, transit_gateway_route_table_id: true } });
    const r = transit({ tgw: { association_default_route_table_id: null } }, [hole]).map((x) => (x.type === "aws_ec2_transit_gateway" ? { ...x, unknown: { association_default_route_table_id: true } } : x));
    // The route's table is `aws_ec2_transit_gateway.hub.association_default_route_table_id`.
    const p = plan(r) as { configuration: { root_module: { resources: { address: string; expressions: Record<string, unknown> }[] } } };
    const entry = p.configuration.root_module.resources.find((e) => e.address === "aws_ec2_transit_gateway_route.hole");
    if (entry) entry.expressions.transit_gateway_route_table_id = { references: ["aws_ec2_transit_gateway.hub.association_default_route_table_id", "aws_ec2_transit_gateway.hub"] };
    const path = analyze(p).paths.find((x) => x.from === "aws_instance.web" && x.to === "aws_instance.db");
    expect(path?.after.verdict).toBe("blocked");
  });
});
