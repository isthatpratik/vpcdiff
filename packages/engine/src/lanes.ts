import type { Decision, HopKind, Outcome, Path } from "./types.js";

export type ColumnKey = "source" | HopKind | "target";

export interface Column {
  key: ColumnKey;
  label: string;
}

/** Columns of an internet path in the order traffic meets them: the request, the target, then the response. */
export const COLUMNS: Column[] = [
  { key: "source", label: "Internet" },
  { key: "public-ip", label: "Public IP" },
  { key: "internet-gateway", label: "Internet gateway" },
  { key: "nacl-inbound", label: "NACL inbound" },
  { key: "security-group", label: "Security groups" },
  { key: "target", label: "Target" },
  { key: "nacl-outbound", label: "NACL outbound" },
  { key: "route", label: "Return route" },
];

/** Columns of a path inside the VPC (docs/semantics/internal-paths.md), in the same order. */
export const INTERNAL_COLUMNS: Column[] = [
  { key: "source", label: "Source" },
  { key: "source-security-group", label: "Source SG out" },
  { key: "source-route", label: "Route" },
  { key: "source-nacl-outbound", label: "Source NACL out" },
  { key: "target-nacl-inbound", label: "Target NACL in" },
  { key: "security-group", label: "Target SG in" },
  { key: "target", label: "Target" },
  { key: "target-nacl-outbound", label: "Target NACL out" },
  { key: "source-nacl-inbound", label: "Source NACL in" },
  { key: "target-route", label: "Return route" },
];

/** Columns of a Google Cloud path from the internet (docs/semantics/gcp.md). */
export const GCP_COLUMNS: Column[] = [
  { key: "source", label: "Internet" },
  { key: "public-ip", label: "External IP" },
  { key: "firewall", label: "Firewall rules" },
  { key: "target", label: "Target" },
  { key: "route", label: "Return route" },
];

/** Columns of a Cloud SQL path: Google manages the route, so there is no route column. */
export const GCP_SQL_COLUMNS: Column[] = [
  { key: "source", label: "Internet" },
  { key: "public-ip", label: "Public IP" },
  { key: "firewall", label: "Authorized networks" },
  { key: "target", label: "Target" },
];

/** True for a path from the internet; false for a path inside the VPC. */
export const isInternet = (path: Pick<Path, "from">): boolean => path.from === "internet";

/** The columns for a path's kind. */
export const columnsOf = (path: Pick<Path, "from" | "provider"> & Partial<Pick<Path, "toType">>): Column[] =>
  path.provider === "gcp" ? (path.toType === "google_sql_database_instance" ? GCP_SQL_COLUMNS : GCP_COLUMNS) : isInternet(path) ? COLUMNS : INTERNAL_COLUMNS;

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
  /** The columns of this path's kind; every cell list follows this order. */
  columns: Column[];
  before: Lane;
  after: Lane;
  /** Per column: true when the two sides differ there (the source column is never marked). */
  changed: boolean[];
  /** The column to show first: the first one that changed, else the last one reached. */
  focus: number;
}

function laneOf(outcome: Outcome, path: Path): Lane {
  const COLUMNS = columnsOf(path);
  if (outcome.verdict === "absent") {
    return { outcome, cells: COLUMNS.map((c) => ({ state: "absent", resource: c.key === "target" ? path.to : "", rule: "Not in the plan on this side: the plan creates or destroys this resource." })) };
  }
  const cells = COLUMNS.map((col): Cell => {
    if (col.key === "source") return { state: "allow", resource: path.from, rule: outcome.sources.join(", ") };
    if (col.key === "target") {
      return outcome.verdict === "allowed"
        ? { state: "allow", resource: path.to, rule: `Reachable on ${path.protocol}/${path.ports}` }
        : { state: "not-reached", resource: path.to, rule: outcome.reason };
    }
    const hop = outcome.hops.find((h) => h.hop === col.key);
    return hop ? { state: hop.decision, resource: hop.resource, rule: hop.rule, doc: hop.doc } : { state: "not-reached", resource: "", rule: "Not checked: an earlier hop already decided the path." };
  });
  // The response hops come after the target in the picture, but the engine checks them
  // before it calls the target reachable; a stop there leaves the target not reached.
  return { outcome, cells };
}

export function lanesOf(path: Path): Lanes {
  const COLUMNS = columnsOf(path);
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
  const sg = COLUMNS.findIndex((c) => c.key === "security-group" || c.key === "firewall");
  // A path with outage risk opens on the hop whose resource the plan replaces.
  const risky = path.outageRisk ? after.cells.findIndex((c) => (path.outageRisk ?? []).some((r) => c.resource.split(", ").includes(r) || c.rule.includes(r))) : -1;
  const focus = oneSideAbsent ? sg : firstChanged >= 0 ? firstChanged : risky >= 0 ? risky : Math.max(reached(before), reached(after));
  return { columns: COLUMNS, before, after, changed, focus };
}

/**
 * Per column: true when the two cells differ at all, including when the resource exists
 * on one side only. Unlike `changed`, this never hides a difference; the hop table uses
 * it so a new or removed resource is never shown as "same before and after".
 */
export function rowsDiffer(lanes: Lanes): boolean[] {
  return lanes.before.cells.map((b, i) => {
    const a = lanes.after.cells[i];
    if (!a || lanes.columns[i]?.key === "source") return false;
    return b.state !== a.state || b.resource !== a.resource || b.rule !== a.rule;
  });
}
