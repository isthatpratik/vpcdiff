// Where the viewer is, so a reload comes back to it. An example plan and the selected
// path live in the URL hash (#example=sg-5432-opened&path=...). A plan the user opened
// is kept in this tab's sessionStorage only: it never leaves the device, and the
// browser deletes it when the tab closes. Nothing here makes a network request.

const KEY = "vpcdiff:plan";
/** Larger plans are not kept; a reload then returns to the start screen. */
const MAX_KEEP = 5_000_000;

export type Place = { kind: "example"; id: string; path?: string } | { kind: "file"; path?: string } | { kind: "none" };

export function readPlace(): Place {
  const q = new URLSearchParams(window.location.hash.slice(1));
  const path = q.get("path") ?? undefined;
  const example = q.get("example");
  if (example) return { kind: "example", id: example, ...(path ? { path } : {}) };
  if (q.has("plan")) return { kind: "file", ...(path ? { path } : {}) };
  return { kind: "none" };
}

function write(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const hash = q.toString();
  // replaceState: moving around inside a plan does not fill the back button's history.
  window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname + window.location.search);
}

export function placeExample(id: string) {
  sessionStorage.removeItem(KEY);
  write({ example: id });
}

/** Keeps the plan for this tab, when it is small enough. Returns false when not kept. */
export function placeFile(name: string, text: string): boolean {
  try {
    if (text.length > MAX_KEEP) throw new Error("too large");
    sessionStorage.setItem(KEY, JSON.stringify({ name, text }));
    write({ plan: "" });
    return true;
  } catch {
    sessionStorage.removeItem(KEY);
    write({});
    return false;
  }
}

export function keptFile(): { name: string; text: string } | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { name?: unknown; text?: unknown };
    return typeof v.name === "string" && typeof v.text === "string" ? { name: v.name, text: v.text } : undefined;
  } catch {
    return undefined;
  }
}

/** Records the selected path, keeping whatever plan the hash names. */
export function placePath(path: string | undefined) {
  const q = new URLSearchParams(window.location.hash.slice(1));
  write({ example: q.get("example") ?? undefined, plan: q.has("plan") ? "" : undefined, path });
}

export function clearPlace() {
  sessionStorage.removeItem(KEY);
  write({});
}
