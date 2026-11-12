// `vpcdiff` with no arguments, in a terminal: a guided flow. It finds plans in the
// current folder (or makes one with terraform), analyzes it, prints the report, and
// offers next steps. Terraform runs through execFile with argument arrays, never a
// shell, and `terraform plan` runs only after the user confirms it.
import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { analyze, PlanError, type Result } from "@vpcdiff/engine";
import { portLabel, withoutControls } from "@vpcdiff/engine/explain";
import pc from "picocolors";
import { findPlans, type Candidate } from "./discover.ts";
import { prettyPath, renderPretty } from "./pretty.ts";
import { renderMarkdown, shouldFail, visiblePaths, type FailOn } from "./render.ts";

const MAX_PLAN = 512 * 1024 * 1024;

function head(file: string): string | undefined {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return undefined;
  }
}

/** True when `path` is a symbolic link, even a dangling one (`existsSync` follows links). */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Terraform runs in the folder the user is in, with the user's environment: that is how
// `terraform plan` reaches the user's own cloud account. CHECKPOINT_DISABLE stops
// Terraform's own version check from calling out.
function terraform(args: string[], opts: { cwd: string }): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("terraform", args, { cwd: opts.cwd, maxBuffer: MAX_PLAN, env: { ...process.env, TF_IN_AUTOMATION: "1", CHECKPOINT_DISABLE: "1" } }, (err, stdout, stderr) => {
      if (err) fail(new Error(stderr.trim().split("\n").slice(-6).join("\n") || err.message));
      else ok(stdout);
    });
  });
}

async function hasTerraform(): Promise<boolean> {
  try {
    await terraform(["version"], { cwd: process.cwd() });
    return true;
  } catch {
    return false;
  }
}

function cancelled<T>(v: T | symbol): v is symbol {
  if (p.isCancel(v)) {
    p.cancel("Cancelled. Nothing was changed.");
    return true;
  }
  return false;
}

/** Ask for the plan, analyze it, show the report. Returns the exit code. */
export async function interactive(failOn: FailOn = "added"): Promise<number> {
  const cwd = process.cwd();
  p.intro(`${pc.bgWhite(pc.black(" vpcdiff "))} ${pc.dim("see what a Terraform plan opens")}`);

  const listing = readdirSync(cwd, { withFileTypes: true }).map((d) => {
    let size: number;
    try {
      size = d.isFile() ? statSync(join(cwd, d.name)).size : 0;
    } catch {
      size = 0;
    }
    return { name: d.name, isFile: d.isFile(), size };
  });
  const found = findPlans(listing, (f) => head(join(cwd, f)));
  const tf = await hasTerraform();
  const hasConfig = listing.some((e) => e.isFile && e.name.endsWith(".tf"));

  type Choice = Candidate | { kind: "plan" } | { kind: "path" };
  const choices: { choice: Choice; label: string; hint?: string }[] = [
    ...found.map((c) => ({ choice: c, label: c.file, hint: c.kind === "json" ? "plan JSON" : tf ? "binary plan · converted with terraform show -json" : "binary plan · needs terraform on PATH" })),
    ...(tf && hasConfig ? [{ choice: { kind: "plan" } as const, label: "Run terraform plan here", hint: "uses your cloud credentials" }] : []),
    { choice: { kind: "path" } as const, label: "Enter a path…" },
  ];
  const options = choices.map((c, i) => ({ value: i, label: c.label, ...(c.hint ? { hint: c.hint } : {}) }));
  if (!found.length) p.log.info(`No plan found in ${pc.dim(cwd)}. Make one with ${pc.cyan("terraform plan -out=tfplan")}, or choose below.`);

  const picked = await p.select<number>({ message: "Which plan should vpcdiff read?", options });
  if (cancelled(picked)) return 130;
  const choice = (choices[picked] as (typeof choices)[number]).choice;

  let text: string;
  let name: string;
  const spin = p.spinner();
  try {
    if (choice.kind === "json") {
      name = choice.file;
      text = readFileSync(join(cwd, choice.file), "utf8");
    } else if (choice.kind === "binary") {
      if (!tf) throw new Error("terraform is not on PATH, so the binary plan cannot be converted. Run terraform show -json on it, then open the JSON.");
      name = choice.file;
      spin.start(`Converting ${choice.file} with terraform show -json (this runs terraform in this folder)`);
      // "./" so that a file name that starts with "-" is never read as an option.
      text = await terraform(["show", "-json", `./${choice.file}`], { cwd });
      spin.stop(`Converted ${choice.file}`);
    } else if (choice.kind === "plan") {
      const ok = await p.confirm({ message: `Run ${pc.cyan("terraform plan")} in ${pc.dim(cwd)}? This folder's configuration runs with your environment: it reads your state, calls your cloud provider with your credentials, and can run code from providers, modules, and data sources. Only do this in a folder you trust. Nothing is applied.` });
      if (cancelled(ok) || !ok) return ok === false ? (p.outro("No plan was made."), 0) : 130;
      const dir = mkdtempSync(join(tmpdir(), "vpcdiff-"));
      const out = join(dir, "tfplan");
      try {
        spin.start("Running terraform plan");
        await terraform(["plan", "-input=false", "-lock=false", `-out=${out}`], { cwd });
        spin.message("Reading the plan with terraform show -json");
        text = await terraform(["show", "-json", out], { cwd });
        spin.stop("Made a plan");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      name = "terraform plan";
    } else {
      const entered = await p.path({ message: "Path to a plan JSON file", root: cwd, validate: (v) => (!v ? "Enter a path." : !existsSync(resolve(cwd, v)) ? "No file at that path." : undefined) });
      if (cancelled(entered)) return 130;
      name = entered;
      text = readFileSync(resolve(cwd, entered), "utf8");
    }
  } catch (e) {
    spin.error("Could not read the plan");
    p.log.error((e as Error).message);
    p.outro(pc.red("Stopped."));
    return 2;
  }

  let result: Result;
  try {
    result = withoutControls(analyze(JSON.parse(text) as unknown));
  } catch (e) {
    p.log.error(e instanceof SyntaxError ? "That file is not valid JSON. Open the output of terraform show -json." : e instanceof PlanError ? e.message : String(e));
    p.outro(pc.red("Stopped."));
    return 2;
  }

  process.stdout.write(`\n${renderPretty(pc, result, { all: false, name })}\n`);

  // Next steps, until the user is done.
  for (;;) {
    const changed = visiblePaths(result, { all: false });
    const all = visiblePaths(result, { all: true });
    const next = await p.select<string>({
      message: "What next?",
      options: [
        ...(all.length > changed.length ? [{ value: "all", label: "List every path the engine checked", hint: `${all.length} paths` }] : []),
        ...(all.length ? [{ value: "path", label: "Show one path in full" }] : []),
        { value: "save", label: "Save a Markdown summary for the pull request" },
        { value: "done", label: "Done" },
      ],
    });
    if (cancelled(next) || next === "done") break;
    if (next === "all") process.stdout.write(`\n${renderPretty(pc, result, { all: true, name })}\n`);
    if (next === "path") {
      const id = all.length === 1 ? all[0]?.id : await p.select<string>({ message: "Which path?", options: all.map((x) => ({ value: x.id, label: `${x.to} ${portLabel(x)}`, hint: x.change })) });
      if (cancelled(id)) break;
      const path = all.find((x) => x.id === id);
      if (path) process.stdout.write(`\n${prettyPath(pc, path, true).join("\n")}\n\n`);
    }
    if (next === "save") {
      const file = await p.text({ message: "Save as", initialValue: "vpcdiff-summary.md", validate: (v) => (!v ? "Enter a file name." : undefined) });
      if (cancelled(file)) break;
      const target = resolve(cwd, file);
      // A link could send the write to a file elsewhere (and a dangling one would skip the prompt below).
      if (isSymlink(target)) {
        p.log.error(`${file} is a symbolic link. vpcdiff will not write through it; choose another name.`);
        continue;
      }
      if (existsSync(target)) {
        const over = await p.confirm({ message: `${file} exists. Replace it?`, initialValue: false });
        if (cancelled(over) || !over) continue;
      }
      writeFileSync(target, renderMarkdown(result, { all: false }));
      p.log.success(`Saved ${pc.cyan(file)}. Paste it into the pull request, or attach it.`);
    }
  }

  const fail = shouldFail(result, failOn);
  p.outro(fail ? pc.red(`Exit 1: this plan has paths that fail --fail-on ${failOn}.`) : pc.green("Exit 0: nothing fails the check."));
  return fail ? 1 : 0;
}
