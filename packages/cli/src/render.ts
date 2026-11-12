import type { Change, Hop, Outcome, Path, Result } from "@vpcdiff/engine";
import { htmlText, mdCode, mdText, sourcesText } from "@vpcdiff/engine/explain";

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

function outcomeLine(o: Outcome, provider?: Path["provider"]): string {
  switch (o.verdict) {
    case "allowed":
      return `allowed from ${sourcesText(o.sources, undefined, provider)}${o.reason ? ` (also undecided: ${o.reason})` : ""}`;
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
  if (!paths.length) lines.push("", "No reachability changes.");
  for (const p of paths) {
    lines.push("", `${LABEL[p.change].padEnd(9)} ${p.from}${p.family === "ipv6" ? " (IPv6)" : ""} -> ${p.to}  ${p.protocol}/${p.ports}`);
    lines.push(`  before: ${outcomeLine(p.before, p.provider)}`, `  after:  ${outcomeLine(p.after, p.provider)}`);
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

// Plan strings are untrusted (for_each keys can hold any characters): escape Markdown and
// HTML, stop @-mentions, and keep table cells intact.
const md = (text: string) => mdText(text);
const code = (text: string) => mdCode(text).replaceAll("|", "\\|");

/** GitHub-flavored Markdown for a pull request comment or job summary. */
export function renderMarkdown(result: Result, opts: RenderOptions): string {
  const lines = ["### vpcdiff: reachability", "", summaryLine(result), ""];
  const paths = visiblePaths(result, opts);
  if (!paths.length) lines.push("No reachability changes.", "");
  else {
    lines.push("| | Path | Port | Before | After |", "|---|---|---|---|---|");
    for (const p of paths) lines.push(`| ${ICON[p.change]} ${p.change}${p.outageRisk ? " ⚠️" : ""} | ${p.from === "internet" ? (p.family === "ipv6" ? "internet (IPv6)" : "internet") : code(p.from)} → ${code(p.to)} | ${p.protocol}/${p.ports} | ${md(outcomeLine(p.before, p.provider))} | ${md(outcomeLine(p.after, p.provider))} |`);
    lines.push("");
    for (const p of paths.filter((x) => x.outageRisk)) lines.push(`> ⚠️ ${p.from === "internet" ? "" : `${code(p.from)} → `}${code(p.to)} ${p.protocol}/${p.ports}: ${md(riskLine(p))}`, "");
    for (const p of paths) {
      const explain = p.after.verdict === "absent" ? p.before : p.after;
      if (!explain.hops.length) continue;
      lines.push(`<details><summary>${p.from === "internet" ? "" : `${htmlText(p.from)} → `}${htmlText(p.to)} ${p.protocol}/${p.ports}: hops (${p.after.verdict === "absent" ? "before" : "after"})</summary>`, "", "| Hop | Decision | Rule |", "|---|---|---|");
      for (const h of explain.hops) lines.push(`| [${h.hop}](${h.doc}) | ${h.decision} | ${md(h.rule)} |`);
      lines.push("", "</details>", "");
    }
  }
  if (result.notes.length) {
    lines.push("<details><summary>Notes</summary>", "");
    for (const n of result.notes) lines.push(`- ${code(n.resource)}: ${md(n.message)}`);
    lines.push("", "</details>", "");
  }
  return `${lines.join("\n")}\n`;
}

export type FailOn = "added" | "changed" | "unknown" | "never";

/** Exit code policy: 1 when the plan adds exposure at or above the `failOn` level. */
export function shouldFail(result: Result, failOn: FailOn): boolean {
  // "added" means a new exposure to the internet. A path inside the VPC that the plan
  // opens or cuts counts as "changed": it needs a review, but is often intended.
  const count = (f: (p: Path) => boolean) => result.paths.filter(f).length;
  const internet = (p: Path) => p.from === "internet";
  if (failOn === "never") return false;
  const added = count((p) => internet(p) && p.change === "added");
  if (failOn === "added") return added > 0;
  const changed = count((p) => p.change === "changed" || (!internet(p) && (p.change === "added" || p.change === "removed")));
  if (failOn === "changed") return added + changed > 0;
  return added + changed + result.summary.unknown > 0;
}
