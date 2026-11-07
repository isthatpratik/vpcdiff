// Route targets in the response path of an internet connection (issue #33, part 1).
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, type Res, type Values } from "./testkit.js";

const rt = (route: Values[]): Res => ({ type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route } });
const nat: Res = { type: "aws_nat_gateway", name: "main", after: { id: "nat-1", subnet_id: "subnet-1" } };
const path = (routes: Values[], extra: Res[] = []) => only(analyze(plan(network({ rt: rt(routes) }, extra))).paths);

describe("route targets for the response", () => {
  it("blocks a response routed to a NAT gateway", () => {
    const p = path([{ cidr_block: "0.0.0.0/0", nat_gateway_id: "nat-1" }], [nat]);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/a NAT gateway does not carry traffic for connections that start on the internet/);
  });

  it("blocks a NAT gateway given in gateway_id", () => {
    expect(path([{ cidr_block: "0.0.0.0/0", gateway_id: "nat-1" }], [nat]).after.verdict).toBe("blocked");
  });

  it("blocks a response routed to a VPC peering connection", () => {
    const p = path([{ cidr_block: "0.0.0.0/0", vpc_peering_connection_id: "pcx-1" }]);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/no edge to edge routing/);
  });

  it("allows only the sources whose responses use the internet gateway", () => {
    const p = path([{ cidr_block: "0.0.0.0/0", nat_gateway_id: "nat-1" }, { cidr_block: "203.0.113.0/24", gateway_id: "igw-1" }], [nat]);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["203.0.113.0/24"]);
  });

  it("blocks a blackhole route", () => {
    const r: Res = { type: "aws_route", name: "x", after: { id: "r-1", route_table_id: "rtb-1", destination_cidr_block: "0.0.0.0/0", gateway_id: "igw-1", state: "blackhole" } };
    const p = only(analyze(plan(network({ rt: rt([]) }, [r]))).paths);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/route state blackhole/);
  });

  it("keeps a transit gateway route unknown: its routing continues outside the plan", () => {
    expect(path([{ cidr_block: "0.0.0.0/0", transit_gateway_id: "tgw-1" }]).after.verdict).toBe("unknown");
  });
});
