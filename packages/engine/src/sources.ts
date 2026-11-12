// Short text for a list of allowed source CIDRs.
import { PUBLIC_IPV4 } from "./evaluate.js";
import { cidrToSet, setToCidrs, subtract, union, type IntervalSet } from "./intervals.js";

/**
 * The public IPv4 addresses that a list of allowed CIDRs leaves out, when that list is
 * shorter: "internet except 198.51.100.0/24" reads better than 68 CIDRs.
 */
// Addresses that are never internet sources for an Azure path: the platform address and the
// public ranges that every subnet's system routes drop (docs/semantics/azure.md). They are
// left out of "except", because no rule of the user's leaves them out.
const AZURE_NOT_INTERNET: IntervalSet = ["168.63.129.16/32", "157.59.0.0/16", "104.147.0.0/16", "104.146.0.0/17"].reduce<IntervalSet>((acc, c) => union(acc, cidrToSet(c) ?? []), []);

export function exceptOf(sources: string[], provider?: "gcp" | "azure"): string[] | undefined {
  if (sources.length <= 6) return undefined;
  let allowed: IntervalSet = [];
  for (const c of sources) {
    const set = cidrToSet(c);
    if (!set) return undefined;
    allowed = union(allowed, set);
  }
  const missing = setToCidrs(subtract(subtract(PUBLIC_IPV4, allowed), provider === "azure" ? AZURE_NOT_INTERNET : []));
  return missing.length && missing.length <= 6 && missing.length < sources.length ? missing : undefined;
}

/** Allowed sources in short form: "internet", "internet except ...", or the CIDRs. */
export function sourcesText(sources: string[], family?: "ipv6", provider?: "gcp" | "azure"): string {
  const except = family === "ipv6" ? undefined : exceptOf(sources, provider);
  return except ? `internet except ${except.join(", ")}` : sources.join(", ");
}

// C0 and C1 control characters except tab and newline. A plan comes from the change under
// review, so a resource name could hold a terminal escape sequence (for example an OSC 8
// link or "clear screen"). Text output must never pass one through.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** A copy of `value` with control characters in every string shown as U+FFFD. */
export function withoutControls<T>(value: T): T {
  if (typeof value === "string") return value.replace(CONTROL, "�") as T;
  if (Array.isArray(value)) return value.map((v) => withoutControls(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [withoutControls(k), withoutControls(v)])) as T;
  return value;
}
