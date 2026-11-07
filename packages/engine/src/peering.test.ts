// Paths inside the VPC across a VPC peering connection (issue #33, part 4).
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "./index.js";
import { only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const all = [sgRule(0, 0, ["0.0.0.0/0"], "-1")];

/** web in VPC A (10.0.0.0/16) reaches db in VPC B (10.1.0.0/16) on 5432 through pcx-1. */
function peered(over: { pcx?: Values; routeA?: Values[]; routeB?: Values[]; vpcB?: Values } = {}): Res[] {
  return [
    res("aws_vpc", "a", { id: "vpc-a", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-a" }),
    res("aws_vpc", "b", { id: "vpc-b", cidr_block: "10.1.0.0/16", default_network_acl_id: "acl-b", ...over.vpcB }),
    res("aws_subnet", "a", { id: "subnet-a", vpc_id: "vpc-a", cidr_block: "10.0.1.0/24", map_public_ip_on_launch: false }),
    res("aws_subnet", "b", { id: "subnet-b", vpc_id: "vpc-b", cidr_block: "10.1.1.0/24", map_public_ip_on_launch: false }),
    res("aws_vpc_peering_connection", "ab", { id: "pcx-1", vpc_id: "vpc-a", peer_vpc_id: "vpc-b", auto_accept: true, ...over.pcx }),
    res("aws_route_table", "a", { id: "rtb-a", vpc_id: "vpc-a", route: over.routeA ?? [{ cidr_block: "10.1.0.0/16", vpc_peering_connection_id: "pcx-1" }] }),
    res("aws_route_table", "b", { id: "rtb-b", vpc_id: "vpc-b", route: over.routeB ?? [{ cidr_block: "10.0.0.0/16", vpc_peering_connection_id: "pcx-1" }] }),
    res("aws_route_table_association", "a", { id: "ra", subnet_id: "subnet-a", route_table_id: "rtb-a" }),
    res("aws_route_table_association", "b", { id: "rb", subnet_id: "subnet-b", route_table_id: "rtb-b" }),
    res("aws_security_group", "web", { id: "sg-web", vpc_id: "vpc-a", ingress: [], egress: all }),
    res("aws_security_group", "db", { id: "sg-db", vpc_id: "vpc-b", ingress: [{ ...sgRule(5432, 5432, []), security_groups: ["sg-web"] }], egress: all }),
    res("aws_instance", "web", { id: "i-web", subnet_id: "subnet-a", vpc_security_group_ids: ["sg-web"], associate_public_ip_address: false, network_interface: [] }),
    res("aws_instance", "db", { id: "i-db", subnet_id: "subnet-b", vpc_security_group_ids: ["sg-db"], associate_public_ip_address: false, network_interface: [] }),
  ];
}
const inside = (r: Res[]): Path => only(analyze(plan(r)).paths.filter((p) => p.from !== "internet"));

describe("paths across a VPC peering connection", () => {
  it("allows a path when both route tables use an active peering connection", () => {
    const p = inside(peered());
    expect(p).toMatchObject({ from: "aws_instance.web", to: "aws_instance.db", ports: "5432" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops.find((h) => h.hop === "source-route")?.rule).toMatch(/pcx|peering/);
  });

  it("blocks when the target's route table has no route back", () => {
    const p = inside(peered({ routeB: [] }));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)?.hop).toBe("target-route");
  });

  it("returns unknown when the connection is not accepted in the plan", () => {
    expect(inside(peered({ pcx: { auto_accept: false } })).after.reason).toMatch(/not accepted in this plan/);
  });

  it("does not trust auto_accept across Regions or accounts", () => {
    expect(inside(peered({ pcx: { peer_region: "eu-west-1" } })).after.reason).toMatch(/not accepted in this plan/);
    expect(inside(peered({ pcx: { peer_owner_id: "123456789012" } })).after.verdict).toBe("unknown");
  });

  it("accepts through aws_vpc_peering_connection_accepter", () => {
    const acc = res("aws_vpc_peering_connection_accepter", "b", { id: "pcx-1", vpc_peering_connection_id: "pcx-1", auto_accept: true });
    expect(inside([...peered({ pcx: { auto_accept: false } }), acc]).after.verdict).toBe("allowed");
  });

  it("returns unknown for VPCs with overlapping CIDR blocks", () => {
    expect(inside(peered({ vpcB: { cidr_block: "10.0.0.0/16" } })).after.reason).toMatch(/overlapping CIDR blocks/);
  });

  it("blocks when the route uses a connection to another VPC", () => {
    const other = res("aws_vpc", "c", { id: "vpc-c", cidr_block: "10.2.0.0/16", default_network_acl_id: "acl-c" });
    const pcx2 = res("aws_vpc_peering_connection", "ac", { id: "pcx-2", vpc_id: "vpc-a", peer_vpc_id: "vpc-c", auto_accept: true });
    const p = inside([...peered({ routeA: [{ cidr_block: "10.1.0.0/16", vpc_peering_connection_id: "pcx-2" }] }), other, pcx2]);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/joins aws_vpc.a and aws_vpc.c/);
  });
});
