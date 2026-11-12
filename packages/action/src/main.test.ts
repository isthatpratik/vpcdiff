import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKER, run, type Env } from "./main.ts";

const plan = (name: string) => readFileSync(join(import.meta.dirname, "../../../fixtures", name, "plan.json"), "utf8");

interface Call {
  url: string;
  method: string;
  body?: string;
}

function env(vars: Record<string, string>, files: Record<string, string>, responses: Response[] = []) {
  const written: Record<string, string> = {};
  const calls: Call[] = [];
  const logs: string[] = [];
  const e: Env = {
    vars: { GITHUB_STEP_SUMMARY: "/summary", GITHUB_OUTPUT: "/output", ...vars },
    readFile: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error(`ENOENT: ${p}`);
      return f;
    },
    appendFile: (p, t) => {
      written[p] = (written[p] ?? "") + t;
    },
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      return responses.shift() ?? new Response("[]", { status: 200 });
    }) as typeof fetch,
    log: (l) => logs.push(l),
  };
  return { e, written, calls, logs };
}

const pr = { "/event.json": JSON.stringify({ pull_request: { number: 7 } }) };
const prVars = { GITHUB_EVENT_PATH: "/event.json", GITHUB_REPOSITORY: "octo/repo", GITHUB_API_URL: "https://api.test", "INPUT_GITHUB-TOKEN": "t0ken" };

describe("vpcdiff action", () => {
  it("writes the summary and outputs, and fails on an added path", async () => {
    const { e, written, logs } = env({ INPUT_PLAN: "/plan.json", INPUT_COMMENT: "false" }, { "/plan.json": plan("sg-5432-opened") });
    expect(await run(e)).toBe(1);
    expect(written["/summary"]).toContain("internet → `aws_instance.db` | tcp/5432");
    expect(written["/output"]).toBe("added=1\nremoved=0\nchanged=0\nunchanged=0\nunknown=0\n");
    expect(logs.at(-1)).toMatch(/^::error::vpcdiff: the plan has reachability changes/);
  });

  it("passes with fail-on never", async () => {
    const { e } = env({ INPUT_PLAN: "/plan.json", INPUT_COMMENT: "false", "INPUT_FAIL-ON": "never" }, { "/plan.json": plan("sg-5432-opened") });
    expect(await run(e)).toBe(0);
  });

  it("creates a pull request comment with the marker", async () => {
    const { e, calls } = env({ INPUT_PLAN: "/plan.json", ...prVars }, { "/plan.json": plan("sg-5432-opened"), ...pr }, [new Response("[]"), new Response("{}", { status: 201 })]);
    await run(e);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.test/repos/octo/repo/issues/7/comments?per_page=100&page=1", "POST https://api.test/repos/octo/repo/issues/7/comments"]);
    expect(JSON.parse(calls[1]?.body ?? "{}").body).toMatch(new RegExp(`^${MARKER}\\n### vpcdiff`));
  });

  it("updates its existing comment instead of adding another", async () => {
    const list = JSON.stringify([{ id: 1, body: "hello", user: { type: "User" } }, { id: 42, body: `${MARKER}\nold`, user: { type: "Bot" } }]);
    const { e, calls } = env({ INPUT_PLAN: "/plan.json", ...prVars }, { "/plan.json": plan("sg-5432-opened"), ...pr }, [new Response(list), new Response("{}")]);
    await run(e);
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://api.test/repos/octo/repo/issues/comments/42" });
  });

  it("never writes into a person's comment that copies the marker", async () => {
    const list = JSON.stringify([{ id: 7, body: `${MARKER}\nfake report: no changes`, user: { type: "User" } }]);
    // GET /user is refused for GITHUB_TOKEN, so nobody's personal comment is ours.
    const { e, calls } = env({ INPUT_PLAN: "/plan.json", ...prVars }, { "/plan.json": plan("sg-5432-opened"), ...pr }, [new Response(list), new Response("{}", { status: 403 }), new Response("{}")]);
    await run(e);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "https://api.test/repos/octo/repo/issues/7/comments" });
  });

  it("updates the comment of the token's own user (a personal access token), not another person's", async () => {
    const list = JSON.stringify([
      { id: 5, body: `${MARKER}\nfake`, user: { type: "User", login: "mallory" } },
      { id: 6, body: `${MARKER}\nold report`, user: { type: "User", login: "octocat" } },
    ]);
    const { e, calls } = env({ INPUT_PLAN: "/plan.json", ...prVars }, { "/plan.json": plan("sg-5432-opened"), ...pr }, [new Response(list), new Response(JSON.stringify({ login: "octocat" })), new Response("{}")]);
    await run(e);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET https://api.test/user");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", url: "https://api.test/repos/octo/repo/issues/comments/6" });
  });

  it("warns instead of failing when the token cannot write comments", async () => {
    const { e, logs } = env({ INPUT_PLAN: "/plan.json", "INPUT_FAIL-ON": "never", ...prVars }, { "/plan.json": plan("sg-5432-opened"), ...pr }, [new Response("[]"), new Response("{}", { status: 403 })]);
    expect(await run(e)).toBe(0);
    expect(logs.some((l) => l.startsWith("::warning::vpcdiff: the token cannot write pull request comments (HTTP 403)"))).toBe(true);
  });

  it("reports input errors with exit code 2", async () => {
    expect(await run(env({}, {}).e)).toBe(2);
    expect(await run(env({ INPUT_PLAN: "/missing.json" }, {}).e)).toBe(2);
    expect(await run(env({ INPUT_PLAN: "/p.json" }, { "/p.json": "{}" }).e)).toBe(2);
    expect(await run(env({ INPUT_PLAN: "/p.json", "INPUT_FAIL-ON": "sometimes" }, { "/p.json": "{}" }).e)).toBe(2);
  });
});
