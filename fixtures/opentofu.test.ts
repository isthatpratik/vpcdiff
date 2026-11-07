// OpenTofu support (#34): plans every fixture with OpenTofu (`tofu`), runs the engine on
// that plan, and compares the result with expected.json byte for byte. It needs OpenTofu
// on PATH and network access to registry.opentofu.org (no AWS account), so it runs only
// with VPCDIFF_TOFU=1: `VPCDIFF_TOFU=1 pnpm vitest run fixtures/opentofu.test.ts`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, toJson } from "../packages/engine/src/index.ts";

const root = import.meta.dirname;
const names = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "after", "main.tf")))
  .map((d) => d.name)
  .sort();

describe.skipIf(!process.env.VPCDIFF_TOFU)("fixtures planned with OpenTofu", () => {
  const out = mkdtempSync(join(tmpdir(), "vpcdiff-tofu-"));
  for (const name of names) {
    it(name, { timeout: 300_000 }, () => {
      const plan = join(out, `${name}.json`);
      execFileSync(process.execPath, [join(root, "..", "scripts", "make-fixture-plan.ts"), join(root, name), "--tofu", "--out", plan], { stdio: ["ignore", "ignore", "inherit"] });
      const got = toJson(analyze(JSON.parse(readFileSync(plan, "utf8")) as unknown));
      expect(got).toBe(readFileSync(join(root, name, "expected.json"), "utf8"));
    });
  }
});
