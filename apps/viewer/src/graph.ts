import type { Decision, HopKind, Outcome, Path } from "@vpcdiff/engine";

export type ColumnKey = "source" | HopKind | "target";

/** Columns in the order traffic meets them: the request, the target, then the response. */
export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "source", label: "Internet" },
  { key: "public-ip", label: "Public IP" },
  { key: "internet-gateway", label: "Internet gateway" },
  { key: "nacl-inbound", label: "NACL inbound" },
  { key: "security-group", label: "Security groups" },
  { key: "target", label: "Target" },
  { key: "nacl-outbound", label: "NACL outbound" },
  { key: "route", label: "Return route" },
];

export type CellState = Decision | "not-reached" | "absent";

export interface Cell {
  state: CellState;
  resource: string;
  rule: string;
  doc?: string;
}

export interface Lane {
  outcome: Outcome;
  cells: Cell[];
}

export interface Lanes {
  before: Lane;
  after: Lane;
  /** Per column: true when the two sides differ there (the source column is never marked). */
  changed: boolean[];
  /** The column to show first: the first one that changed, else the last one reached. */
  focus: number;
}

function laneOf(outcome: Outcome, path: Path): Lane {
  if (outcome.verdict === "absent") {
    return { outcome, cells: COLUMNS.map((c) => ({ state: "absent", resource: c.key === "target" ? path.to : "", rule: "The resource does not exist on this side of the plan." })) };
  }
  const cells = COLUMNS.map((col): Cell => {
    if (col.key === "source") return { state: "allow", resource: "internet", rule: outcome.sources.join(", ") };
    if (col.key === "target") {
      return outcome.verdict === "allowed"
        ? { state: "allow", resource: path.to, rule: `Reachable on ${path.protocol}/${path.ports}` }
        : { state: "not-reached", resource: path.to, rule: outcome.reason };
    }
    const hop = outcome.hops.find((h) => h.hop === col.key);
    return hop ? { state: hop.decision, resource: hop.resource, rule: hop.rule, doc: hop.doc } : { state: "not-reached", resource: "", rule: "Not evaluated: an earlier hop decided the path." };
  });
  // The response hops come after the target in the picture, but the engine checks them
  // before it calls the target reachable; a stop there leaves the target not reached.
  return { outcome, cells };
}

export function lanesOf(path: Path): Lanes {
  const before = laneOf(path.before, path);
  const after = laneOf(path.after, path);
  // When one side does not exist, every column differs; marking them all says nothing.
  const oneSideAbsent = path.before.verdict === "absent" || path.after.verdict === "absent";
  const changed = COLUMNS.map((c, i) => {
    if (c.key === "source" || oneSideAbsent) return false;
    const b = before.cells[i];
    const a = after.cells[i];
    return b?.state !== a?.state || b?.resource !== a?.resource || b?.rule !== a?.rule;
  });
  const firstChanged = changed.indexOf(true);
  const reached = (lane: Lane) => lane.cells.reduce((last, c, i) => (c.state !== "not-reached" && c.state !== "absent" ? i : last), 0);
  const sg = COLUMNS.findIndex((c) => c.key === "security-group");
  const focus = oneSideAbsent ? sg : firstChanged >= 0 ? firstChanged : Math.max(reached(before), reached(after));
  return { before, after, changed, focus };
}
