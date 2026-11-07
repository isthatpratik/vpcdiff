// Managed prefix lists in security group rules and routes (issue #33, part 2).
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { network, only, plan, sgRule, type Res, type Values } from "./testkit.js";

const res = (type: string, name: string, after: Values, extra: Partial<Res> = {}): Res => ({ type, name, after, ...extra });
const office = (entries: string[], family = "IPv4") => res("aws_ec2_managed_prefix_list", "office", { id: "pl-office", address_family: family, entry: entries.map((cidr) => ({ cidr, description: "" })) });
const sgWith = (rule: Values) => res("aws_security_group", "app", { id: "sg-1", ingress: [rule], egress: [] });
const plRule = (ids: string[]) => ({ ...sgRule(22, 22, []), prefix_list_ids: ids });

describe("prefix lists in security group rules", () => {
  it("expands a customer-managed list in the plan", () => {
    const p = only(analyze(plan(network({ sg: sgWith(plRule(["pl-office"])) }, [office(["203.0.113.0/24", "198.51.100.0/25"])]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["198.51.100.0/25", "203.0.113.0/24"]);
    expect(p.after.hops.find((h) => h.hop === "security-group")?.rule).toBe("aws_security_group.app ingress tcp 22 from prefix list aws_ec2_managed_prefix_list.office");
  });

  it("adds aws_ec2_managed_prefix_list_entry resources to the list", () => {
    const entry = res("aws_ec2_managed_prefix_list_entry", "vpn", { id: "pl-office,192.0.2.0/24", prefix_list_id: "pl-office", cidr: "192.0.2.0/24" });
    const p = only(analyze(plan(network({ sg: sgWith(plRule(["pl-office"])) }, [office(["203.0.113.0/24"]), entry]))).paths);
    expect(p.after.sources).toEqual(["192.0.2.0/24", "203.0.113.0/24"]);
  });

  it("reads an IPv6 list as no IPv4 source", () => {
    expect(analyze(plan(network({ sg: sgWith(plRule(["pl-office"])) }, [office(["2001:db8::/32"], "IPv6")]))).paths).toEqual([]);
  });

  it("keeps a decided path and marks a list outside the plan as undecided", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(22, 22, ["203.0.113.0/24"]), plRule(["pl-aws"])], egress: [] });
    const p = only(analyze(plan(network({ sg }))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.sources).toEqual(["203.0.113.0/24"]);
    expect(p.after.reason).toMatch(/prefix list pl-aws is not in this plan/);
  });

  it("returns unknown when only a list outside the plan could allow the port", () => {
    const p = only(analyze(plan(network({ sg: sgWith(plRule(["pl-aws"])) }))).paths);
    expect(p.after.verdict).toBe("unknown");
  });

  it("does not mark doubt when other rules already allow every source", () => {
    const sg = res("aws_security_group", "app", { id: "sg-1", ingress: [sgRule(22, 22, ["0.0.0.0/0"]), plRule(["pl-aws"])], egress: [] });
    expect(only(analyze(plan(network({ sg }))).paths).after.reason).toBe("");
  });

  it("expands prefix_list_id on aws_vpc_security_group_ingress_rule", () => {
    const empty = res("aws_security_group", "app", { id: "sg-1", ingress: [], egress: [] });
    const rule = res("aws_vpc_security_group_ingress_rule", "office", { id: "sgr-1", security_group_id: "sg-1", ip_protocol: "tcp", from_port: 22, to_port: 22, cidr_ipv4: null, prefix_list_id: "pl-office", referenced_security_group_id: null });
    expect(only(analyze(plan(network({ sg: empty }, [office(["203.0.113.0/24"]), rule]))).paths).after.sources).toEqual(["203.0.113.0/24"]);
  });
});

describe("prefix lists as route destinations", () => {
  const rt = (route: Values[]): Res => ({ type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route } });
  const igw = { cidr_block: "0.0.0.0/0", gateway_id: "igw-1" };

  it("routes the list's entries with their own lengths", () => {
    const viaNat = { cidr_block: "", destination_prefix_list_id: "pl-office", nat_gateway_id: "nat-1" };
    const p = only(analyze(plan(network({ rt: rt([igw, viaNat]) }, [office(["203.0.113.0/24"])]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.hops.at(-1)?.decision).toBe("partial");
  });

  it("keeps a path decided when a gateway endpoint's list cannot be expanded, and says so", () => {
    const s3 = res("aws_route", "s3", { id: "r-s3", route_table_id: "rtb-1", destination_cidr_block: null, destination_prefix_list_id: "pl-63a5400a", vpc_endpoint_id: "vpce-1" });
    const p = only(analyze(plan(network({}, [s3]))).paths);
    expect(p.after.verdict).toBe("allowed");
    expect(p.after.reason).toMatch(/responses to addresses in a prefix list may use another route/);
  });
});
