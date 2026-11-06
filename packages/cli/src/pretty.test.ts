import { join } from "node:path";
import pc from "picocolors";
import { describe, expect, it } from "vitest";
import { run } from "./main.ts";

const fixture = (name: string) => join(import.meta.dirname, "../../../fixtures", name, "plan.json");
const plain = pc.createColors(false);

function cli(args: string[]) {
  let out = "";
  const code = run(args, { stdin: () => "", out: (s) => (out += s), err: () => undefined, pretty: plain });
  return { code, out };
}

describe("pretty report for a terminal", () => {
  it("leads with the verdict, the deciding rule, and the fix", () => {
    const r = cli([fixture("sg-5432-opened")]);
    expect(r.code).toBe(1);
    const lines = r.out.split("\n");
    expect(lines[1]).toBe("1 opened · 0 closed · 0 changed · 0 at risk · 0 unknown");
    expect(r.out).toContain("● Opened to the internet");
    expect(r.out).toContain("aws_instance.db  tcp/5432 (PostgreSQL)  Blocked → Reachable");
    expect(r.out).toContain("Decided at the Security groups hop:");
    expect(r.out).toMatch(/What to do: .*narrow the rule's source/);
    expect(r.out).toContain("Security groups   denies       allows");
  });

  it("shows only the hops that differ", () => {
    const r = cli([fixture("sg-replaced")]);
    expect(r.out).toContain("May drop during the apply");
    expect(r.out).toContain("create_before_destroy = true");
  });

  it("says plainly when nothing changes", () => {
    const r = cli([fixture("nacl-denies-ssh"), "--fail-on", "never"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("UNCHANGED");
  });

  it("is used only for text; JSON and Markdown stay the same", () => {
    expect(cli(["-f", "json", fixture("sg-5432-opened")]).out).not.toContain("●");
    expect(cli(["-f", "markdown", fixture("sg-5432-opened")]).out).not.toContain("●");
  });

  it("writes no color codes when colors are off", () => {
    expect(cli([fixture("sg-5432-opened")]).out).not.toContain("\u001b[");
  });
});
