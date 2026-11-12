// Secondary VPC CIDR blocks and instances with network interfaces (issue #93).
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { ModelBuilder, type Endpoint } from "./model.js";
import { parsePlan } from "./plan.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const vpcWith = (cidr: string): Res => res("aws_vpc", "main", { id: "vpc-1", cidr_block: cidr, default_network_acl_id: "acl-1" });
const assoc = (cidr: string | null, name = "extra", extra: Partial<Res> = {}): Res => res("aws_vpc_ipv4_cidr_block_association", name, { id: `vpc-cidr-assoc-${name}`, vpc_id: "vpc-1", cidr_block: cidr }, extra);
const endpoints = (r: Res[]): Endpoint[] => new ModelBuilder(parsePlan(plan(r)).after).endpoints();
const localPrefixes = (e: Endpoint) => (e.routeTable.ok && e.routeTable.value.routes.ok ? e.routeTable.value.routes.value.filter((x) => x.target.kind === "local").map((x) => x.prefix) : []);

describe("secondary VPC CIDR blocks", () => {
  it("adds a local route per block, each with its own length", () => {
    const [e] = endpoints(network({ vpc: vpcWith("10.0.0.0/17") }, [assoc("10.0.128.0/17")]));
    expect(localPrefixes(e as Endpoint)).toEqual([17, 17]);
  });

  it("keeps a decided internet path and leaves a public secondary block out of the internet sources", () => {
    const p = only(analyze(plan(network({ vpc: vpcWith("10.0.0.0/16") }, [assoc("203.0.113.0/24")]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["internet"]);
    expect(p.after.hops.at(-1)?.rule).not.toMatch(/203\.0\.113/);
  });

  it("returns unknown when a block comes from IPAM and has no CIDR before apply", () => {
    const ipam = assoc(null, "ipam", { unknown: { cidr_block: true } });
    expect(only(analyze(plan(network({}, [ipam]))).paths).after.verdict).toBe("unknown");
  });

  it("checks a path inside the VPC that stays in the secondary block", () => {
    const resources: Res[] = [
      vpcWith("10.0.0.0/16"),
      assoc("10.1.0.0/16"),
      res("aws_subnet", "a", { id: "subnet-a", vpc_id: "vpc-1", cidr_block: "10.1.1.0/24", map_public_ip_on_launch: false }),
      res("aws_subnet", "b", { id: "subnet-b", vpc_id: "vpc-1", cidr_block: "10.1.2.0/24", map_public_ip_on_launch: false }),
      res("aws_security_group", "web", { id: "sg-web", ingress: [], egress: [sgRule(0, 0, ["0.0.0.0/0"], "-1")] }),
      res("aws_security_group", "db", { id: "sg-db", ingress: [{ ...sgRule(5432, 5432, []), security_groups: ["sg-web"] }], egress: [] }),
      res("aws_instance", "web", { id: "i-web", subnet_id: "subnet-a", vpc_security_group_ids: ["sg-web"], associate_public_ip_address: false, network_interface: [] }),
      res("aws_instance", "db", { id: "i-db", subnet_id: "subnet-b", vpc_security_group_ids: ["sg-db"], associate_public_ip_address: false, network_interface: [] }),
    ];
    const p = only(analyze(plan(resources)).paths.filter((x) => x.from !== "internet"));
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops.find((h) => h.hop === "source-route")?.rule).toBe("main route table of aws_vpc.main local route (10.1.0.0/16)");
  });
});

describe("instances with a network interface", () => {
  const eni = (over: Values = {}, extra: Partial<Res> = {}) => res("aws_network_interface", "eni", { id: "eni-1", subnet_id: "subnet-1", security_groups: ["sg-1"], ...over }, extra);
  const inst = (nics: Values[] = [{ device_index: 0, network_interface_id: "eni-1" }]) => res("aws_instance", "app", { id: "i-1", subnet_id: null, vpc_security_group_ids: [], associate_public_ip_address: null, network_interface: nics });
  const eip = (target: Values) => res("aws_eip", "ip", { id: "eipalloc-1", instance: null, network_interface: null, ...target });
  const base = (extra: Res[]) => network({ instance: null }, extra);

  it("takes the subnet and groups from the interface; a public address needs an Elastic IP on it", () => {
    const withIp = only(analyze(plan(base([eni(), inst(), eip({ network_interface: "eni-1" })]))).paths);
    expect(withIp.after.verdict).toBe("allowed");
    expect(withIp.after.hops[0]?.rule).toBe("aws_eip.ip is associated with aws_network_interface.eni");
    const without = only(analyze(plan(base([eni(), inst()]))).paths);
    expect(without.after.verdict).toBe("blocked");
    expect(without.after.hops[0]?.hop).toBe("public-ip");
  });

  it("counts an Elastic IP on the instance: it goes to the primary interface", () => {
    for (const ip of [eip({ instance: "i-1" }), res("aws_eip_association", "ip", { id: "eipassoc-1", instance_id: "i-1", network_interface_id: null })]) {
      const p = only(analyze(plan(base([eni(), inst(), ip]))).paths);
      expect(p.after.verdict).toBe("allowed");
      expect(p.after.hops[0]?.rule).toBe(`${ip.type}.ip is associated with aws_instance.app`);
    }
  });

  it("does not use the subnet's map_public_ip_on_launch for an existing interface", () => {
    const subnetOn = res("aws_subnet", "a", { id: "subnet-1", vpc_id: "vpc-1", cidr_block: "10.0.1.0/24", map_public_ip_on_launch: true });
    const r = analyze(plan(network({ instance: null, subnet: subnetOn }, [eni(), inst()])));
    expect(only(r.paths).after.verdict).toBe("blocked");
  });

  it("adds groups from aws_network_interface_sg_attachment", () => {
    const empty = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [] });
    const open = res("aws_security_group", "open", { id: "sg-2", ingress: [sgRule(22, 22, ["0.0.0.0/0"])], egress: [] });
    const attach = res("aws_network_interface_sg_attachment", "open", { id: "sga-1", security_group_id: "sg-2", network_interface_id: "eni-1" });
    const p = only(analyze(plan(network({ instance: null, sg: empty }, [eni(), inst(), eip({ network_interface: "eni-1" }), open, attach]))).paths);
    expect(p.ports).toBe("22");
    expect(p.after.verdict).toBe("allowed");
  });

  it("returns unknown for more than one interface and for an interface outside the plan", () => {
    const verdicts = (r: Res[]) => analyze(plan(r)).paths.map((p) => p.after.verdict);
    expect(verdicts(base([eni(), inst([{ device_index: 0, network_interface_id: "eni-1" }, { device_index: 1, network_interface_id: "eni-2" }])]))).toEqual(["unknown", "unknown"]);
    expect(verdicts(base([inst([{ device_index: 0, network_interface_id: "eni-elsewhere" }])]))).toEqual(["unknown", "unknown"]);
  });

  it("keeps an Elastic IP on an instance's own interface unknown for every instance", () => {
    const own = eip({ network_interface: null });
    const u = { ...own, after: { ...own.after, network_interface: null }, unknown: { network_interface: true }, config: { network_interface: ["var.eni"] } };
    const privateInstance = res("aws_instance", "app", { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, network_interface: [] });
    expect(only(analyze(plan(network({ instance: privateInstance }, [u]))).paths).after.verdict).toBe("unknown");
  });
});
