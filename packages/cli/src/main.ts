import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { analyze, ENGINE_VERSION, MAX_PLAN_CHARS, PlanError, toJson } from "@vpcdiff/engine";
import { withoutControls } from "@vpcdiff/engine/explain";
import { renderPretty, type Colors } from "./pretty.ts";
import { renderMarkdown, renderText, shouldFail, type FailOn } from "./render.ts";

const USAGE = `Usage: vpcdiff [options] <plan.json | ->
       vpcdiff            (in a terminal: find a plan here and walk through it)

Shows which resources a Terraform plan makes reachable from the internet or from
each other inside a VPC, or no longer reachable, with the deciding rule at each hop.

Make the input with:
  terraform plan -out=tfplan && terraform show -json tfplan > plan.json

Options:
  -f, --format <text|json|markdown>       Output format (default: text)
  -a, --all                               Also show unchanged paths
      --fail-on <added|changed|unknown|never>
                                          Exit 1 when the plan has paths of this
                                          kind or worse (default: added). added is
                                          a new exposure to the internet; changed
                                          also counts paths inside the VPC that
                                          the plan opens or cuts
  -v, --version                           Print the version
  -h, --help                              Print this help

In a terminal, text output is the readable report in color. In pipes and CI it
is stable plain text. Set NO_COLOR=1 to turn color off.

Exit codes: 0 no failing paths, 1 failing paths, 2 usage or input error.
`;

const FORMATS = ["text", "json", "markdown"] as const;
const FAIL_ON: FailOn[] = ["added", "changed", "unknown", "never"];

export type Io = {
  stdin: () => string;
  out: (s: string) => void;
  err: (s: string) => void;
  /** Set when stdout is a terminal: text output becomes the readable report. */
  pretty?: Colors;
};

export function run(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f", default: "text" },
        all: { type: "boolean", short: "a", default: false },
        "fail-on": { type: "string", default: "added" },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    io.err(`vpcdiff: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  if (values.version) {
    io.out(`vpcdiff ${ENGINE_VERSION}\n`);
    return 0;
  }
  const format = values.format as (typeof FORMATS)[number];
  const failOn = values["fail-on"] as FailOn;
  if (!FORMATS.includes(format)) return usage(io, `unknown format "${values.format}"`);
  if (!FAIL_ON.includes(failOn)) return usage(io, `unknown --fail-on value "${values["fail-on"]}"`);
  if (positionals.length !== 1) return usage(io, "expected one plan file, or - for stdin");

  const source = positionals[0] as string;
  let text: string;
  try {
    text = source === "-" ? io.stdin() : readFileSync(source, "utf8");
    if (text.length > MAX_PLAN_CHARS) throw new Error(`the plan is larger than ${MAX_PLAN_CHARS / 1024 / 1024} MB`);
  } catch (e) {
    io.err(`vpcdiff: cannot read ${source}: ${(e as Error).message}\n`);
    return 2;
  }
  let result;
  try {
    result = analyze(JSON.parse(text));
  } catch (e) {
    const why = e instanceof SyntaxError ? "the file is not valid JSON" : e instanceof PlanError ? e.message : String(e);
    io.err(`vpcdiff: ${source}: ${why}\n`);
    return 2;
  }
  const opts = { all: values.all };
  const name = source === "-" ? undefined : source;
  // Text and Markdown show plan strings; JSON escapes control characters by itself.
  const shown = withoutControls(result);
  io.out(format === "json" ? toJson(result) : format === "markdown" ? renderMarkdown(shown, opts) : io.pretty ? renderPretty(io.pretty, shown, { ...opts, name }) : renderText(shown, opts));
  return shouldFail(result, failOn) ? 1 : 0;
}

function usage(io: { err: (s: string) => void }, message: string): number {
  io.err(`vpcdiff: ${message}\n\n${USAGE}`);
  return 2;
}
