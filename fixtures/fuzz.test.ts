// Mutation fuzzing over every fixture plan: random values at random places in
// resource_changes and configuration. The engine may reject a plan with PlanError, but it
// must never throw anything else, and it must never pollute Object.prototype.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, PlanError } from "../packages/engine/src/index.ts";

const root = import.meta.dirname;
const plans = readdirSync(root)
  .filter((d) => existsSync(join(root, d, "plan.json")))
  .toSorted()
  .map((d) => JSON.parse(readFileSync(join(root, d, "plan.json"), "utf8")) as Record<string, unknown>);
const VALUES: unknown[] = [null, 0, -1, 1.5, "", "x", [], {}, [null], [{}], true, "0.0.0.0/0", "10.0.0.0/33", "::/0", "-1", "a".repeat(2000), JSON.parse('{"__proto__": {"polluted": 1}}')];

describe("fuzzing", () => {
  it("never throws anything but PlanError on mutated plans", () => {
    let seed = 7; // A fixed seed: the same runs every time.
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const crashes: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const copy = structuredClone(plans[i % plans.length]) as Record<string, unknown>;
      const paths: string[][] = [];
      const walk = (o: unknown, p: string[]) => {
        if (o && typeof o === "object") for (const k of Object.keys(o)) {
          paths.push([...p, k]);
          if (p.length < 8) walk((o as Record<string, unknown>)[k], [...p, k]);
        }
      };
      walk(copy.resource_changes, ["resource_changes"]);
      if (i % 3 === 0) walk(copy.configuration, ["configuration"]);
      for (let j = 0; j < 4; j++) {
        const path = paths[Math.floor(rnd() * paths.length)];
        if (!path) continue;
        let o: unknown = copy;
        for (const k of path.slice(0, -1)) o = (o as Record<string, unknown> | undefined)?.[k];
        if (o && typeof o === "object") (o as Record<string, unknown>)[path.at(-1) as string] = structuredClone(VALUES[Math.floor(rnd() * VALUES.length)]);
      }
      try {
        analyze(copy);
      } catch (e) {
        if (!(e instanceof PlanError)) crashes.push(String((e as Error).stack).split("\n").slice(0, 2).join(" "));
      }
    }
    expect(crashes).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
