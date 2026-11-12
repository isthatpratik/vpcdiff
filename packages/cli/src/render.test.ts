import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "@vpcdiff/engine";
import { describe, expect, it } from "vitest";
import { network, plan, sgRule } from "../../engine/src/testkit.ts";
import { renderMarkdown, shouldFail } from "./render.ts";

// One port-22 rule that changes its source: both sides allow the path, so the path is "changed".
const widen = (from: string, to: string) =>
  analyze(plan(network({ sg: { type: "aws_security_group", name: "app", before: { id: "sg-1", ingress: [sgRule(22, 22, [from])] }, after: { id: "sg-1", ingress: [sgRule(22, 22, [to])] } } })));

describe("the default gate and a widened exposure", () => {
  it("fails on added when a rule goes from one host to the whole internet", () => {
    const r = widen("203.0.113.5/32", "0.0.0.0/0");
    expect(r.summary).toMatchObject({ added: 0, changed: 1 });
    expect(shouldFail(r, "added")).toBe(true);
  });

  it("fails on added when the allowed range moves to addresses that were closed", () => {
    expect(shouldFail(widen("203.0.113.5/32", "198.51.100.0/24"), "added")).toBe(true);
  });

  it("does not fail on added when the exposure narrows", () => {
    expect(shouldFail(widen("0.0.0.0/0", "203.0.113.5/32"), "added")).toBe(false);
    expect(shouldFail(widen("203.0.113.0/24", "203.0.113.5/32"), "added")).toBe(false);
    // A narrowing is still a change for the stricter levels.
    expect(shouldFail(widen("0.0.0.0/0", "203.0.113.5/32"), "changed")).toBe(true);
  });

  it("counts a widened path once at changed", () => {
    expect(shouldFail(widen("203.0.113.5/32", "0.0.0.0/0"), "changed")).toBe(true);
  });
});


describe("paths inside the VPC", () => {
  const load = (n: string) => analyze(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures", n, "plan.json"), "utf8")) as unknown);

  it("fails on added only for a new exposure to the internet", () => {
    expect(shouldFail(load("sg-ref-opened"), "added")).toBe(false);
    expect(shouldFail(load("sg-ref-opened"), "changed")).toBe(true);
    expect(shouldFail(load("sg-ref-cut"), "added")).toBe(false);
    expect(shouldFail(load("sg-ref-cut"), "changed")).toBe(true);
    expect(shouldFail(load("sg-5432-opened"), "added")).toBe(true);
  });

  it("names the source in the Markdown table", () => {
    expect(renderMarkdown(load("sg-ref-cut"), { all: false })).toContain("| 🟢 removed | `aws_instance.app` → `aws_instance.db` | tcp/5432 |");
  });
});
