import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, type Path } from "@vpcdiff/engine";
import { describe, expect, it } from "vitest";
import { COLUMNS, lanesOf, rowsDiffer } from "@vpcdiff/engine/lanes";

const pathOf = (fixture: string, id: string): Path => {
  const plan: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures", fixture, "plan.json"), "utf8"));
  const p = analyze(plan).paths.find((x) => x.id === id);
  if (!p) throw new Error(`no path ${id}`);
  return p;
};

describe("lanesOf", () => {
  it("lays out one cell per column for each side", () => {
    const lanes = lanesOf(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(lanes.before.cells.map((c) => c.state)).toEqual(["allow", "allow", "allow", "allow", "deny", "not-reached", "not-reached", "not-reached"]);
    expect(lanes.after.cells.map((c) => c.state)).toEqual(["allow", "allow", "allow", "allow", "allow", "allow", "allow", "allow"]);
    expect(lanes.before.cells).toHaveLength(COLUMNS.length);
  });

  it("marks the columns where the two sides differ", () => {
    const lanes = lanesOf(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(COLUMNS.filter((_, i) => lanes.changed[i]).map((c) => c.key)).toEqual(["security-group", "target", "nacl-outbound", "route"]);
    expect(lanes.focus).toBe(4);
  });

  it("shows a side where the resource does not exist", () => {
    const lanes = lanesOf(pathOf("nacl-denies-ssh", "internet->aws_instance.web:tcp:443"));
    expect(lanes.before.cells.every((c) => c.state === "absent")).toBe(true);
    expect(lanes.after.cells.at(-1)?.state).toBe("allow");
    expect(lanes.changed.some(Boolean)).toBe(false);
    expect(COLUMNS[lanes.focus]?.key).toBe("security-group");
  });

  it("names the deciding resource and rule in each cell", () => {
    const lanes = lanesOf(pathOf("rule-resources", "internet->aws_instance.app:tcp:22"));
    const sg = lanes.after.cells[COLUMNS.findIndex((c) => c.key === "security-group")];
    expect(sg).toMatchObject({ state: "partial", resource: "aws_security_group.app", rule: "aws_security_group_rule.admin ingress tcp 22 from 198.51.100.0/24" });
    expect(lanes.after.cells[0]?.rule).toBe("198.51.100.0/24");
  });

  it("opens a path with outage risk on the replaced hop", () => {
    const lanes = lanesOf(pathOf("sg-replaced", "internet->aws_instance.web:tcp:443"));
    expect(COLUMNS[lanes.focus]?.key).toBe("security-group");
  });
});

describe("rowsDiffer", () => {
  it("marks every hop of a resource that exists on one side only", () => {
    const lanes = lanesOf(pathOf("nacl-denies-ssh", "internet->aws_instance.web:tcp:443"));
    const rows = rowsDiffer(lanes);
    // The source column is never marked; every other hop goes from absent to present.
    expect(rows[0]).toBe(false);
    expect(rows.slice(1).every(Boolean)).toBe(true);
  });

  it("matches the changed columns when both sides exist", () => {
    const lanes = lanesOf(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(rowsDiffer(lanes)).toEqual(lanes.changed);
  });

  it("marks nothing on a path that is the same on both sides", () => {
    const lanes = lanesOf(pathOf("sg-replaced", "internet->aws_instance.web:tcp:443"));
    expect(rowsDiffer(lanes).some(Boolean)).toBe(false);
  });
});
