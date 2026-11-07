import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "@vpcdiff/engine";
import { describe, expect, it } from "vitest";
import { renderMarkdown, shouldFail } from "./render.ts";


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
