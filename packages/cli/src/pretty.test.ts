import { join } from "node:path";
import pc from "picocolors";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyze } from "@vpcdiff/engine";
import { run } from "./main.ts";
import { prettyPath } from "./pretty.ts";

const fixture = (name: string) => join(import.meta.dirname, "../../../fixtures", name, "plan.json");
const plain = pc.createColors(false);
const firstPath = (name: string) => {
  const p = analyze(JSON.parse(readFileSync(fixture(name), "utf8")) as unknown).paths[0];
  if (!p) throw new Error("no path");
  return p;
};

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
    expect(lines[1]).toBe("Fix before merge · 1 path opens to any public IPv4 address");
    expect(lines[2]).toBe("1 opened · 0 closed · 0 changed · 0 outage risk · 0 unknown");
    expect(r.out).toContain("● Opened to the internet");
    expect(r.out).toContain("aws_instance.db  tcp/5432 (PostgreSQL)  Blocked → Reachable");
    expect(r.out).toContain("Decided at the Security groups hop:");
    expect(r.out).toMatch(/What to do: .*narrow the rule's source/);
    expect(r.out).toContain("Security groups   denies       allows");
  });

  it("shows only the hops that differ", () => {
    const r = cli([fixture("sg-replaced")]);
    expect(r.out).toContain("Outage risk during the apply");
    expect(r.out).toContain("create_before_destroy = true");
  });

  it("lists every hop with its rule in the full view", () => {
    const r = cli([fixture("sg-5432-opened")]);
    expect(r.code).toBe(1);
    const full = prettyPath(plain, firstPath("sg-5432-opened"), true).join("\n");
    expect(full).toContain("Security groups   denies → allows");
    expect(full).toContain("after:  aws_security_group.db ingress tcp 5432 from 0.0.0.0/0");
    expect(full).toContain("Public IP         allows\n    aws_instance.db associate_public_ip_address = true");
    expect(full).toContain("  Internet          allows\n  Public IP");
    expect(full).not.toContain("other hops are the same");
  });

  it("keeps the same spacing when colors are on", () => {
    const strip = (t: string) => t.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    const colored = strip(prettyPath(pc.createColors(true), firstPath("sg-5432-opened"), true).join("\n"));
    expect(colored).toBe(prettyPath(plain, firstPath("sg-5432-opened"), true).join("\n"));
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
