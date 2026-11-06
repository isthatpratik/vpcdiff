// The human report for a terminal: the verdict first, in plain words, then only the hops
// that differ. Used when stdout is a terminal; CI logs and pipes keep the stable plain
// text from render.ts. Colors come from picocolors and follow NO_COLOR and FORCE_COLOR.
import type { Path, Result } from "@vpcdiff/engine";
import { changeWords, planVerdict, portLabel, verdictOf, type Tone } from "@vpcdiff/engine/explain";
import { COLUMNS, lanesOf, rowsDiffer, type CellState } from "@vpcdiff/engine/lanes";
import type pc from "picocolors";
import { visiblePaths, type RenderOptions } from "./render.ts";

/** The picocolors formatters; `pc.createColors(false)` gives plain text. */
export type Colors = ReturnType<typeof pc.createColors>;

const STATE: Record<CellState, string> = { allow: "allows", partial: "allows some", deny: "denies", unknown: "unknown", "not-reached": "not checked", absent: "not in plan" };

function tone(c: Colors, t: Tone, s: string): string {
  return t === "danger" ? c.red(s) : t === "success" ? c.green(s) : t === "warning" ? c.yellow(s) : c.bold(s);
}

function state(c: Colors, s: CellState, pad = 12): string {
  const text = STATE[s].padEnd(pad);
  return s === "deny" ? c.magenta(text) : s === "partial" ? c.yellow(text) : s === "allow" ? text : c.dim(text);
}

/**
 * One path: headline, what happens, the deciding rule, what to do, then the hops that
 * differ. With `full`, every hop instead, each with its rule on its own line, so long
 * rules wrap cleanly in a narrow terminal.
 */
export function prettyPath(c: Colors, path: Path, full = false): string[] {
  const v = verdictOf(path);
  const lanes = lanesOf(path);
  const oneSide = path.before.verdict === "absent" || path.after.verdict === "absent";
  const differs = oneSide ? COLUMNS.map(() => false) : rowsDiffer(lanes);
  const lines = [
    `${tone(c, v.tone, "●")} ${tone(c, v.tone, v.title)}`,
    `  ${c.bold(path.to)}  ${c.dim(portLabel(path))}  ${c.dim(changeWords(path))}`,
    `  ${v.body}`,
  ];
  if (v.doubt) lines.push(`  ${c.yellow("Partly undecided:")} ${v.doubt}`);
  if (v.cause?.rule) lines.push(`  ${c.dim(`Decided at the ${v.cause.hop} hop:`)}`, `    ${c.cyan(v.cause.rule)}`);
  if (v.action) lines.push(`  ${c.dim("What to do:")} ${v.action}`);
  if (v.snippet) lines.push(...v.snippet.split("\n").map((l) => `    ${c.cyan(l)}`));
  if (full) {
    lines.push("", `  ${c.dim("Every hop, before → after:")}`);
    COLUMNS.forEach((col, i) => {
      const b = lanes.before.cells[i];
      const a = lanes.after.cells[i];
      if (!b || !a) return;
      // The source row's "rule" is the list of sources, which the headline already says.
      const source = col.key === "source";
      const same = b.state === a.state && (source || b.rule === a.rule);
      lines.push(`  ${col.label.padEnd(18)}${same ? state(c, a.state, 0) : `${state(c, b.state, 0)} ${c.dim("→")} ${state(c, a.state, 0)}`}`);
      if (source) return;
      if (same || path.before.verdict === "absent") lines.push(`    ${c.dim(a.rule)}`);
      else if (path.after.verdict === "absent") lines.push(`    ${c.dim(b.rule)}`);
      else lines.push(`    ${c.dim(`before: ${b.rule}`)}`, `    ${c.dim(`after:  ${a.rule}`)}`);
    });
    return lines;
  }
  const rows = COLUMNS.map((col, i) => ({ col, i })).filter(({ i }) => differs[i]);
  if (rows.length) {
    lines.push("", `  ${c.dim("Hop".padEnd(18))}${c.dim("Before".padEnd(13))}${c.dim("After")}`);
    for (const { col, i } of rows) {
      const b = lanes.before.cells[i];
      const a = lanes.after.cells[i];
      if (!b || !a) continue;
      lines.push(`  ${col.label.padEnd(18)}${state(c, b.state)} ${state(c, a.state)}${a.resource ? c.dim(a.resource) : ""}`);
    }
    const same = COLUMNS.length - rows.length;
    if (same) lines.push(`  ${c.dim(`${same} other hops are the same before and after.`)}`);
  }
  return lines;
}

/** The whole report for a terminal. */
export function renderPretty(c: Colors, result: Result, opts: RenderOptions & { name?: string | undefined }): string {
  const s = result.summary;
  const risk = result.paths.filter((p) => p.outageRisk?.length).length;
  const count = (n: number, word: string, color: (x: string) => string) => (n ? color(`${n} ${word}`) : c.dim(`${n} ${word}`));
  const lines = [
    `${c.bold("vpcdiff")}${opts.name ? `  ${c.dim(opts.name)}` : ""}`,
    (() => {
      const pv = planVerdict(result);
      return `${tone(c, pv.tone, pv.title)}${c.dim(` · ${pv.detail}`)}`;
    })(),
    [count(s.added, "opened", c.red), count(s.removed, "closed", c.green), count(s.changed, "changed", c.yellow), count(risk, "outage risk", c.yellow), count(s.unknown, "unknown", c.bold)].join(c.dim(" · ")),
  ];
  const paths = visiblePaths(result, opts);
  if (!paths.length) {
    lines.push("", result.paths.length ? `${c.green("✓")} No path from the internet changes. ${c.dim(`(${result.paths.length} checked; --all lists them)`)}` : `${c.green("✓")} No security group opens a port to a public address, so there is no path from the internet to check.`);
  }
  for (const p of paths) lines.push("", ...prettyPath(c, p));
  if (result.notes.length) {
    lines.push("", c.dim(`Not modeled yet (${result.notes.length}):`));
    for (const n of result.notes) lines.push(`  ${c.dim("·")} ${n.resource} ${c.dim(`— ${n.message}`)}`);
  }
  return `${lines.join("\n")}\n`;
}
