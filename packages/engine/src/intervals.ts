/**
 * Sets of integers stored as sorted, disjoint, non-adjacent closed ranges.
 * Used for IPv4 address sets (0 to 2^32 - 1) and port sets (0 to 65535).
 */
export type Range = readonly [number, number];
export type IntervalSet = readonly Range[];

export const EMPTY: IntervalSet = [];
export const IPV4_MAX = 0xffffffff;
export const ALL_IPV4: IntervalSet = [[0, IPV4_MAX]];
export const ALL_PORTS: IntervalSet = [[0, 65535]];

export function fromRanges(ranges: readonly Range[]): IntervalSet {
  const sorted = ranges.filter(([lo, hi]) => lo <= hi).toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export function union(a: IntervalSet, b: IntervalSet): IntervalSet {
  return fromRanges([...a, ...b]);
}

export function intersect(a: IntervalSet, b: IntervalSet): IntervalSet {
  const out: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [alo, ahi] = a[i] as Range;
    const [blo, bhi] = b[j] as Range;
    const lo = Math.max(alo, blo);
    const hi = Math.min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
    if (ahi < bhi) i++;
    else j++;
  }
  return out;
}

export function subtract(a: IntervalSet, b: IntervalSet): IntervalSet {
  const out: Range[] = [];
  for (const [lo, hi] of a) {
    let start = lo;
    for (const [blo, bhi] of b) {
      if (bhi < start || blo > hi) continue;
      if (blo > start) out.push([start, blo - 1]);
      start = bhi + 1;
      if (start > hi) break;
    }
    if (start <= hi) out.push([start, hi]);
  }
  return out;
}

export function isEmpty(a: IntervalSet): boolean {
  return a.length === 0;
}

export function equals(a: IntervalSet, b: IntervalSet): boolean {
  return a.length === b.length && a.every(([lo, hi], i) => lo === b[i]?.[0] && hi === b[i]?.[1]);
}

export function contains(outer: IntervalSet, inner: IntervalSet): boolean {
  return isEmpty(subtract(inner, outer));
}

/** "10.0.0.1" to a number, or undefined if it is not a dotted IPv4 address. */
export function parseIpv4(text: string): number | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

export function formatIpv4(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
}

/**
 * IPv4 CIDR to a set. Host bits are ignored, as AWS does for route and rule CIDRs
 * that are not canonical. IPv6 returns undefined (not modeled yet).
 */
export function cidrToSet(cidr: string): IntervalSet | undefined {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return undefined;
  const addr = parseIpv4(m[1] as string);
  const len = Number(m[2]);
  if (addr === undefined || len > 32) return undefined;
  const size = 2 ** (32 - len);
  const lo = Math.floor(addr / size) * size;
  return [[lo, lo + size - 1]];
}

export function cidrPrefixLength(cidr: string): number | undefined {
  return cidrToSet(cidr) ? Number(cidr.split("/")[1]) : undefined;
}

/** The fewest CIDRs that cover exactly the set. */
export function setToCidrs(set: IntervalSet): string[] {
  const out: string[] = [];
  for (const [lo, hi] of set) {
    let start = lo;
    while (start <= hi) {
      let size = 1;
      while (start % (size * 2) === 0 && start + size * 2 - 1 <= hi) size *= 2;
      out.push(`${formatIpv4(start)}/${32 - Math.log2(size)}`);
      start += size;
    }
  }
  return out;
}

/** Port set as text: "5432", "1024-65535", "22, 80-443". */
export function formatPorts(set: IntervalSet): string {
  return set.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`)).join(", ");
}
