// A crafted plan must not use all memory or time, and must never read as "safe": the engine
// stops with a PlanError. The limits are lowered here so the tests stay small.
import { describe, expect, it } from "vitest";
import { analyze, isStackOverflow, MAX_PAIRS, MAX_PATHS, MAX_SEGMENTS, PlanError } from "./index.js";
import { plan, type Res } from "./testkit.js";

/** n instances in one subnet that share a security group with a rule that references itself. */
function shared(n: number, ports = 1): Res[] {
  const rules = Array.from({ length: ports }, (_, i) => ({ protocol: "tcp", from_port: 1000 + 2 * i, to_port: 1000 + 2 * i, cidr_blocks: [], ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: ["sg-1"], self: true }));
  const out: Res[] = [
    { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1" } },
    { type: "aws_subnet", name: "a", after: { id: "subnet-1", vpc_id: "vpc-1", cidr_block: "10.0.1.0/24", map_public_ip_on_launch: false } },
    { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: rules, egress: [{ protocol: "-1", from_port: 0, to_port: 0, cidr_blocks: ["0.0.0.0/0"], ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: [], self: false }] } },
  ];
  for (let i = 0; i < n; i++) out.push({ type: "aws_instance", name: `i${i}`, after: { id: `i-${i}`, subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: false, network_interface: [] } });
  return out;
}

describe("limits", () => {
  it("has limits far above real use", () => {
    expect(MAX_PATHS).toBeGreaterThanOrEqual(500_000);
    expect(MAX_SEGMENTS).toBeGreaterThanOrEqual(1_000_000);
    expect(MAX_PAIRS).toBeGreaterThanOrEqual(25_000_000);
  });

  it("stops when the pairs of resources to check exceed the limit, even when no path comes out", () => {
    // Twelve instances with no group reference: no path, but 132 pairs are looked at.
    const lonely = shared(12).filter((r) => r.type !== "aws_security_group").map((r) => (r.type === "aws_instance" ? { ...r, after: { ...r.after, vpc_security_group_ids: [] } } : r));
    expect(() => analyze(plan(lonely), { maxPairs: 100 })).toThrow(/more than 100 pairs/);
    expect(() => analyze(plan(lonely), { maxPairs: 1000 })).not.toThrow();
  });

  it("converts only a real stack overflow, so other RangeErrors stay visible", () => {
    expect(isStackOverflow(new RangeError("Maximum call stack size exceeded"))).toBe(true);
    expect(isStackOverflow(new RangeError("Invalid array length"))).toBe(false);
    expect(isStackOverflow(new RangeError("Invalid string length"))).toBe(false);
    expect(isStackOverflow(new Error("Maximum call stack size exceeded"))).toBe(false);
  });

  it("stops when the paths to report exceed the limit", () => {
    expect(analyze(plan(shared(8)), { maxPaths: 1000 }).paths).toHaveLength(56);
    expect(() => analyze(plan(shared(12)), { maxPaths: 100 })).toThrow(PlanError);
    expect(() => analyze(plan(shared(12)), { maxPaths: 100 })).toThrow(/more than 100 paths/);
  });

  it("stops when the port checks exceed the limit", () => {
    expect(() => analyze(plan(shared(3, 40)), { maxSegments: 50 })).toThrow(/more than 50 port checks/);
  });

  it("reports a plan that is nested too deeply as a PlanError, not a stack overflow", () => {
    // The configuration expressions are walked recursively (plan.ts); real JSON this deep is rare.
    const p = plan(shared(1)) as { configuration: { root_module: { resources: { type: string; expressions: Record<string, unknown> }[] } } };
    let deep: unknown = [true];
    for (let i = 0; i < 200_000; i++) deep = [deep];
    const instance = p.configuration.root_module.resources.find((r) => r.type === "aws_instance");
    (instance as { expressions: Record<string, unknown> }).expressions.vpc_security_group_ids = { references: ["aws_security_group.app"], nested: deep };
    expect(() => analyze(p)).toThrow(PlanError);
    expect(() => analyze(p)).toThrow(/nested too deeply/);
  });
});
