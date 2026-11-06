// Helpers that build small synthetic plans for unit tests.
import { expect } from "vitest";
import type { Path } from "./index.js";

export type Values = Record<string, unknown>;
export interface Res {
  type: string;
  name: string;
  before?: Values | null;
  after?: Values | null;
  unknown?: Values;
  /** Configuration expressions: attribute name to referenced names (resources, var., local.). */
  config?: Record<string, string[]>;
  /** Module call and instance key, for example ["net", '["a"]']. */
  module?: [string, string];
}

/** A minimal `terraform show -json` plan. Resources link through known IDs or `config`. */
export function plan(resources: Res[]): unknown {
  const root: { resources: unknown[]; module_calls: Record<string, { module: { resources: unknown[] } }> } = { resources: [], module_calls: {} };
  for (const r of resources) {
    const expressions = Object.fromEntries(Object.entries(r.config ?? {}).map(([k, refs]) => [k, { references: refs.flatMap((x) => (/^(var|local)\./.test(x) ? [x] : [`${x}.id`, x])) }]));
    const entry = { address: `${r.type}.${r.name}`, mode: "managed", type: r.type, name: r.name, expressions };
    if (r.module) (root.module_calls[r.module[0]] ??= { module: { resources: [] } }).module.resources.push(entry);
    else root.resources.push(entry);
  }
  return {
    format_version: "1.2",
    resource_changes: resources.map((r) => {
      const before = r.before === undefined ? r.after : r.before;
      const after = r.after === undefined ? r.before : r.after;
      const actions = !before ? ["create"] : !after ? ["delete"] : JSON.stringify(before) === JSON.stringify(after) ? ["no-op"] : ["update"];
      const prefix = r.module ? `module.${r.module[0]}${r.module[1]}.` : "";
      return { address: `${prefix}${r.type}.${r.name}`, mode: "managed", type: r.type, name: r.name, change: { actions, before, after, after_unknown: r.unknown ?? {} } };
    }),
    configuration: { root_module: root },
  };
}

export const sgRule = (from: number, to: number, cidrs: string[], protocol = "tcp") => ({ protocol, from_port: from, to_port: to, cidr_blocks: cidrs, ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: [], self: false });

/** One public instance in a public subnet. `over` replaces whole resources by name. */
export function network(over: Partial<Record<"vpc" | "igw" | "subnet" | "rt" | "assoc" | "sg" | "instance", Res | null>> = {}, extra: Res[] = []): Res[] {
  const base: Record<string, Res> = {
    vpc: { type: "aws_vpc", name: "main", after: { id: "vpc-1", cidr_block: "10.0.0.0/16", default_network_acl_id: "acl-1" } },
    igw: { type: "aws_internet_gateway", name: "main", after: { id: "igw-1", vpc_id: "vpc-1" } },
    subnet: { type: "aws_subnet", name: "a", after: { id: "subnet-1", vpc_id: "vpc-1", cidr_block: "10.0.1.0/24", map_public_ip_on_launch: false } },
    rt: { type: "aws_route_table", name: "a", after: { id: "rtb-1", vpc_id: "vpc-1", route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-1" }] } },
    assoc: { type: "aws_route_table_association", name: "a", after: { id: "rtbassoc-1", subnet_id: "subnet-1", route_table_id: "rtb-1" } },
    sg: { type: "aws_security_group", name: "app", after: { id: "sg-1", ingress: [sgRule(443, 443, ["0.0.0.0/0"])] } },
    instance: { type: "aws_instance", name: "app", after: { id: "i-1", subnet_id: "subnet-1", vpc_security_group_ids: ["sg-1"], associate_public_ip_address: true, network_interface: [] } },
  };
  const out: Res[] = [];
  for (const [k, v] of Object.entries(base)) {
    const o = over[k as keyof typeof over];
    if (o === null) continue;
    out.push(o ?? v);
  }
  return [...out, ...extra];
}

export const only = (paths: Path[]) => {
  expect(paths).toHaveLength(1);
  return paths[0] as Path;
};

export const nacl = (ingress: Values[], egress: Values[]): Res => ({ type: "aws_network_acl", name: "a", after: { id: "acl-2", subnet_ids: ["subnet-1"], ingress, egress } });
export const naclRule = (rule_no: number, action: string, protocol: string, from: number, to: number, cidr = "0.0.0.0/0") => ({ rule_no, action, protocol, from_port: from, to_port: to, cidr_block: cidr, ipv6_cidr_block: "" });

