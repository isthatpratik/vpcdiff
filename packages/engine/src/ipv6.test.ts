// IPv6 paths from the internet (issue #33, part 5).
import { describe, expect, it } from "vitest";
import { analyze, type Path } from "./index.js";
import { naclRule, network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const vpc6 = res("aws_vpc", "main", { id: "vpc-1", cidr_block: "10.0.0.0/16", ipv6_cidr_block: "2600:1f18:aa00::/56", default_network_acl_id: "acl-1" });
const sg6 = (cidrs6: string[], port = 443) => res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(port, port, []), ipv6_cidr_blocks: cidrs6 }], egress: [] });
const inst6 = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, ipv6_address_count: 1, network_interface: [] });
const rt6 = (route: Values[]) => res("aws_route_table", "a", { id: "rtb-1", vpc_id: "vpc-1", route });
const igw6 = { cidr_block: "", ipv6_cidr_block: "::/0", gateway_id: "igw-1" };
const v6 = (r: Res[]): Path[] => analyze(plan(r)).paths.filter((p) => p.family === "ipv6");

describe("IPv6 paths from the internet", () => {
  it("allows ::/0 to an instance with an IPv6 address through the internet gateway", () => {
    const p = only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([igw6]) })));
    expect(p).toMatchObject({ id: "internet6->aws_instance.app:tcp:443", from: "internet", family: "ipv6", ports: "443" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
  });

  it("blocks an instance without an IPv6 address", () => {
    const noV6 = { ...inst6, after: { ...inst6.after, ipv6_address_count: 0 } };
    expect(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: noV6, rt: rt6([igw6]) }))).toEqual([]);
  });

  it("blocks a response routed to an egress-only internet gateway", () => {
    const p = only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([{ cidr_block: "", ipv6_cidr_block: "::/0", egress_only_gateway_id: "eigw-1" }]) })));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.reason).toMatch(/egress-only internet gateway/);
  });

  it("keeps IPv4 and IPv6 rules apart", () => {
    const r = analyze(plan(network({ vpc: vpc6, sg: sg6(["2001:db8::/32"], 22), instance: inst6, rt: rt6([igw6]) })));
    expect(r.paths.filter((p) => !p.family)).toEqual([]);
    expect(only(r.paths).after.sources).toEqual(["2001:db8::/32"]);
  });

  it("applies IPv6 NACL entries; the default NACL allows IPv6 when the VPC has a block", () => {
    const acl = res("aws_network_acl", "a", { id: "acl-2", subnet_ids: ["subnet-1"], ingress: [{ ...naclRule(100, "allow", "-1", 0, 0), cidr_block: "", ipv6_cidr_block: "2001:db8::/32" }], egress: [{ ...naclRule(100, "allow", "-1", 0, 0), cidr_block: "", ipv6_cidr_block: "::/0" }] });
    const p = only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([igw6]) }, [acl])));
    expect(p.after.sources).toEqual(["2001:db8::/32"]);
    expect(only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([igw6]) }))).after.hops[2]?.rule).toMatch(/rule 101: allow all IPv6 traffic/);
  });

  it("returns unknown when the instance's IPv6 setting is unknown", () => {
    const u = { ...inst6, after: { ...inst6.after, ipv6_address_count: null }, unknown: { ipv6_address_count: true }, config: { ipv6_address_count: ["var.count"] } };
    expect(only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: u, rt: rt6([igw6]) }))).after.verdict).toBe("unknown");
  });

  it("returns unknown when the VPC's IPv6 blocks are not known", () => {
    const assoc = res("aws_vpc_ipv6_cidr_block_association", "x", { id: "a-1", vpc_id: "vpc-1" });
    expect(only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([igw6]) }, [assoc]))).after.verdict).toBe("unknown");
  });

  it("returns unknown when only a prefix list outside the plan could allow IPv6", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(443, 443, []), prefix_list_ids: ["pl-aws"] }], egress: [] });
    expect(only(v6(network({ vpc: vpc6, sg, instance: inst6, rt: rt6([igw6]) }))).after.verdict).toBe("unknown");
  });

  it("returns unknown for two IPv6 routes with the same destination", () => {
    const dup = res("aws_route", "dup", { id: "r-6", route_table_id: "rtb-1", destination_cidr_block: null, destination_ipv6_cidr_block: "::/0", egress_only_gateway_id: "eigw-1" });
    expect(only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: inst6, rt: rt6([igw6]) }, [dup]))).after.verdict).toBe("unknown");
  });

  it("gives a dual-stack internet-facing load balancer an IPv6 path", () => {
    const lb = res("aws_lb", "web", { id: "arn:lb", internal: false, load_balancer_type: "application", ip_address_type: "dualstack", subnets: ["subnet-1"], security_groups: ["sg-1"], subnet_mapping: [] });
    const p = only(v6(network({ vpc: vpc6, sg: sg6(["::/0"]), instance: null, rt: rt6([igw6]) }, [lb])));
    expect(p.to).toBe("aws_lb.web");
    expect(p.after.verdict).toBe("allowed");
  });
});
