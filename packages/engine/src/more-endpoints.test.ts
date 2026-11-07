// Aurora, ECS services, and Classic Load Balancers as endpoints (issue #35).
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const internet = (resources: Res[]) => analyze(plan(resources)).paths.filter((p) => p.from === "internet");
const subnetGroup = res("aws_db_subnet_group", "db", { id: "db-subnets", name: "db-subnets", subnet_ids: ["subnet-1"] });

describe("Aurora", () => {
  const cluster = (over: Values = {}) => res("aws_rds_cluster", "main", { id: "main", cluster_identifier: "main", db_subnet_group_name: "db-subnets", vpc_security_group_ids: ["sg-1"], ...over });
  const inst = (over: Values = {}) => res("aws_rds_cluster_instance", "a", { id: "main-a", cluster_identifier: "main", publicly_accessible: true, db_subnet_group_name: null, ...over });
  const noInstance = network({ instance: null });

  it("uses the cluster's security groups and subnet group, and the instance's publicly_accessible", () => {
    const p = only(internet([...noInstance, subnetGroup, cluster(), inst()]));
    expect(p).toMatchObject({ to: "aws_rds_cluster_instance.a", toType: "aws_rds_cluster_instance", ports: "443" });
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops.find((h) => h.hop === "security-group")?.resource).toBe("aws_security_group.app");
  });

  it("blocks a private cluster instance at the public IP hop", () => {
    const p = only(internet([...noInstance, subnetGroup, cluster(), inst({ publicly_accessible: false })]));
    expect(p.after.verdict).toBe("blocked");
    expect(p.after.hops[0]?.hop).toBe("public-ip");
  });

  it("finds the cluster through the configuration when its identifier is unknown", () => {
    const i = { ...inst({ cluster_identifier: null }), unknown: { cluster_identifier: true }, config: { cluster_identifier: ["aws_rds_cluster.main"] } };
    expect(only(internet([...noInstance, subnetGroup, cluster(), i])).after.verdict).toBe("allowed");
  });

  it("returns unknown when the cluster is not in the plan", () => {
    const paths = internet([...noInstance, subnetGroup, inst({ cluster_identifier: "elsewhere" })]);
    expect(paths.map((p) => `${p.protocol}:${p.ports}:${p.after.verdict}`)).toEqual(["tcp:0-65535:unknown", "udp:0-65535:unknown"]);
    expect(paths[0]?.after.reason).toBe("aws_rds_cluster_instance.a: cluster elsewhere is not in this plan");
  });

  it("blocks a private cluster instance even when its cluster is not in the plan", () => {
    expect(internet([...noInstance, subnetGroup, inst({ cluster_identifier: "elsewhere", publicly_accessible: false })]).every((p) => p.after.verdict === "blocked")).toBe(true);
  });
});

describe("ECS services", () => {
  const service = (net: Values, over: Values = {}, extra: Partial<Res> = {}) => res("aws_ecs_service", "api", { id: "arn:svc", launch_type: "FARGATE", capacity_provider_strategy: [], network_configuration: [{ subnets: ["subnet-1"], security_groups: ["sg-1"], assign_public_ip: true, ...net }], ...over }, extra);
  const base = network({ instance: null });

  it("gives a Fargate task with assign_public_ip a public address", () => {
    const p = only(internet([...base, service({})]));
    expect(p).toMatchObject({ to: "aws_ecs_service.api", toType: "aws_ecs_service" });
    expect(p.after.hops[0]?.rule).toBe("aws_ecs_service.api runs on Fargate with assign_public_ip = true");
    expect(p.after.verdict).toBe("allowed");
  });

  it("gives no public address on the EC2 launch type, even with assign_public_ip", () => {
    expect(only(internet([...base, service({}, { launch_type: "EC2" })])).after.verdict).toBe("blocked");
  });

  it("treats Fargate capacity providers as Fargate, and others as unknown", () => {
    const fargate = [{ capacity_provider: "FARGATE_SPOT", weight: 1, base: 0 }];
    expect(only(internet([...base, service({}, { launch_type: null, capacity_provider_strategy: fargate })])).after.verdict).toBe("allowed");
    const custom = [{ capacity_provider: "my-asg", weight: 1, base: 0 }];
    expect(only(internet([...base, service({}, { launch_type: null, capacity_provider_strategy: custom })])).after.verdict).toBe("unknown");
  });

  it("decides from capacity providers when launch_type is computed, as Terraform plans it", () => {
    const fargate = [{ capacity_provider: "FARGATE", weight: 1, base: 0 }];
    const s = service({}, { launch_type: null, capacity_provider_strategy: fargate }, { before: null, unknown: { launch_type: true } });
    expect(only(internet([...base, s])).after.verdict).toBe("allowed");
    const none = service({}, { launch_type: null }, { before: null, unknown: { launch_type: true } });
    expect(only(internet([...base, none])).after.reason).toMatch(/default capacity provider decides/);
  });

  it("uses the VPC's default group when the service lists none", () => {
    const vpc = res("aws_vpc", "main", { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1", default_security_group_id: "sg-d" });
    // The default group allows inbound traffic only from itself, so nothing from the internet.
    expect(internet([...network({ instance: null, vpc }), service({ security_groups: [] })])).toEqual([]);
  });

  it("matches unknown subnets and groups through the configuration", () => {
    const s = service({ subnets: null, security_groups: null }, {}, { before: null, unknown: { network_configuration: [{ subnets: true, security_groups: true }] }, config: { network_configuration: ["aws_subnet.a", "aws_security_group.app"] } });
    const paths = internet([...base, s]);
    expect(paths.map((p) => p.after.reason)).toEqual([""]);
    expect(only(paths).after.verdict).toBe("allowed");
  });

  it("notes a service without awsvpc networking", () => {
    const bridge = res("aws_ecs_service", "worker", { id: "arn:w", launch_type: "EC2", network_configuration: [] });
    const r = analyze(plan([...base, bridge]));
    expect(r.paths).toEqual([]);
    expect(r.notes.find((n) => n.resource === "aws_ecs_service.worker")?.message).toMatch(/bridge or host mode/);
  });

  it("is a source for paths inside the VPC", () => {
    const db = res("aws_security_group", "db", { id: "sg-db", ingress: [{ ...sgRule(5432, 5432, []), security_groups: ["sg-1"] }], egress: [] });
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [sgRule(0, 0, ["0.0.0.0/0"], "-1")] });
    const dbi = res("aws_db_instance", "db", { id: "db", db_subnet_group_name: "db-subnets", vpc_security_group_ids: ["sg-db"], publicly_accessible: false });
    const p = only(analyze(plan([...network({ instance: null, sg }), service({}), db, dbi, subnetGroup])).paths.filter((x) => x.from !== "internet"));
    expect(p).toMatchObject({ from: "aws_ecs_service.api", fromType: "aws_ecs_service", to: "aws_db_instance.db", ports: "5432" });
    expect(p.after.verdict).toBe("allowed");
  });
});

describe("Classic Load Balancers", () => {
  const elb = (over: Values = {}) => res("aws_elb", "web", { id: "web", subnets: ["subnet-1"], security_groups: ["sg-1"], internal: false, listener: [{ lb_port: 443, lb_protocol: "tcp", instance_port: 443, instance_protocol: "tcp" }], ...over });
  const base = network({ instance: null });

  it("is internet-facing unless internal", () => {
    expect(only(internet([...base, elb()]))).toMatchObject({ to: "aws_elb.web", toType: "aws_elb" });
    expect(only(internet([...base, elb()])).after.verdict).toBe("allowed");
    expect(only(internet([...base, elb({ internal: true })])).after.verdict).toBe("blocked");
  });

  it("is internet-facing when internal is not set (the AWS default)", () => {
    const e = { ...elb({ internal: null }), unknown: { internal: true } };
    expect(only(internet([...base, e])).after.verdict).toBe("allowed");
    const set = { ...elb({ internal: null }), unknown: { internal: true }, config: { internal: ["var.internal"] } };
    expect(only(internet([...base, set])).after.verdict).toBe("unknown");
  });

  it("returns unknown for a load balancer placed by availability zones only", () => {
    expect(internet([...base, elb({ subnets: [], availability_zones: ["us-east-1a"] })]).every((p) => p.after.verdict === "unknown")).toBe(true);
  });
});
