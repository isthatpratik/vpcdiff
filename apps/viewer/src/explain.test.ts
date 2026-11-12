import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, type Path, type Result } from "@vpcdiff/engine";
import { describe, expect, it } from "vitest";
import { lanesOf } from "@vpcdiff/engine/lanes";
import { changeWords, mdCode, mdText, pathMarkdown, planVerdict, planMarkdown, portLabel, serviceOf, severityOf, verdictOf, whoText } from "@vpcdiff/engine/explain";

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
    expect(whoText(["internet"])).toBe("any public IPv4 address");
    expect(whoText(["198.51.100.0/24", "203.0.113.0/24"])).toBe("198.51.100.0/24, 203.0.113.0/24");
    expect(whoText([])).toBe("nobody");
  });
});

describe("verdictOf", () => {
  it("explains a path the plan opens, with the rule that opened it", () => {
    const v = verdictOf(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"));
    expect(v.tone).toBe("danger");
    expect(v.body).toBe("After this plan, the network lets any public IPv4 address reach aws_instance.db on tcp/5432 (PostgreSQL).");
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
    expect(v.title).toBe("Outage risk during the apply");
    expect(v.snippet).toContain("create_before_destroy = true");
    expect(v.action).toContain("aws_security_group.web");
  });

  it("names the sources of a partial allow", () => {
    const v = verdictOf(pathOf("rule-resources", "internet->aws_instance.app:tcp:22"));
    expect(v.title).toBe("Opened to some addresses");
    expect(v.body).toContain("198.51.100.0/24");
    expect(v.body).not.toContain("any public IPv4 address");
  });

  it("never guesses on an unknown path", () => {
    const p = pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432");
    const unknown: Path = { ...p, change: "unknown", after: { ...p.after, verdict: "unknown", reason: "gateway_id is known only after apply" } };
    const v = verdictOf(unknown);
    expect(v.tone).toBe("warning");
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
    expect(planMarkdown("plan.json", none)).toContain("No path changes.");
  });
});

describe("trust", () => {
  it("shows sources it could not decide on a reachable path", () => {
    const p = pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432");
    const doubtful: Path = { ...p, after: { ...p.after, reason: "responses to 203.0.113.0/24 cannot be decided" } };
    expect(verdictOf(doubtful).doubt).toContain("203.0.113.0/24");
    expect(pathMarkdown(doubtful)).toContain("**Partly undecided:**");
    expect(verdictOf(p).doubt).toBeUndefined();
  });

  it("names the outage risk in the PR text and includes the fix", () => {
    const md = pathMarkdown(pathOf("sg-replaced", "internet->aws_instance.web:tcp:443"));
    expect(md.split("\n")[0]).toMatch(/^\*\*Outage risk during the apply\*\*/);
    expect(md).toContain("```hcl");
    expect(md).toContain("create_before_destroy = true");
    expect(md).toContain("name\\_prefix");
  });

  it("escapes resource names and text so a paste cannot add links or mentions", () => {
    expect(mdCode("a`b")).toBe("``a`b``");
    expect(mdCode("`x`")).toBe("`` `x` ``");
    expect(mdText("see [click](http://x) @org/team")).toBe("see \\[click\\]\\(http://x\\) @\u200borg/team");
    const p = pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432");
    const evil: Path = { ...p, to: 'aws_instance.x["`@org [a](http://e)"]' };
    const line = pathMarkdown(evil).split("\n")[0] ?? "";
    expect(line).toContain('``aws_instance.x["`@org [a](http://e)"]``');
    expect(pathMarkdown(evil).split("\n")[2]).not.toMatch(/(^|[^\\])\[a\]/);
  });

  it("sorts the most serious paths first", () => {
    const r = resultOf("rule-resources");
    const sorted = r.paths.toSorted((a, b) => severityOf(a) - severityOf(b));
    const opened = sorted.filter((p) => p.change === "added");
    expect(opened[0]?.after.sources).toContain("internet");
  });

  it("puts the scope, the notes, and a reproducible footer in the plan summary", () => {
    const md = planMarkdown("plan.json", resultOf("sg-5432-opened"), { version: "0.1.0", sha256: "abcdef0123456789ffff" });
    expect(md).toContain("Scope: AWS paths from the internet (IPv4 and IPv6) and inside the VPC (IPv4); Google Cloud paths from the internet to VMs and Cloud SQL (IPv4).");
    expect(md).toContain("<sub>vpcdiff 0.1.0 · plan sha256 abcdef0123456789</sub>");
  });
});

describe("plan verdict and change words", () => {
  it("says what to do with the whole plan, most serious first", () => {
    expect(planVerdict(resultOf("sg-5432-opened"))).toMatchObject({ tone: "danger", title: "Fix before merge", detail: "1 path opens to any public IPv4 address" });
    expect(planVerdict(resultOf("sg-replaced"))).toMatchObject({ tone: "warning", title: "Review before merge", detail: "1 outage risk" });
    const r = resultOf("sg-5432-opened");
    const none: Result = { ...r, summary: { added: 0, removed: 0, changed: 0, unknown: 0, unchanged: 1 }, paths: r.paths.map((p) => ({ ...p, change: "unchanged" as const })) };
    expect(planVerdict(none)).toMatchObject({ tone: "success", title: "No new exposure" });
  });

  it("reads new and unchanged paths in plain words", () => {
    expect(changeWords(pathOf("rule-resources", "internet->aws_instance.app:tcp:443"))).toBe("New resource → Reachable");
    expect(changeWords(pathOf("sg-replaced", "internet->aws_instance.web:tcp:443"))).toBe("Stays reachable");
    expect(changeWords(pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432"))).toBe("Blocked → Reachable");
  });

  it("folds each path's details in the plan summary", () => {
    const md = planMarkdown("plan.json", resultOf("sg-5432-opened"));
    expect(md).toContain("**Fix before merge:** 1 path opens to any public IPv4 address.");
    expect(md).toContain("<details><summary>**New exposure**");
  });
});

describe("paths inside the VPC", () => {
  const opened = () => pathOf("sg-ref-opened", "aws_instance.web->aws_instance.app:tcp:8080");
  const cut = () => pathOf("sg-ref-cut", "aws_instance.app->aws_instance.db:tcp:5432");

  it("uses the internal columns, with the source resource first", () => {
    const lanes = lanesOf(opened());
    expect(lanes.columns.map((c) => c.key)).toEqual(["source", "source-security-group", "source-route", "source-nacl-outbound", "target-nacl-inbound", "security-group", "target", "target-nacl-outbound", "source-nacl-inbound", "target-route"]);
    expect(lanes.after.cells[0]?.resource).toBe("aws_instance.web");
    expect(lanes.columns[lanes.focus]?.key).toBe("security-group");
  });

  it("says what opens inside the VPC, and asks for a review, not a fix", () => {
    const v = verdictOf(opened());
    expect(v).toMatchObject({ tone: "warning", title: "Opened inside the VPC", body: "After this plan, the network lets aws_instance.web reach aws_instance.app on tcp/8080 (HTTP alt)." });
    expect(v.cause?.hop).toBe("Target SG in");
    expect(planVerdict(resultOf("sg-ref-opened"))).toEqual({ tone: "warning", title: "Review before merge", detail: "1 path opens inside the VPC" });
  });

  it("warns when the plan cuts a path inside the VPC", () => {
    const v = verdictOf(cut());
    expect(v).toMatchObject({ tone: "warning", title: "Cut inside the VPC", body: "After this plan, aws_instance.app can no longer reach aws_instance.db on tcp/5432 (PostgreSQL): it is blocked at the Target NACL in hop." });
    expect(planVerdict(resultOf("sg-ref-cut")).detail).toBe("1 path inside the VPC is cut");
  });

  it("names the source in the Markdown", () => {
    expect(pathMarkdown(cut()).split("\n")[0]).toBe("**Cut inside the VPC** · `aws_instance.app` → `aws_instance.db` tcp/5432 (PostgreSQL)");
  });

  it("ranks a cut inside the VPC with the opened paths, below an internet exposure", () => {
    const internet = pathOf("sg-5432-opened", "internet->aws_instance.db:tcp:5432");
    expect(severityOf(internet)).toBeLessThan(severityOf(cut()));
    expect(severityOf(cut())).toBeLessThan(4);
  });
});
