// Status vocabulary from DESIGN.md (section 9): one label and one color per meaning.
import type { Change, Verdict } from "@vpcdiff/engine";
import { Tag, type TagHue, type TagStatus } from "@/components/litt/tag";
import type { CellState } from "../graph.ts";

export const CHANGE_LABEL: Record<Change, string> = { added: "New exposure", removed: "Closed", changed: "Sources changed", unknown: "Unknown", unchanged: "No change" };
export const STAT_LABEL: Record<Change, string> = { added: "Opened", removed: "Closed", changed: "Changed", unknown: "Unknown", unchanged: "Same" };
export const CHANGE_ORDER: Change[] = ["added", "removed", "changed", "unknown", "unchanged"];
const CHANGE_STATUS: Record<Change, TagStatus> = { added: "danger", removed: "success", changed: "warning", unknown: "neutral", unchanged: "neutral" };
export const CHANGE_TEXT: Record<Change, string> = { added: "text-litt-danger", removed: "text-litt-success", changed: "text-litt-warning", unknown: "text-litt-fg-subtle", unchanged: "text-litt-fg-muted" };

export const VERDICT_LABEL: Record<Verdict, string> = { allowed: "Reachable", blocked: "Blocked", unknown: "Unknown", absent: "Does not exist" };

// Hop decisions: the site is monochrome, so "allows" is plain ink. Only a decision that
// stops or narrows traffic gets a hue, and those hues are not the status colors: red and
// green already mean new and closed exposure (DESIGN.md, section 3).
export const STATE_LABEL: Record<CellState, string> = { allow: "Allows", partial: "Allows some", deny: "Denies", unknown: "Unknown", "not-reached": "Not reached", absent: "Absent" };
const STATE_HUE: Partial<Record<CellState, TagHue>> = { partial: "amber", deny: "rose" };

export function ChangeTag({ change }: { change: Change }) {
  return <Tag status={CHANGE_STATUS[change]}>{CHANGE_LABEL[change]}</Tag>;
}

export function DecisionTag({ state }: { state: CellState }) {
  const hue = STATE_HUE[state];
  if (hue) return <Tag hue={hue}>{STATE_LABEL[state]}</Tag>;
  return state === "allow" ? <Tag raised>{STATE_LABEL[state]}</Tag> : <Tag status="neutral">{STATE_LABEL[state]}</Tag>;
}
