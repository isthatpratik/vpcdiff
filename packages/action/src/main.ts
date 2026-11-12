import { analyze, PlanError, type Result } from "@vpcdiff/engine";
import { withoutControls } from "@vpcdiff/engine/explain";
import { renderMarkdown, shouldFail, type FailOn } from "@vpcdiff/cli/render";

/** Hidden marker that identifies the comment this action owns. */
export const MARKER = "<!-- vpcdiff-action -->";

export interface Env {
  /** Environment variables (`process.env`). */
  vars: Record<string, string | undefined>;
  readFile: (path: string) => string;
  appendFile: (path: string, text: string) => void;
  fetch: typeof fetch;
  log: (line: string) => void;
}

const FAIL_ON: FailOn[] = ["added", "changed", "unknown", "never"];

/** Inputs arrive as INPUT_<NAME>, upper case, with hyphens kept. */
const input = (env: Env, name: string, fallback = "") => (env.vars[`INPUT_${name.toUpperCase()}`] ?? "").trim() || fallback;

/** Escapes text for a workflow command message. */
const escape = (s: string) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function setOutputs(env: Env, result: Result): void {
  const file = env.vars.GITHUB_OUTPUT;
  if (!file) return;
  env.appendFile(file, Object.entries(result.summary).map(([k, v]) => `${k}=${v}\n`).join(""));
}

/** Creates or updates the action's comment on the pull request. */
async function comment(env: Env, body: string): Promise<void> {
  const eventPath = env.vars.GITHUB_EVENT_PATH;
  const repo = env.vars.GITHUB_REPOSITORY;
  const token = input(env, "github-token");
  if (!eventPath || !repo) return;
  const event = JSON.parse(env.readFile(eventPath)) as { pull_request?: { number?: number } };
  const number = event.pull_request?.number;
  if (!number) {
    env.log("vpcdiff: not a pull_request event; skipping the comment.");
    return;
  }
  if (!token) {
    env.log(`::warning::${escape("vpcdiff: no github-token; skipping the pull request comment.")}`);
    return;
  }
  const api = env.vars.GITHUB_API_URL ?? "https://api.github.com";
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  const text = `${MARKER}\n${body}`;
  let existing: number | undefined;
  for (let page = 1; page <= 10 && existing === undefined; page++) {
    const res = await env.fetch(`${api}/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`listing comments failed: HTTP ${res.status}`);
    const list = (await res.json()) as { id: number; body?: string }[];
    existing = list.find((c) => c.body?.startsWith(MARKER))?.id;
    if (list.length < 100) break;
  }
  const res = existing === undefined
    ? await env.fetch(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body: text }) })
    : await env.fetch(`${api}/repos/${repo}/issues/comments/${existing}`, { method: "PATCH", headers, body: JSON.stringify({ body: text }) });
  if (res.status === 403 || res.status === 404) {
    env.log(`::warning::${escape(`vpcdiff: the token cannot write pull request comments (HTTP ${res.status}). Pull requests from forks get a read-only token; the report is in the job summary.`)}`);
    return;
  }
  if (!res.ok) throw new Error(`writing the comment failed: HTTP ${res.status}`);
  env.log(`vpcdiff: ${existing === undefined ? "created" : "updated"} the pull request comment.`);
}

/** Runs the action. Returns the process exit code. */
export async function run(env: Env): Promise<number> {
  const planPath = input(env, "plan");
  const failOn = input(env, "fail-on", "added") as FailOn;
  if (!planPath) {
    env.log(`::error::${escape("vpcdiff: the `plan` input is required (path to `terraform show -json` output).")}`);
    return 2;
  }
  if (!FAIL_ON.includes(failOn)) {
    env.log(`::error::${escape(`vpcdiff: fail-on must be one of ${FAIL_ON.join(", ")}.`)}`);
    return 2;
  }
  let result: Result;
  try {
    result = withoutControls(analyze(JSON.parse(env.readFile(planPath))));
  } catch (e) {
    const why = e instanceof SyntaxError ? "the file is not valid JSON" : e instanceof PlanError ? e.message : (e as Error).message;
    env.log(`::error::${escape(`vpcdiff: ${planPath}: ${why}`)}`);
    return 2;
  }
  const markdown = renderMarkdown(result, { all: input(env, "all", "false") === "true" });
  if (env.vars.GITHUB_STEP_SUMMARY) env.appendFile(env.vars.GITHUB_STEP_SUMMARY, markdown);
  setOutputs(env, result);
  if (input(env, "comment", "true") === "true") {
    try {
      await comment(env, markdown);
    } catch (e) {
      env.log(`::warning::${escape(`vpcdiff: could not write the pull request comment: ${(e as Error).message}`)}`);
    }
  }
  const s = result.summary;
  env.log(`vpcdiff: ${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unknown} unknown, ${s.unchanged} unchanged`);
  if (shouldFail(result, failOn)) {
    env.log(`::error::${escape(`vpcdiff: the plan has reachability changes at or above fail-on=${failOn}. See the job summary.`)}`);
    return 1;
  }
  return 0;
}
