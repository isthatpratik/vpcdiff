import { describe, expect, it } from "vitest";
import {
  cidrToSet,
  equals,
  fromRanges,
  intersect,
  isEmpty,
  parseIpv4,
  setToCidrs,
  subtract,
  union,
} from "./intervals.js";

describe("interval sets", () => {
  it("normalizes, merges adjacent and overlapping ranges", () => {
    expect(fromRanges([[5, 9], [1, 3], [4, 4], [20, 30], [25, 40]])).toEqual([[1, 9], [20, 40]]);
  });

  it("does set algebra", () => {
    const a = fromRanges([[0, 10], [20, 30]]);
    const b = fromRanges([[5, 25]]);
    expect(union(a, b)).toEqual([[0, 30]]);
    expect(intersect(a, b)).toEqual([[5, 10], [20, 25]]);
    expect(subtract(a, b)).toEqual([[0, 4], [26, 30]]);
    expect(isEmpty(subtract(b, b))).toBe(true);
    expect(equals(a, fromRanges([[20, 30], [0, 10]]))).toBe(true);
  });
});

const cidr = (c: string) => {
  const set = cidrToSet(c);
  if (!set) throw new Error(`bad CIDR in test: ${c}`);
  return set;
};

describe("IPv4", () => {
  it("parses addresses and rejects bad input", () => {
    expect(parseIpv4("10.0.0.1")).toBe(167772161);
    expect(parseIpv4("255.255.255.255")).toBe(4294967295);
    expect(parseIpv4("256.0.0.1")).toBeUndefined();
    expect(parseIpv4("10.0.0")).toBeUndefined();
  });

  it("turns CIDRs into sets, including non-canonical ones", () => {
    expect(cidrToSet("0.0.0.0/0")).toEqual([[0, 4294967295]]);
    expect(cidrToSet("10.0.1.7/24")).toEqual([[167772416, 167772671]]);
    expect(cidrToSet("10.0.0.0/33")).toBeUndefined();
    expect(cidrToSet("::/0")).toBeUndefined();
  });

  it("turns sets back into the fewest CIDRs", () => {
    const internet = subtract(cidr("0.0.0.0/0"), cidr("10.0.0.0/16"));
    const cidrs = setToCidrs(internet);
    expect(cidrs[0]).toBe("0.0.0.0/5");
    expect(cidrs).toContain("10.1.0.0/16");
    expect(cidrs).toHaveLength(16);
    expect(setToCidrs(cidr("10.0.1.0/24"))).toEqual(["10.0.1.0/24"]);
  });
});
