// Gateway and interface VPC endpoints (issue #33, part 3).
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });

describe("gateway endpoints", () => {
  const s3 = (tables: string[]) => res("aws_vpc_endpoint", "s3", { id: "vpce-s3", vpc_endpoint_type: "Gateway", service_name: "com.amazonaws.us-east-1.s3", route_table_ids: tables });

  it("keeps the internet path decided and reports the service prefix list as undecided", () => {
    const p = only(analyze(plan(network({}, [s3(["rtb-1"])]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.reason).toMatch(/the service prefix list of aws_vpc_endpoint.s3 is managed by AWS/);
  });

  it("adds the route through aws_vpc_endpoint_route_table_association too", () => {
    const assoc = res("aws_vpc_endpoint_route_table_association", "s3", { id: "a-1", vpc_endpoint_id: "vpce-s3", route_table_id: "rtb-1" });
    expect(only(analyze(plan(network({}, [s3([]), assoc]))).paths).after.reason).toMatch(/gateway endpoint/);
  });

  it("returns unknown when a listed route table is outside the plan: it may be any table", () => {
    expect(only(analyze(plan(network({}, [s3(["rtb-other"])]))).paths).after.verdict).toBe("unknown");
  });

  it("finds the VPC's main route table by its known ID", () => {
    const vpc = res("aws_vpc", "main", { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1", default_route_table_id: "rtb-main", main_route_table_id: "rtb-main" });
    const igwRoute = res("aws_default_route_table", "main", { id: "rtb-main", default_route_table_id: "rtb-main", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] });
    const p = only(analyze(plan(network({ vpc, rt: null, assoc: null }, [igwRoute, s3(["rtb-main"])]))).paths);
    expect(p.after.reason).toMatch(/gateway endpoint aws_vpc_endpoint.s3/);
  });

  it("makes its route tables unknown when the endpoint type is unknown", () => {
    const e = { ...s3(["rtb-1"]), unknown: { vpc_endpoint_type: true }, config: { vpc_endpoint_type: ["var.type"] } };
    expect(only(analyze(plan(network({}, [e]))).paths.filter((p) => p.to === "aws_instance.app")).after.verdict).toBe("unknown");
  });
});

describe("interface endpoints", () => {
  const app = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [sgRule(0, 0, ["0.0.0.0/0"], "-1")] });
  const epSg = res("aws_security_group", "ep", { id: "sg-ep", ingress: [{ ...sgRule(443, 443, []), security_groups: ["sg-1"] }], egress: [] });
  const ep = (over: Values = {}) => res("aws_vpc_endpoint", "ssm", { id: "vpce-ssm", vpc_endpoint_type: "Interface", service_name: "com.amazonaws.us-east-1.ssm", subnet_ids: ["subnet-1"], security_group_ids: ["sg-ep"], ...over });

  it("is a target for paths inside the VPC", () => {
    const paths = analyze(plan(network({ sg: app }, [epSg, ep()]))).paths.filter((p) => p.from !== "internet");
    const p = only(paths);
    expect(p).toMatchObject({ from: "aws_instance.app", to: "aws_vpc_endpoint.ssm", toType: "aws_vpc_endpoint", ports: "443" });
    expect(p.after.verdict).toBe("allowed");
  });

  it("adds no doubt for a gateway endpoint route when the peer subnet is private", () => {
    const s3 = res("aws_vpc_endpoint", "s3", { id: "vpce-s3", vpc_endpoint_type: "Gateway", route_table_ids: ["rtb-1"] });
    const p = only(analyze(plan(network({ sg: app }, [epSg, ep(), s3]))).paths.filter((x) => x.from !== "internet"));
    expect(p.after.reason).toBe("");
  });

  it("is never reachable from the internet: its addresses are private", () => {
    const open = res("aws_security_group", "ep", { id: "sg-ep", ingress: [sgRule(443, 443, ["0.0.0.0/0"])], egress: [] });
    const p = analyze(plan(network({ sg: app }, [open, ep()]))).paths.find((x) => x.to === "aws_vpc_endpoint.ssm");
    expect(p?.after.verdict).toBe("blocked");
    expect(p?.after.hops[0]?.hop).toBe("public-ip");
  });

  it("notes a Gateway Load Balancer endpoint", () => {
    const gwlb = res("aws_vpc_endpoint", "fw", { id: "vpce-fw", vpc_endpoint_type: "GatewayLoadBalancer", subnet_ids: ["subnet-1"] });
    expect(analyze(plan(network({}, [gwlb]))).notes.map((n) => n.resource)).toEqual(["aws_vpc_endpoint.fw"]);
  });
});
