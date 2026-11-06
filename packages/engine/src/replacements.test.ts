import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, sgRule, type Res } from "./testkit.js";

const sg = (actions: string[]): Res => ({ type: "aws_security_group", name: "app", actions, before: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] }, after: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] } });

describe("outage risk from replacements", () => {
  it("flags a resource on a kept path that the plan deletes before it creates the new one", () => {
    const p = only(analyze(plan(network({ sg: sg(["delete", "create"]) }))).paths);
    expect(p.change).toBe("unchanged");
    expect(p.outageRisk).toEqual(["aws_security_group.app"]);
  });

  it("does not flag create_before_destroy replacements", () => {
    expect(only(analyze(plan(network({ sg: sg(["create", "delete"]) }))).paths).outageRisk).toBeUndefined();
  });

  it("flags the endpoint itself", () => {
    const instance: Res = { type: "aws_instance", name: "app", actions: ["delete", "create"], after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: true, network_interface: [] } };
    expect(only(analyze(plan(network({ instance }))).paths).outageRisk).toEqual(["aws_instance.app"]);
  });

  it("does not flag paths that only exist after the plan", () => {
    const instance: Res = { type: "aws_instance", name: "app", before: null, after: { subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: true, network_interface: [] } };
    expect(only(analyze(plan(network({ instance, sg: sg(["delete", "create"]) }))).paths).outageRisk).toBeUndefined();
  });
});

describe("outage risk from contributing resources", () => {
  const emptySg: Res = { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [] } };
  const replaced = (r: Res): Res => ({ ...r, actions: ["delete", "create"], before: r.after ?? null });

  it("flags a replaced security group rule resource", () => {
    const rule = replaced({ type: "aws_security_group_rule", name: "https", after: { id: "sgrule-1", type: "ingress", security_group_id: "sg-1", protocol: "tcp", from_port: 443, to_port: 443, cidr_blocks: ["0.0.0.0/0"], prefix_list_ids: [] } });
    expect(only(analyze(plan(network({ sg: emptySg }, [rule]))).paths).outageRisk).toEqual(["aws_security_group_rule.https"]);
  });

  it("flags a replaced route table association", () => {
    const assoc = replaced({ type: "aws_route_table_association", name: "a", after: { id: "rtbassoc-1", subnet_id: "subnet-1", route_table_id: "rtb-1" } });
    expect(only(analyze(plan(network({ assoc }))).paths).outageRisk).toEqual(["aws_route_table_association.a"]);
  });

  it("flags a replaced aws_route", () => {
    const rt: Res = { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [] } };
    const route = replaced({ type: "aws_route", name: "internet", after: { id: "r-1", route_table_id: "rtb-1", destination_cidr_block: "0.0.0.0/0", gateway_id: "igw-1" } });
    expect(only(analyze(plan(network({ rt }, [route]))).paths).outageRisk).toEqual(["aws_route.internet"]);
  });

  it("flags a replaced Elastic IP", () => {
    const priv: Res = { type: "aws_instance", name: "app", after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, network_interface: [] } };
    const eip = replaced({ type: "aws_eip", name: "app", after: { id: "eipalloc-1", instance: "i-1", network_interface: null, domain: "vpc" } });
    expect(only(analyze(plan(network({ instance: priv }, [eip]))).paths).outageRisk).toEqual(["aws_eip.app"]);
  });

  it("does not flag managed default resources, which Terraform does not delete", () => {
    const vpc: Res = { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1", default_route_table_id: "rtb-main", main_route_table_id: "rtb-main", default_security_group_id: "sg-default" } };
    const def = replaced({ type: "aws_default_route_table", name: "main", after: { id: "rtb-main", default_route_table_id: "rtb-main", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] } });
    expect(only(analyze(plan(network({ vpc, assoc: null }, [def]))).paths).outageRisk).toBeUndefined();
  });
});
