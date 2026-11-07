// Security group references and egress rules in the model (issue #32, part 1). Internet
// paths ignore group sources; these tests check that the model reads them correctly.
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { ModelBuilder, type Endpoint, type SecurityGroup } from "./model.js";
import { parsePlan } from "./plan.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const lbSg: Res = { type: "aws_security_group", name: "lb", after: { id: "sg-lb", vpc_id: "vpc-1", ingress: [], egress: [] } };
const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });

function endpoint(resources: Res[], address = "aws_instance.app"): Endpoint {
  const ep = new ModelBuilder(parsePlan(plan(resources)).after).endpoints().find((e) => e.address === address);
  if (!ep) throw new Error(`no endpoint ${address}`);
  return ep;
}
function groups(ep: Endpoint): SecurityGroup[] {
  if (!ep.securityGroups.ok) throw new Error(ep.securityGroups.reason);
  return ep.securityGroups.value;
}
const ingressOf = (ep: Endpoint) => groups(ep).flatMap((g) => (g.ingress.ok ? g.ingress.value : []));
const egressOf = (ep: Endpoint) => groups(ep).flatMap((g) => (g.egress.ok ? g.egress.value : []));

describe("security group references", () => {
  it("reads an inline rule whose source is another group by known ID", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: ["sg-lb"] }], egress: [] });
    const [rule] = ingressOf(endpoint(network({ sg }, [lbSg])));
    expect(rule?.groups).toEqual(["aws_security_group.lb"]);
    expect(rule?.sources).toEqual([]);
    expect(rule?.text).toBe("aws_security_group.app ingress tcp 8080 from aws_security_group.lb");
  });

  it("matches an unknown group ID through the configuration when one block lists groups", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"]), { ...sgRule(8080, 8080, []), security_groups: null }], egress: [] }, { unknown: { ingress: [{}, { security_groups: true }] }, config: { ingress: ["aws_security_group.lb"] } });
    const rules = ingressOf(endpoint(network({ sg }, [{ ...lbSg, after: { ...lbSg.after, id: null }, unknown: { id: true } }])));
    expect(rules.map((r) => r.groups)).toEqual([[], ["aws_security_group.lb"]]);
  });

  it("leaves an unknown group ID unresolved when two blocks list groups", () => {
    const other = { ...sgRule(22, 22, []), security_groups: ["sg-lb"] };
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [other, { ...sgRule(8080, 8080, []), security_groups: null }], egress: [] }, { unknown: { ingress: [{}, { security_groups: true }] }, config: { ingress: ["aws_security_group.lb", "aws_security_group.bastion"] } });
    const rules = ingressOf(endpoint(network({ sg }, [lbSg])));
    expect(rules[1]?.unresolved).toMatch(/cannot be matched to resources/);
  });

  it("matches a VPC's default group named through the configuration", () => {
    const vpc: Res = { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1", default_security_group_id: "sg-default" } };
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: [null, null] }], egress: [] }, { unknown: { ingress: [{ security_groups: [true, true] }] } });
    const withConfig = plan(network({ vpc, sg }, [lbSg]));
    // aws_security_group.lb.id and aws_vpc.main.default_security_group_id, as Terraform writes them.
    const cfg = (withConfig as { configuration: { root_module: { resources: { address: string; expressions: Record<string, unknown> }[] } } }).configuration.root_module.resources.find((x) => x.address === "aws_security_group.app");
    if (cfg) cfg.expressions.ingress = [{ security_groups: { references: ["aws_security_group.lb.id", "aws_security_group.lb", "aws_vpc.main.default_security_group_id", "aws_vpc.main"] } }];
    const ep = new ModelBuilder(parsePlan(withConfig).after).endpoints()[0] as Endpoint;
    expect(ingressOf(ep)[0]?.groups).toEqual(["aws_security_group.lb", "default-sg:aws_vpc.main"]);
    expect(ingressOf(ep)[0]?.unresolved).toBeUndefined();
  });

  it("leaves unknown group IDs unresolved when the count does not match the configuration", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: [null, null] }], egress: [] }, { unknown: { ingress: [{ security_groups: [true, true] }] }, config: { ingress: ["aws_security_group.lb"] } });
    expect(ingressOf(endpoint(network({ sg }, [lbSg])))[0]?.unresolved).toMatch(/cannot be matched/);
  });

  it("leaves unknown group IDs unresolved when the configuration names another kind of resource", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: null }], egress: [] }, { unknown: { ingress: [{ security_groups: true }] }, config: { ingress: ["aws_instance.app"] } });
    expect(ingressOf(endpoint(network({ sg })))[0]?.unresolved).toMatch(/cannot be matched/);
  });

  it("keeps internet paths decided when a group ID is unknown until apply", () => {
    // Before #32, any unknown value in an inline block made the whole group unknown.
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"]), { ...sgRule(8080, 8080, []), security_groups: null }], egress: [] }, { unknown: { ingress: [{}, { security_groups: true }] }, config: { ingress: ["var.lb_sg"] } });
    const p = only(analyze(plan(network({ sg }))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.ports).toBe("443");
  });

  it("reads self as the rule's own group", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(5432, 5432, []), self: true }], egress: [] });
    expect(ingressOf(endpoint(network({ sg })))[0]?.groups).toEqual(["aws_security_group.app"]);
  });

  it("reads aws_security_group_rule with source_security_group_id and self", () => {
    const empty = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [] });
    const base = { type: "ingress", security_group_id: "sg-1", protocol: "tcp", from_port: 8080, to_port: 8080, cidr_blocks: [], prefix_list_ids: [] };
    const fromLb = res("aws_security_group_rule", "lb", { id: "r-1", ...base, source_security_group_id: "sg-lb", self: false });
    const self = res("aws_security_group_rule", "self", { id: "r-2", ...base, source_security_group_id: null, self: true });
    expect(ingressOf(endpoint(network({ sg: empty }, [lbSg, fromLb, self]))).map((r) => r.groups)).toEqual([["aws_security_group.lb"], ["aws_security_group.app"]]);
  });

  it("reads aws_vpc_security_group_ingress_rule with referenced_security_group_id in a module", () => {
    const mod: [string, string] = ["svc", ""];
    const rule = res("aws_vpc_security_group_ingress_rule", "lb", { id: null, security_group_id: "sg-1", ip_protocol: "tcp", from_port: 8080, to_port: 8080, cidr_ipv4: null, prefix_list_id: null, referenced_security_group_id: null }, { module: mod, unknown: { id: true, referenced_security_group_id: true }, config: { referenced_security_group_id: ["aws_security_group.lb"] } });
    const lb = { ...lbSg, module: mod };
    const empty = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [] });
    expect(ingressOf(endpoint(network({ sg: empty }, [lb, rule])))[0]?.groups).toEqual(["module.svc.aws_security_group.lb"]);
  });

  it("ignores a referenced group outside the plan: none of its members are in the plan", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: ["sg-elsewhere"] }], egress: [] });
    expect(ingressOf(endpoint(network({ sg })))).toEqual([]);
  });

  it("handles groups that reference each other", () => {
    const a = res("aws_security_group", "app", { id: "sg-1", ingress: [{ ...sgRule(8080, 8080, []), security_groups: ["sg-lb"] }], egress: [{ ...sgRule(5432, 5432, []), security_groups: ["sg-lb"] }] });
    const b = { ...lbSg, after: { ...lbSg.after, ingress: [{ ...sgRule(9000, 9000, []), security_groups: ["sg-1"] }] } };
    const ep = endpoint(network({ sg: a }, [b]));
    expect(ingressOf(ep)[0]?.groups).toEqual(["aws_security_group.lb"]);
    expect(egressOf(ep)[0]?.groups).toEqual(["aws_security_group.lb"]);
  });
});

describe("security group egress", () => {
  it("reads inline egress rules to CIDRs", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [sgRule(0, 0, ["0.0.0.0/0"], "-1")] });
    const [rule] = egressOf(endpoint(network({ sg })));
    expect(rule?.text).toBe("aws_security_group.app egress all traffic to 0.0.0.0/0");
  });

  it("has no outbound rules for a Terraform group without egress", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: null }, { unknown: { egress: true } });
    expect(egressOf(endpoint(network({ sg })))).toEqual([]);
  });

  it("adds aws_vpc_security_group_egress_rule and egress aws_security_group_rule", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [] });
    const modern = res("aws_vpc_security_group_egress_rule", "db", { id: "sgr-1", security_group_id: "sg-1", ip_protocol: "tcp", from_port: 5432, to_port: 5432, cidr_ipv4: "10.0.2.0/24", prefix_list_id: null, referenced_security_group_id: null });
    const legacy = res("aws_security_group_rule", "lb", { id: "r-1", type: "egress", security_group_id: "sg-1", protocol: "tcp", from_port: 80, to_port: 80, cidr_blocks: [], prefix_list_ids: [], source_security_group_id: "sg-lb", self: false });
    const rules = egressOf(endpoint(network({ sg }, [lbSg, modern, legacy])));
    expect(rules.map((r) => r.text).toSorted()).toEqual(["aws_security_group_rule.lb egress tcp 80 to aws_security_group.lb", "aws_vpc_security_group_egress_rule.db egress tcp 5432 to 10.0.2.0/24"]);
  });

  it("gives the unmanaged default group its AWS rules: in from itself, out to anywhere", () => {
    const instance = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: [], associate_public_ip_address: false, network_interface: [] });
    const [g] = groups(endpoint(network({ sg: null, instance })));
    expect(g?.key).toBe("default-sg:aws_vpc.main");
    expect(g?.ingress.ok && g.ingress.value.map((r) => r.text)).toEqual(["default security group of aws_vpc.main ingress all traffic from default security group of aws_vpc.main (AWS default)"]);
    expect(g?.egress.ok && g.egress.value.map((r) => r.text)).toEqual(["default security group of aws_vpc.main egress all traffic to 0.0.0.0/0 (AWS default)"]);
  });

  it("reads the subnet CIDR of an endpoint", () => {
    const ep = endpoint(network());
    expect(ep.subnetCidr).toEqual({ ok: true, value: [[167772416, 167772671]] });
  });
});
