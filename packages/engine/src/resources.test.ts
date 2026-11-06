import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { nacl, naclRule, network, only, plan, type Res, type Values } from "./testkit.js";

const emptySg: Res = { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [] } };
const noRoutes: Res = { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [] } };
const vpcWithDefaults: Res = { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1", default_route_table_id: "rtb-main", main_route_table_id: "rtb-main", default_security_group_id: "sg-default" } };
const verdicts = (r: ReturnType<typeof analyze>) => r.paths.map((p) => `${p.protocol}:${p.ports}:${p.after.verdict}`);
const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });

describe("security group rule resources", () => {
  const legacyRule = (over: Values = {}) => res("aws_security_group_rule", "https", { id: "sgrule-1", type: "ingress", security_group_id: "sg-1", protocol: "tcp", from_port: 443, to_port: 443, cidr_blocks: ["0.0.0.0/0"], prefix_list_ids: [], source_security_group_id: null, self: false, ...over });

  it("adds an aws_security_group_rule ingress rule to its group", () => {
    const p = only(analyze(plan(network({ sg: emptySg }, [legacyRule()]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops.find((h) => h.hop === "security-group")?.rule).toBe("aws_security_group_rule.https ingress tcp 443 from 0.0.0.0/0");
  });

  it("ignores egress rules: security groups are stateful", () => {
    expect(analyze(plan(network({ sg: emptySg }, [legacyRule({ type: "egress" })]))).paths).toEqual([]);
  });

  it("adds an aws_vpc_security_group_ingress_rule with all protocols", () => {
    const rule = res("aws_vpc_security_group_ingress_rule", "all", { id: "sgr-1", security_group_id: "sg-1", ip_protocol: "-1", from_port: null, to_port: null, cidr_ipv4: "0.0.0.0/0", cidr_ipv6: null, prefix_list_id: null, referenced_security_group_id: null });
    expect(verdicts(analyze(plan(network({ sg: emptySg }, [rule]))))).toEqual(["tcp:0-65535:allowed", "udp:0-65535:allowed"]);
  });

  it("returns unknown for a prefix list source", () => {
    const rule = res("aws_vpc_security_group_ingress_rule", "pl", { id: "sgr-1", security_group_id: "sg-1", ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: null, prefix_list_id: "pl-1" });
    expect(analyze(plan(network({ sg: emptySg }, [rule]))).paths.every((p) => p.after.verdict === "unknown")).toBe(true);
  });

  it("makes every group unknown when a rule's group cannot be resolved", () => {
    const rule = legacyRule({ security_group_id: null });
    const p = analyze(plan(network({}, [{ ...rule, unknown: { security_group_id: true }, config: { security_group_id: ["var.sg"] } }]))).paths;
    expect(p.every((x) => x.after.verdict === "unknown")).toBe(true);
  });

  it("reports a rule created by the plan as an added path", () => {
    const p = only(analyze(plan(network({ sg: emptySg }, [{ ...legacyRule(), before: null }]))).paths);
    expect(p.change).toBe("added");
  });
});

describe("route resources", () => {
  const route = (tableId: string) => res("aws_route", "internet", { id: "r-1", route_table_id: tableId, destination_cidr_block: "0.0.0.0/0", gateway_id: "igw-1" });

  it("adds an aws_route to its route table", () => {
    const p = only(analyze(plan(network({ rt: noRoutes }, [route("rtb-1")]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "route", decision: "allow", rule: "aws_route.internet 0.0.0.0/0 -> aws_internet_gateway.main" });
  });

  it("adds an aws_route to the VPC's unmanaged main route table", () => {
    const p = only(analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [route("rtb-main")]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ resource: "main route table of aws_vpc.main", decision: "allow" });
  });

  it("uses aws_default_route_table as the main route table", () => {
    const def = res("aws_default_route_table", "main", { id: "rtb-main", default_route_table_id: "rtb-main", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] });
    const p = only(analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [def]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ resource: "aws_default_route_table.main", decision: "allow" });
  });

  it("uses the table set by aws_main_route_table_association", () => {
    const main = res("aws_main_route_table_association", "m", { id: "rtbassoc-m", vpc_id: "vpc-1", route_table_id: "rtb-1" });
    const p = only(analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [main]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ resource: "aws_route_table.a", decision: "allow" });
  });

  it("links an aws_route through a reference when IDs are unknown", () => {
    const r: Res = { ...route(""), before: null, after: { route_table_id: null, destination_cidr_block: "0.0.0.0/0", gateway_id: null }, unknown: { id: true, route_table_id: true, gateway_id: true }, config: { route_table_id: ["aws_route_table.a"], gateway_id: ["aws_internet_gateway.main"] } };
    expect(only(analyze(plan(network({ rt: noRoutes }, [r]))).paths).after.verdict).toBe("allowed");
  });

  it("keeps VPN route propagation unknown", () => {
    const prop = res("aws_vpn_gateway_route_propagation", "p", { id: "p-1", route_table_id: "rtb-1", vpn_gateway_id: "vgw-1" });
    expect(only(analyze(plan(network({}, [prop]))).paths).after.verdict).toBe("unknown");
  });
});

describe("network ACL resources", () => {
  it("adds an aws_network_acl_rule to the VPC's default NACL", () => {
    const rule = res("aws_network_acl_rule", "deny", { id: "nacl-rule-1", network_acl_id: "acl-1", rule_number: 50, egress: false, protocol: "tcp", rule_action: "deny", cidr_block: "0.0.0.0/0", from_port: 443, to_port: 443 });
    const p = only(analyze(plan(network({ vpc: vpcWithDefaults }, [rule]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "nacl-inbound", resource: "default NACL of aws_vpc.main", decision: "deny", rule: "aws_network_acl_rule.deny ingress rule 50: deny tcp 443 from 0.0.0.0/0" });
  });

  it("uses the NACL set by aws_network_acl_association", () => {
    const acl = res("aws_network_acl", "b", { id: "acl-2", subnet_ids: [], ingress: [], egress: [] });
    const assoc = res("aws_network_acl_association", "b", { id: "aclassoc-1", network_acl_id: "acl-2", subnet_id: "subnet-1" });
    const p = only(analyze(plan(network({}, [acl, assoc]))).paths);
    expect(p.after.hops.at(-1)).toMatchObject({ hop: "nacl-inbound", resource: "aws_network_acl.b", decision: "deny", rule: "rule *: deny all traffic (implicit)" });
  });

  it("merges inline rules and aws_network_acl_rule resources by rule number", () => {
    const acl = nacl([naclRule(200, "allow", "-1", 0, 0)], [naclRule(100, "allow", "-1", 0, 0)]);
    const rule = res("aws_network_acl_rule", "deny", { id: "r", network_acl_id: "acl-2", rule_number: 100, egress: false, protocol: "6", rule_action: "deny", cidr_block: "0.0.0.0/0", from_port: 443, to_port: 443 });
    expect(only(analyze(plan(network({}, [acl, rule]))).paths).after.verdict).toBe("blocked");
  });
});

describe("default security group", () => {
  const instanceNoSg = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: [], associate_public_ip_address: true, network_interface: [] });

  it("uses aws_default_security_group for an instance without groups", () => {
    const def = res("aws_default_security_group", "d", { id: "sg-default", vpc_id: "vpc-1", ingress: [{ protocol: "tcp", from_port: 443, to_port: 443, cidr_blocks: ["0.0.0.0/0"], ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: [], self: false }] });
    const p = only(analyze(plan(network({ vpc: vpcWithDefaults, sg: null, instance: instanceNoSg }, [def]))).paths);
    expect(p.after.hops.find((h) => h.hop === "security-group")?.resource).toBe("aws_default_security_group.d");
  });

  it("treats the unmanaged default security group as having no internet rules", () => {
    expect(analyze(plan(network({ vpc: vpcWithDefaults, sg: null, instance: instanceNoSg }))).paths).toEqual([]);
  });
});

describe("public addresses and gateways", () => {
  const privateInstance = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, network_interface: [] });

  it("gives a public address through aws_eip", () => {
    const eip = res("aws_eip", "app", { id: "eipalloc-1", instance: "i-1", network_interface: null, domain: "vpc" });
    const p = only(analyze(plan(network({ instance: privateInstance }, [eip]))).paths);
    expect(p.after.hops[0]).toMatchObject({ hop: "public-ip", decision: "allow", rule: "aws_eip.app is associated with aws_instance.app" });
  });

  it("gives a public address through aws_eip_association", () => {
    const eip = res("aws_eip", "app", { id: "eipalloc-1", instance: null, network_interface: null, domain: "vpc" });
    const assoc = res("aws_eip_association", "app", { id: "eipassoc-1", instance_id: "i-1", allocation_id: "eipalloc-1", network_interface_id: null });
    expect(only(analyze(plan(network({ instance: privateInstance }, [eip, assoc]))).paths).after.verdict).toBe("allowed");
  });

  it("attaches an internet gateway through aws_internet_gateway_attachment", () => {
    const igw = res("aws_internet_gateway", "main", { id: "igw-1", vpc_id: null });
    const attach = res("aws_internet_gateway_attachment", "main", { id: "igw-1:vpc-1", internet_gateway_id: "igw-1", vpc_id: "vpc-1" });
    expect(only(analyze(plan(network({ igw }, [attach]))).paths).after.verdict).toBe("allowed");
  });
});

describe("second review findings", () => {
  it("1: keeps routes unknown when VPN propagation targets the default table through a reference", () => {
    const prop: Res = { type: "aws_vpn_gateway_route_propagation", name: "p", before: null, after: { route_table_id: null, vpn_gateway_id: "vgw-1" }, unknown: { id: true, route_table_id: true }, config: { route_table_id: ["aws_vpc.main", "aws_vpc.main.default_route_table_id"] } };
    const route = res("aws_route", "internet", { id: "r-1", route_table_id: "rtb-main", destination_cidr_block: "0.0.0.0/0", gateway_id: "igw-1" });
    expect(only(analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [route, prop]))).paths).after.verdict).toBe("unknown");
  });

  it("2: does not depend on address order for a route that targets the main table", () => {
    const route = res("aws_route", "r", { id: "r-1", route_table_id: "rtb-main", destination_cidr_block: "0.0.0.0/0", gateway_id: "igw-1" });
    const main = (module?: [string, string]): Res => ({ ...res("aws_main_route_table_association", "m", { id: "rtbassoc-m", vpc_id: "vpc-1", route_table_id: "rtb-1" }), ...(module ? { module } : {}) });
    const a = analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [route, main()])));
    const b = analyze(plan(network({ vpc: vpcWithDefaults, assoc: null }, [route, main(["net", ""])])));
    expect(a.paths.map((p) => p.after.verdict)).toEqual(b.paths.map((p) => p.after.verdict));
  });

  it("3: resolves a known ID to its own route table before the VPC's main table", () => {
    const vpc: Res = { ...vpcWithDefaults, after: { ...vpcWithDefaults.after, main_route_table_id: "rtb-1" } };
    const main = res("aws_main_route_table_association", "m", { id: "rtbassoc-m", vpc_id: "vpc-1", route_table_id: "rtb-1" });
    const route = res("aws_route", "extra", { id: "r-2", route_table_id: "rtb-1", destination_cidr_block: "198.51.100.0/24", gateway_id: "igw-1" });
    expect(only(analyze(plan(network({ vpc }, [main, route]))).paths).after.verdict).toBe("allowed");
  });

  it("4: uses an EIP's instance even when its network interface is known", () => {
    const priv = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, network_interface: [] });
    const eip = res("aws_eip", "app", { id: "eipalloc-1", instance: "i-1", network_interface: "eni-123", domain: "vpc" });
    expect(only(analyze(plan(network({ instance: priv }, [eip]))).paths).after.verdict).toBe("allowed");
  });

  it("5: skips an ICMP NACL rule without ports", () => {
    const rule = res("aws_network_acl_rule", "icmp", { id: "r", network_acl_id: "acl-1", rule_number: 10, egress: false, protocol: "icmp", rule_action: "allow", cidr_block: "0.0.0.0/0", from_port: null, to_port: null, icmp_type: 8, icmp_code: 0 });
    expect(only(analyze(plan(network({ vpc: vpcWithDefaults }, [rule]))).paths).after.verdict).toBe("allowed");
  });
});
