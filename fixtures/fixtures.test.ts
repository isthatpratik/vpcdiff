// Golden fixture tests. Each fixtures/<name>/ with a plan.json must have an
// expected.json, and the engine output must match it byte for byte.
// Never edit expected.json to make this pass (AGENTS.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, toJson } from "../packages/engine/src/index.ts";

const root = import.meta.dirname;
const names = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "plan.json")))
  .map((d) => d.name)
  .sort();

describe("fixtures", () => {
  it("has at least one fixture", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  for (const name of names) {
    it(name, () => {
      const dir = join(root, name);
      expect(existsSync(join(dir, "expected.json")), `${name}/expected.json is missing`).toBe(true);
      expect(existsSync(join(dir, "ORACLE.md")), `${name}/ORACLE.md is missing`).toBe(true);
      const plan: unknown = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
      expect(toJson(analyze(plan))).toBe(readFileSync(join(dir, "expected.json"), "utf8"));
    });
  }
});
