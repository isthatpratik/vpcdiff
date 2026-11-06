import type { Change, Hop, Outcome, Path, Result } from "@vpcdiff/engine";

const ORDER: Change[] = ["added", "removed", "changed", "unknown", "unchanged"];
const LABEL: Record<Change, string> = { added: "ADDED", removed: "REMOVED", changed: "CHANGED", unknown: "UNKNOWN", unchanged: "UNCHANGED" };
const ICON: Record<Change, string> = { added: "🔴", removed: "🟢", changed: "🟠", unknown: "⚪", unchanged: "·" };

export interface RenderOptions {
  /** Include unchanged paths. */
  all: boolean;
}

export function visiblePaths(result: Result, opts: RenderOptions): Path[] {
  return result.paths
    .filter((p) => opts.all || p.change !== "unchanged" || p.outageRisk)
    .toSorted((a, b) => ORDER.indexOf(a.change) - ORDER.indexOf(b.change) || a.id.localeCompare(b.id));
}

export function summaryLine(result: Result): string {
  const s = result.summary;
  const risk = result.paths.filter((p) => p.outageRisk).length;
  return `${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unknown} unknown, ${s.unchanged} unchanged${risk ? `; ${risk} with outage risk` : ""}`;
}

const riskLine = (p: Path) => `outage risk: the plan replaces ${(p.outageRisk ?? []).join(", ")} by deleting before creating; traffic on this path can drop during apply (consider create_before_destroy)`;

function outcomeLine(o: Outcome): string {
  switch (o.verdict) {
    case "allowed":
      return `allowed from ${o.sources.join(", ")}${o.reason ? ` (also undecided: ${o.reason})` : ""}`;
    case "absent":
      return "resource does not exist";
    default: {
      const last = o.hops.at(-1);
      return `${o.verdict}${last ? ` at ${last.hop}` : ""}: ${o.reason}`;
    }
  }
}

function hopLine(h: Hop): string {
  return `${h.hop.padEnd(16)} ${h.decision.padEnd(7)} ${h.rule}`;
}

/** Plain text for a terminal. */
export function renderText(result: Result, opts: RenderOptions): string {
  const lines = [`vpcdiff: ${summaryLine(result)}`];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("", "No reachability changes from the internet.");
  for (const p of paths) {
    lines.push("", `${LABEL[p.change].padEnd(9)} ${p.from} -> ${p.to}  ${p.protocol}/${p.ports}`);
    lines.push(`  before: ${outcomeLine(p.before)}`, `  after:  ${outcomeLine(p.after)}`);
    if (p.outageRisk) lines.push(`  ${riskLine(p)}`);
    const explain = p.after.verdict === "absent" ? p.before : p.after;
    for (const h of explain.hops) lines.push(`    ${hopLine(h)}`);
  }
  if (result.notes.length) {
    lines.push("", "Notes:");
    for (const n of result.notes) lines.push(`  ${n.resource}: ${n.message}`);
  }
  return `${lines.join("\n")}\n`;
}

const md = (text: string) => text.replace(/[|\\`*_<>]/g, (c) => `\\${c}`);

/** GitHub-flavored Markdown for a pull request comment or job summary. */
export function renderMarkdown(result: Result, opts: RenderOptions): string {
  const lines = ["### vpcdiff: internet reachability", "", summaryLine(result), ""];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("No reachability changes from the internet.", "");
  else {
    lines.push("| | Path | Port | Before | After |", "|---|---|---|---|---|");
    for (const p of paths) lines.push(`| ${ICON[p.change]} ${p.change}${p.outageRisk ? " ⚠️" : ""} | internet → \`${p.to}\` | ${p.protocol}/${p.ports} | ${md(outcomeLine(p.before))} | ${md(outcomeLine(p.after))} |`);
    lines.push("");
    for (const p of paths.filter((x) => x.outageRisk)) lines.push(`> ⚠️ \`${p.to}\` ${p.protocol}/${p.ports}: ${md(riskLine(p))}`, "");
    for (const p of paths) {
      const explain = p.after.verdict === "absent" ? p.before : p.after;
      if (!explain.hops.length) continue;
      lines.push(`<details><summary>${md(p.to)} ${p.protocol}/${p.ports}: hops (${p.after.verdict === "absent" ? "before" : "after"})</summary>`, "", "| Hop | Decision | Rule |", "|---|---|---|");
      for (const h of explain.hops) lines.push(`| [${h.hop}](${h.doc}) | ${h.decision} | ${md(h.rule)} |`);
      lines.push("", "</details>", "");
    }
  }
  if (result.notes.length) {
    lines.push("<details><summary>Notes</summary>", "");
    for (const n of result.notes) lines.push(`- \`${n.resource}\`: ${md(n.message)}`);
    lines.push("", "</details>", "");
  }
  return `${lines.join("\n")}\n`;
}

export type FailOn = "added" | "changed" | "unknown" | "never";

/** Exit code policy: 1 when the plan adds exposure at or above the `failOn` level. */
export function shouldFail(result: Result, failOn: FailOn): boolean {
  const s = result.summary;
  if (failOn === "never") return false;
  if (failOn === "added") return s.added > 0;
  if (failOn === "changed") return s.added + s.changed > 0;
  return s.added + s.changed + s.unknown > 0;
}
