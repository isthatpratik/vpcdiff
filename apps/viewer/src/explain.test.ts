import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, type Path, type Result } from "@vpcdiff/engine";
import { describe, expect, it } from "vitest";
import { pathMarkdown, planMarkdown, portLabel, serviceOf, verdictOf, whoText } from "./explain.ts";

const resultOf = (fixture: string): Result => analyze(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures", fixture, "plan.json"), "utf8")) as unknown);
const pathOf = (fixture: string, id: string): Path => {
  const p = resultOf(fixture).paths.find((x) => x.id === id);
  if (!p) throw new Error(`no path ${id}`);
  return p;
};

describe("ports and sources", () => {
  it("names well-known single ports only", () => {
    expect(serviceOf("5432")).toBe("PostgreSQL");
    expect(serviceOf("22")).toBe("SSH");
    expect(serviceOf("8000-8100")).toBeUndefined();
    expect(serviceOf("12345")).toBeUndefined();
    expect(portLabel({ protocol: "tcp", ports: "443" })).toBe("tcp/443 (HTTPS)");
    expect(portLabel({ protocol: "udp", ports: "1000-2000" })).toBe("udp/1000-2000");
  });

  it("says who can connect", () => {
    expect(whoText(["internet"])).toBe("anyone on the internet");
    expect(whoText(["198.51.100.0/24", "203.0.113.0/24"])).toBe("198.51.100.0/24, 203.0.113.0/24");
    expect(whoText([])).toBe("nobody");
  });
});

describe("verdictOf", () => {
  it("explains a path the plan opens, with the rule that opened it", () => {
    const v = verdictOf(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(v.tone).toBe("danger");
    expect(v.body).toBe("After this plan, anyone on the internet can connect to aws_instance.db on tcp/5432 (PostgreSQL).");
    expect(v.cause).toMatchObject({ hop: "Security groups", resource: "aws_security_group.db" });
    expect(v.cause?.rule).toContain("0.0.0.0/0");
    expect(v.action).toMatch(/narrow the rule's source/);
  });

  it("explains a new resource that stays blocked, and names where", () => {
    const v = verdictOf(pathOf("nacl-denies-ssh", "internet->aws_instance.web:tcp:22"));
    expect(v.title).toBe("New, and not reachable");
    expect(v.body).toContain("blocked at the NACL inbound hop");
    expect(v.cause?.hop).toBe("NACL inbound");
  });

  it("gives the create_before_destroy fix for outage risk", () => {
    const v = verdictOf(pathOf("sg-replaced", "internet->aws_instance.web:tcp:443"));
    expect(v.tone).toBe("warning");
    expect(v.title).toBe("May drop during the apply");
    expect(v.snippet).toContain("create_before_destroy = true");
    expect(v.action).toContain("aws_security_group.web");
  });

  it("names the sources of a partial allow", () => {
    const v = verdictOf(pathOf("rule-resources", "internet->aws_instance.app:tcp:22"));
    expect(v.title).toBe("Opened to some addresses");
    expect(v.body).toContain("198.51.100.0/24");
    expect(v.body).not.toContain("anyone on the internet");
  });

  it("never guesses on an unknown path", () => {
    const p = pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432");
    const unknown: Path = { ...p, change: "unknown", after: { ...p.after, verdict: "unknown", reason: "gateway_id is known only after apply" } };
    const v = verdictOf(unknown);
    expect(v.tone).toBe("neutral");
    expect(v.body).toContain("known only after apply");
    expect(v.action).toMatch(/by hand/);
  });
});

describe("Markdown", () => {
  it("summarizes one path for a pull request", () => {
    const md = pathMarkdown(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(md.split("\n")[0]).toBe("**New exposure** · internet → `aws_instance.db` tcp/5432 (PostgreSQL)");
    expect(md).toContain("Decided at the Security groups hop:");
  });

  it("summarizes a plan, listing only paths that change or carry a risk", () => {
    const md = planMarkdown("plan.json", resultOf("sg-replaced"));
    expect(md).toContain("0 opened · 0 closed · 0 changed · 0 unknown · 1 outage risk");
    expect(md).toContain("aws_instance.web");
  });

  it("says so when nothing changes", () => {
    const r = resultOf("sg-5432-opened");
    const none: Result = { ...r, summary: { added: 0, removed: 0, changed: 0, unknown: 0, unchanged: 1 }, paths: r.paths.map((p) => ({ ...p, change: "unchanged" as const })) };
    expect(planMarkdown("plan.json", none)).toContain("No path from the internet changes.");
  });
});
