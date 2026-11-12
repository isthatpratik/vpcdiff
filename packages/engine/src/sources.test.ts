// Short text for allowed sources: "internet except ..." instead of a long CIDR list.
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { whoText } from "./explain.js";
import { sourcesText } from "./sources.js";
import { PUBLIC_IPV4 } from "./evaluate.js";
import { cidrToSet, setToCidrs, subtract } from "./intervals.js";
import { plan, type Res, type Values } from "./testkit.js";

const fw = (name: string, over: Values): Res => ({ type: "google_compute_firewall", name, after: { name, network: "main", direction: "INGRESS", priority: 1000, allow: [], deny: [], source_ranges: ["0.0.0.0/0"], target_tags: null, target_service_accounts: null, disabled: false, ...over } });
const carved = () =>
  analyze(
    plan([
      { type: "google_compute_network", name: "main", after: { id: "n", name: "main", delete_default_routes_on_create: false } },
      fw("ssh", { allow: [{ protocol: "tcp", ports: ["22"] }] }),
      fw("block", { priority: 900, source_ranges: ["198.51.100.0/24"], deny: [{ protocol: "tcp", ports: ["22"] }] }),
      { type: "google_compute_instance", name: "web", after: { id: "i", tags: [], service_account: [], network_interface: [{ network: "main", access_config: [{}] }] } },
    ]),
  ).paths[0];

describe("sourcesText", () => {
  it("names the left-out range when that is shorter than the allowed CIDRs", () => {
    const p = carved();
    expect(p?.after.sources.length).toBeGreaterThan(6);
    expect(sourcesText(p?.after.sources ?? [])).toBe("internet except 198.51.100.0/24");
    expect(whoText(p?.after.sources ?? [])).toBe("any public IPv4 address except 198.51.100.0/24");
  });

  it("leaves Azure's fixed platform exclusions out of \"except\"", () => {
    let set = PUBLIC_IPV4;
    for (const c of ["168.63.129.16/32", "157.59.0.0/16", "104.147.0.0/16", "104.146.0.0/17", "198.51.100.0/24"]) set = subtract(set, cidrToSet(c) ?? []);
    const sources = setToCidrs(set);
    expect(sourcesText(sources, undefined, "azure")).toBe("internet except 198.51.100.0/24");
    // For AWS the same addresses are internet sources, so they are named.
    expect(sourcesText(sources)).toBe("internet except 104.146.0.0/17, 104.147.0.0/16, 157.59.0.0/16, 168.63.129.16/32, 198.51.100.0/24");
  });

  it("keeps short lists and the whole internet as they are", () => {
    expect(sourcesText(["internet"])).toBe("internet");
    expect(sourcesText(["203.0.113.0/24", "198.51.100.0/24"])).toBe("203.0.113.0/24, 198.51.100.0/24");
  });
});
