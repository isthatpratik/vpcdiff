import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const publicSubnet2 = res("aws_subnet", "b", { id: "subnet-2", vpc_id: "vpc-1", cidr_block: "10.0.2.0/24", map_public_ip_on_launch: false });
const assoc2 = res("aws_route_table_association", "b", { id: "rtbassoc-2", subnet_id: "subnet-2", route_table_id: "rtb-1" });
const privateSubnet = res("aws_subnet", "private", { id: "subnet-3", vpc_id: "vpc-1", cidr_block: "10.0.3.0/24", map_public_ip_on_launch: false });
const dbGroup = (ids: string[]) => res("aws_db_subnet_group", "db", { id: "db-subnets", name: "db-subnets", subnet_ids: ids });
const db = (over: Values = {}) => res("aws_db_instance", "main", { id: "db-1", publicly_accessible: true, db_subnet_group_name: "db-subnets", vpc_security_group_ids: ["sg-1"], port: 5432, ...over });
const dbSg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(5432, 5432, ["0.0.0.0/0"])] });

describe("aws_db_instance", () => {
  it("is reachable when publicly accessible in public subnets", () => {
    const p = only(analyze(plan(network({ instance: null, sg: dbSg }, [publicSubnet2, assoc2, dbGroup(["subnet-1", "subnet-2"]), db()]))).paths);
    expect(p).toMatchObject({ to: "aws_db_instance.main", toType: "aws_db_instance", ports: "5432" });
    expect(p.after.hops[0]).toMatchObject({ hop: "public-ip", decision: "allow", rule: "aws_db_instance.main publicly_accessible = true" });
    expect(p.after.verdict).toBe("allowed");
  });

  it("is blocked when not publicly accessible", () => {
    const p = only(analyze(plan(network({ instance: null, sg: dbSg }, [dbGroup(["subnet-1"]), db({ publicly_accessible: false })]))).paths);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops.at(-1)?.hop).toBe("public-ip");
  });

  it("is unknown when the result depends on the subnet RDS chooses", () => {
    const p = only(analyze(plan(network({ instance: null, sg: dbSg }, [privateSubnet, dbGroup(["subnet-1", "subnet-3"]), db()]))).paths);
    expect(p.after.verdict).toBe("unknown");
    expect(p.after.reason).toContain("RDS chooses");
  });

  it("is unknown without a DB subnet group in the plan", () => {
    const paths = analyze(plan(network({ instance: null, sg: dbSg }, [db({ db_subnet_group_name: null })]))).paths;
    expect(paths.map((p) => `${p.protocol}:${p.ports}:${p.after.verdict}`)).toEqual(["tcp:0-65535:unknown", "udp:0-65535:unknown"]);
    expect(paths[0]?.after.reason).toContain("default DB subnet group");
  });
});

describe("aws_lb", () => {
  const lb = (over: Values = {}) => res("aws_lb", "web", { id: "arn:lb", arn: "arn:lb", internal: false, load_balancer_type: "application", subnets: ["subnet-1", "subnet-2"], subnet_mapping: [], security_groups: ["sg-1"], ...over });
  const webSg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] });

  it("is reachable when internet-facing in public subnets", () => {
    const p = only(analyze(plan(network({ instance: null, sg: webSg }, [publicSubnet2, assoc2, lb()]))).paths);
    expect(p).toMatchObject({ to: "aws_lb.web", ports: "443" });
    expect(p.after.hops[0]?.rule).toBe("aws_lb.web is internet-facing (internal = false)");
    expect(p.after.verdict).toBe("allowed");
  });

  it("has no public address when internal", () => {
    expect(only(analyze(plan(network({ instance: null, sg: webSg }, [publicSubnet2, assoc2, lb({ internal: true })]))).paths).after.verdict).toBe("blocked");
  });

  it("uses listener ports for a Network Load Balancer without security groups", () => {
    const nlb = lb({ load_balancer_type: "network", security_groups: [] });
    const listener = res("aws_lb_listener", "tls", { id: "arn:listener", load_balancer_arn: "arn:lb", port: 8443, protocol: "TLS" });
    const p = only(analyze(plan(network({ instance: null, sg: null }, [publicSubnet2, assoc2, nlb, listener]))).paths);
    expect(p).toMatchObject({ protocol: "tcp", ports: "8443" });
    expect(p.after.hops.find((h) => h.hop === "security-group")?.rule).toBe("aws_lb_listener.tls listens on tcp 8443 (aws_lb.web has no security groups)");
  });

  it("is unknown when its subnets give different results", () => {
    const p = only(analyze(plan(network({ instance: null, sg: webSg }, [privateSubnet, lb({ subnets: ["subnet-1", "subnet-3"] })]))).paths);
    expect(p.after.verdict).toBe("unknown");
  });
});

describe("endpoint review findings", () => {
  const lb = (over: Values = {}) => res("aws_lb", "web", { id: "arn:lb", arn: "arn:lb", internal: false, load_balancer_type: "application", ip_address_type: "ipv4", subnets: ["subnet-1", "subnet-2"], subnet_mapping: [], security_groups: ["sg-1"], ...over });
  const webSg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] });

  it("1: has no public IPv4 address with dualstack-without-public-ipv4", () => {
    const p = only(analyze(plan(network({ instance: null, sg: webSg }, [publicSubnet2, assoc2, lb({ ip_address_type: "dualstack-without-public-ipv4" })]))).paths);
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops[0]?.hop).toBe("public-ip");
  });

  it("2: returns unknown when load_balancer_type comes from a variable", () => {
    const l: Res = { ...lb({ load_balancer_type: null, security_groups: [] }), unknown: { load_balancer_type: true }, config: { load_balancer_type: ["var.type"] } };
    const listener = res("aws_lb_listener", "tls", { id: "arn:listener", load_balancer_arn: "arn:lb", port: 8443, protocol: "TLS" });
    const paths = analyze(plan(network({ instance: null, sg: null }, [publicSubnet2, assoc2, l, listener]))).paths;
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.after.verdict === "unknown")).toBe(true);
  });

  it("4: gives one answer when placements agree on verdict and sources", () => {
    const rt2 = res("aws_route_table", "b", { id: "rtb-2", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] });
    const assocB = res("aws_route_table_association", "b", { id: "rtbassoc-2", subnet_id: "subnet-2", route_table_id: "rtb-2" });
    const p = only(analyze(plan(network({ instance: null, sg: webSg }, [publicSubnet2, rt2, assocB, lb()]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
  });

  it("5: keeps a private DB instance blocked when its subnet group is unknown", () => {
    const paths = analyze(plan(network({ instance: null, sg: dbSg }, [db({ publicly_accessible: false, db_subnet_group_name: null })]))).paths;
    expect(paths.every((p) => p.after.verdict === "blocked")).toBe(true);
  });

  it("6: returns unknown when publicly_accessible is unknown even if not configured", () => {
    const d: Res = { ...db({ publicly_accessible: null }), unknown: { publicly_accessible: true } };
    expect(only(analyze(plan(network({ instance: null, sg: dbSg }, [dbGroup(["subnet-1"]), d]))).paths).after.verdict).toBe("unknown");
  });

  it("7: returns unknown when subnets and subnet_mapping disagree", () => {
    const l = lb({ subnet_mapping: [{ subnet_id: "subnet-1" }] });
    const paths = analyze(plan(network({ instance: null, sg: webSg }, [publicSubnet2, assoc2, l]))).paths;
    expect(paths.every((p) => p.after.verdict === "unknown")).toBe(true);
  });
});
