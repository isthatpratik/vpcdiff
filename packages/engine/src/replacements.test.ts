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
