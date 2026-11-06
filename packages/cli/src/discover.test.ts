import { describe, expect, it } from "vitest";
import { findPlans, looksLikePlanJson } from "./discover.ts";

const PLAN = '{"format_version":"1.2","terraform_version":"1.9.0","planned_values":{}';

describe("looksLikePlanJson", () => {
  it("accepts terraform show -json output", () => {
    expect(looksLikePlanJson(PLAN)).toBe(true);
    expect(looksLikePlanJson('{"format_version": "1.2", "resource_changes": []}')).toBe(true);
  });

  it("rejects other JSON", () => {
    expect(looksLikePlanJson('{"name":"pkg","version":"1.0.0"}')).toBe(false);
    expect(looksLikePlanJson('{"format_version":"1.0","values":{}}')).toBe(false); // state, not a plan
  });
});

describe("findPlans", () => {
  const file = (name: string, size = 10) => ({ name, isFile: true, size });

  it("lists plan JSON first, then binary plans, each by name", () => {
    const heads: Record<string, string> = { "b.json": PLAN, "a.json": PLAN, "package.json": '{"name":"x"}' };
    const found = findPlans([file("tfplan"), file("b.json"), file("package.json"), file("a.json"), file("prod.tfplan"), file("main.tf")], (f) => heads[f]);
    expect(found).toEqual([
      { kind: "json", file: "a.json" },
      { kind: "json", file: "b.json" },
      { kind: "binary", file: "prod.tfplan" },
      { kind: "binary", file: "tfplan" },
    ]);
  });

  it("skips folders, empty files, and files it cannot read", () => {
    const found = findPlans([{ name: "tfplan", isFile: false, size: 0 }, file("empty.json", 0), file("locked.json")], () => undefined);
    expect(found).toEqual([]);
  });

  it("does not read huge JSON files", () => {
    let read = false;
    findPlans([file("big.json", 600 * 1024 * 1024)], () => ((read = true), PLAN));
    expect(read).toBe(false);
  });
});
