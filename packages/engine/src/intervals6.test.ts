import { describe, expect, it } from "vitest";
import { cidr6ToSet, formatIpv6, parseIpv6, set6ToCidrs, subtract6, union6 } from "./intervals6.js";

describe("IPv6 sets", () => {
  it("parses and formats addresses with :: compression", () => {
    expect(formatIpv6(parseIpv6("2001:0db8:0000:0000:0000:0000:0000:0001") as bigint)).toBe("2001:db8::1");
    expect(formatIpv6(parseIpv6("::") as bigint)).toBe("::");
    expect(parseIpv6("2001:db8::1::2")).toBeUndefined();
    expect(parseIpv6("10.0.0.1")).toBeUndefined();
  });

  it("turns CIDRs into sets and back, ignoring host bits", () => {
    expect(set6ToCidrs(cidr6ToSet("2001:db8::1/32") ?? [])).toEqual(["2001:db8::/32"]);
    expect(set6ToCidrs(cidr6ToSet("::/0") ?? [])).toEqual(["::/0"]);
    expect(cidr6ToSet("10.0.0.0/8")).toBeUndefined();
  });

  it("subtracts and merges", () => {
    const all = cidr6ToSet("2000::/3") ?? [];
    const doc = cidr6ToSet("2001:db8::/32") ?? [];
    expect(set6ToCidrs(union6(subtract6(all, doc), doc))).toEqual(["2000::/3"]);
    expect(set6ToCidrs(subtract6(cidr6ToSet("2001:db8::/31") ?? [], doc))).toEqual(["2001:db9::/32"]);
  });
});
