// Short text for a list of allowed source CIDRs.
import { PUBLIC_IPV4 } from "./evaluate.js";
import { cidrToSet, setToCidrs, subtract, union, type IntervalSet } from "./intervals.js";

/**
 * The public IPv4 addresses that a list of allowed CIDRs leaves out, when that list is
 * shorter: "internet except 198.51.100.0/24" reads better than 68 CIDRs.
 */
export function exceptOf(sources: string[]): string[] | undefined {
  if (sources.length <= 6) return undefined;
  let allowed: IntervalSet = [];
  for (const c of sources) {
    const set = cidrToSet(c);
    if (!set) return undefined;
    allowed = union(allowed, set);
  }
  const missing = setToCidrs(subtract(PUBLIC_IPV4, allowed));
  return missing.length && missing.length <= 6 && missing.length < sources.length ? missing : undefined;
}

/** Allowed sources in short form: "internet", "internet except ...", or the CIDRs. */
export function sourcesText(sources: string[], family?: "ipv6"): string {
  const except = family === "ipv6" ? undefined : exceptOf(sources);
  return except ? `internet except ${except.join(", ")}` : sources.join(", ");
}
