// The launcher (bin/vpcdiff.mjs) must stop with a clear message on a Node version older than
// 24, before it loads the program, and start the program on a supported one.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const launcher = join(import.meta.dirname, "../bin/vpcdiff.mjs");

describe("the launcher", () => {
  it("stops with a clear message on an old Node.js, without loading the program", () => {
    const dir = mkdtempSync(join(tmpdir(), "vpcdiff-launcher-"));
    try {
      // Pretends to be Node 20: a preload script runs before the launcher.
      const stub = join(dir, "old-node.cjs");
      writeFileSync(stub, "Object.defineProperty(process.versions, 'node', { value: '20.1.0' });");
      const r = spawnSync(process.execPath, ["-r", stub, launcher, "--version"], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("vpcdiff needs Node.js 24 or later (this is 20.1.0)");
      expect(r.stderr).toContain("https://isthatpratik.github.io/vpcdiff/app/");
      expect(r.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts the program on a supported Node.js", () => {
    const r = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^vpcdiff \d+\.\d+\.\d+/);
  });
});
