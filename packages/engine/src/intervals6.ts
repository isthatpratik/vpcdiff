/**
 * IPv6 address sets: sorted, disjoint, non-adjacent closed ranges of 128-bit integers
 * (bigint). The same operations as intervals.ts, which holds IPv4 and ports.
 */
export type Range6 = readonly [bigint, bigint];
export type Set6 = readonly Range6[];

export const EMPTY6: Set6 = [];
export const IPV6_MAX = (1n << 128n) - 1n;

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function fromRanges6(ranges: readonly Range6[]): Set6 {
  const sorted = ranges.filter(([lo, hi]) => lo <= hi).toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const out: [bigint, bigint][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1n) last[1] = max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export const union6 = (a: Set6, b: Set6): Set6 => fromRanges6([...a, ...b]);

export function intersect6(a: Set6, b: Set6): Set6 {
  const out: Range6[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [alo, ahi] = a[i] as Range6;
    const [blo, bhi] = b[j] as Range6;
    const lo = max(alo, blo);
    const hi = min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
    if (ahi < bhi) i++;
    else j++;
  }
  return out;
}

export function subtract6(a: Set6, b: Set6): Set6 {
  const out: Range6[] = [];
  for (const [lo, hi] of a) {
    let start = lo;
    for (const [blo, bhi] of b) {
      if (bhi < start || blo > hi) continue;
      if (blo > start) out.push([start, blo - 1n]);
      start = bhi + 1n;
      if (start > hi) break;
    }
    if (start <= hi) out.push([start, hi]);
  }
  return out;
}

export const isEmpty6 = (a: Set6): boolean => a.length === 0;
export const equals6 = (a: Set6, b: Set6): boolean => a.length === b.length && a.every(([lo, hi], i) => lo === b[i]?.[0] && hi === b[i]?.[1]);
export const contains6 = (outer: Set6, inner: Set6): boolean => isEmpty6(subtract6(inner, outer));

/** "2001:db8::1" to a bigint, or undefined. Accepts "::" compression; not IPv4-mapped forms. */
export function parseIpv6(text: string): bigint | undefined {
  const t = text.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(t) || t.split("::").length > 2) return undefined;
  const [head = "", tail] = t.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0 || (tail === undefined && left.length !== 8)) return undefined;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.reduce((n, g) => (n << 16n) | BigInt(Number.parseInt(g, 16)), 0n);
}

/** Canonical text (RFC 5952): lower case, longest run of zero groups compressed. */
export function formatIpv6(n: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - i * 16)) & 0xffffn));
  let best = [-1, 0];
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > (best[1] as number) && j - i > 1) best = [i, j - i];
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  const [at, len] = best as [number, number];
  if (at < 0) return hex.join(":");
  return `${hex.slice(0, at).join(":")}::${hex.slice(at + len).join(":")}`;
}

/** IPv6 CIDR to a set; host bits are ignored. Undefined for anything else (IPv4 too). */
export function cidr6ToSet(cidr: string): Set6 | undefined {
  const m = /^([0-9a-fA-F:]+)\/(\d{1,3})$/.exec(cidr.trim());
  if (!m) return undefined;
  const addr = parseIpv6(m[1] as string);
  const len = Number(m[2]);
  if (addr === undefined || len > 128) return undefined;
  const size = 1n << BigInt(128 - len);
  const lo = (addr / size) * size;
  return [[lo, lo + size - 1n]];
}

export const prefixLength6 = (cidr: string): number | undefined => (cidr6ToSet(cidr) ? Number(cidr.split("/")[1]) : undefined);

/** The fewest CIDRs that cover exactly the set. */
export function set6ToCidrs(set: Set6): string[] {
  const out: string[] = [];
  for (const [lo, hi] of set) {
    let start = lo;
    while (start <= hi) {
      let bits = 0;
      while (bits < 128 && start % (1n << BigInt(bits + 1)) === 0n && start + (1n << BigInt(bits + 1)) - 1n <= hi) bits++;
      out.push(`${formatIpv6(start)}/${128 - bits}`);
      start += 1n << BigInt(bits);
    }
  }
  return out;
}
