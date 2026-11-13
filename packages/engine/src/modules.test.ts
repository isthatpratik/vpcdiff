// Module outputs in configuration references (issue #140). A resource often points at a
// module output (`module.net.subnet_id`). The plan hides the value until apply, so the
// engine follows the output's own references into the module and finds the resources.
// It decides only when that leads to exactly one resource. Anything else is `unknown`.
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { localize, parsePlan } from "./plan.js";
import { naclRule, network, only, plan, type Res } from "./testkit.js";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Setup {
  /** Output name to the references of its expression, per module call (name without path). */
  outputs: Record<string, Record<string, string[]>>;
  /** Root references of the instance's `subnet_id` and `vpc_security_group_ids`. */
  subnet: string[];
  groups: string[];
  /** Module call and instance key for the network resources (default `net`, no key). */
  netModule?: [string, string];
  /** Rename resource names, for example to give resources instance keys. */
  rename?: Record<string, string>;
}

/** The standard public instance, with the network in module `net`, the group in `sg`, and the instance unresolved at the root. */
function modulePlan(s: Setup): Obj {
  const netModule = s.netModule ?? ["net", ""];
  const inNet = new Set(["vpc", "igw", "subnet", "rt", "assoc"]);
  const names = ["vpc", "igw", "subnet", "rt", "assoc", "sg", "instance"];
  const list = network().map((r, i): Res => {
    const key = names[i] as string;
    const name = s.rename?.[key] ?? r.name;
    if (key === "instance") return { ...r, before: null, after: { ...r.after, subnet_id: null, vpc_security_group_ids: [null] }, unknown: { subnet_id: true, vpc_security_group_ids: [true] } };
    return { ...r, name, before: null, module: inNet.has(key) ? netModule : ["sg", ""] };
  });
  const p = plan(list) as Obj;
  const root = p.configuration.root_module as Obj;
  const instance = root.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
  instance.expressions = { subnet_id: { references: s.subnet }, vpc_security_group_ids: { references: s.groups } };
  for (const [name, outs] of Object.entries(s.outputs)) {
    const call = (root.module_calls[name] ??= { module: { resources: [] } }) as Obj;
    call.module.outputs = Object.fromEntries(Object.entries(outs).map(([k, references]) => [k, { expression: { references } }]));
  }
  return p;
}

const SUBNET_OUT = { subnet_id: ["aws_subnet.a.id", "aws_subnet.a"] };
const SG_OUT = { id: ["aws_security_group.app.id", "aws_security_group.app"] };
const verdict = (p: unknown) => only(analyze(p).paths).after;
/** An undecided plan reports one unknown path per protocol (tcp and udp): all must be unknown. */
function undecided(p: unknown) {
  const paths = analyze(p).paths;
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.every((x) => x.after.verdict === "unknown")).toBe(true);
  return paths[0]?.after.reason ?? "";
}

describe("module outputs in references", () => {
  it("decides a path through outputs that name one resource each", () => {
    const after = verdict(modulePlan({ outputs: { net: SUBNET_OUT, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
    expect(after.verdict).toBe("allowed");
    expect(after.hops.map((h) => h.hop)).toContain("security-group");
  });

  it("gives the same result as the same resources without modules", () => {
    const viaModules = verdict(modulePlan({ outputs: { net: SUBNET_OUT, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
    const plain = only(analyze(plan(network().map((r) => ({ ...r, before: null })))).paths).after;
    expect(viaModules.verdict).toBe(plain.verdict);
    expect(viaModules.hops.map((h) => h.hop)).toEqual(plain.hops.map((h) => h.hop));
  });

  it("follows an output that is another module's output", () => {
    const p = modulePlan({ outputs: { net: SUBNET_OUT, sg: SG_OUT, outer: { subnet_id: ["module.net.subnet_id", "module.net"] } }, subnet: ["module.outer.subnet_id", "module.outer"], groups: ["module.sg.id", "module.sg"] });
    // The network module sits inside `outer`: move its resources and its call there.
    const text = JSON.stringify(p).replaceAll("module.net.", "module.outer.module.net.");
    const moved = JSON.parse(text) as Obj;
    const root = moved.configuration.root_module as Obj;
    root.module_calls.outer.module.module_calls = { net: root.module_calls.net };
    delete root.module_calls.net;
    // Root references still say `module.outer.subnet_id`: restore them after the text swap.
    const instance = root.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
    instance.expressions.subnet_id = { references: ["module.outer.subnet_id", "module.outer"] };
    root.module_calls.outer.module.outputs = { subnet_id: { expression: { references: ["module.net.subnet_id", "module.net"] } } };
    expect(verdict(moved).verdict).toBe("allowed");
  });

  it("follows a module call with an instance key", () => {
    const p = modulePlan({ outputs: { net: SUBNET_OUT, sg: SG_OUT }, netModule: ["net", "[0]"], subnet: ["module.net[0].subnet_id", "module.net[0]", "module.net"], groups: ["module.sg.id", "module.sg"] });
    expect(verdict(p).verdict).toBe("allowed");
  });

  it("matches one instance when the output names a keyed resource and its parent", () => {
    const p = modulePlan({ outputs: { net: { subnet_id: ["aws_subnet.a[0].id", "aws_subnet.a[0]", "aws_subnet.a"] }, sg: SG_OUT }, rename: { subnet: "a[0]" }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] });
    expect(verdict(p).verdict).toBe("allowed");
  });

  it("returns unknown when the output also uses a variable", () => {
    const reason = undecided(modulePlan({ outputs: { net: { subnet_id: ["var.subnet", "aws_subnet.a.id", "aws_subnet.a"] }, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
    expect(reason).toMatch(/subnet_id uses values that are unknown until apply/);
  });

  it("returns unknown when the output reads a data source", () => {
    undecided(modulePlan({ outputs: { net: { subnet_id: ["data.aws_subnet.x.id", "data.aws_subnet.x"] }, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
  });

  it("returns unknown when the output has two resources and the attribute takes one", () => {
    const reason = undecided(modulePlan({ outputs: { net: { subnet_id: ["aws_subnet.a.id", "aws_subnet.a", "aws_subnet.b.id", "aws_subnet.b"] }, sg: SG_OUT }, subnet: ["module.net.subnet_id[0]", "module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
    expect(reason).toMatch(/refers to 2 resources/);
  });

  it("returns unknown when the output does not exist in the module", () => {
    undecided(modulePlan({ outputs: { net: {}, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
  });

  it("returns unknown when only the whole module is referenced", () => {
    undecided(modulePlan({ outputs: { net: SUBNET_OUT, sg: SG_OUT }, subnet: ["module.net"], groups: ["module.sg.id", "module.sg"] }));
  });

  it("returns unknown for an output that points at a module that does not exist", () => {
    undecided(modulePlan({ outputs: { net: { subnet_id: ["module.missing.subnet_id", "module.missing"] }, sg: SG_OUT }, subnet: ["module.net.subnet_id", "module.net"], groups: ["module.sg.id", "module.sg"] }));
  });
});

// Module inputs: `var.subnet_id` inside a module stands for the expression in the module call.
interface VarSetup {
  /** References of the call's `subnet_id` input, in the calling module. Omit for a call that does not set it. */
  input?: string[];
  /** Instance key of the module call, for example "[0]". */
  key?: string;
  /** References of the instance's `subnet_id` inside the module (default `var.subnet_id`). */
  subnet?: string[];
}

/** Network at the root; the security group and the instance in module `app`, which gets the subnet as an input. */
function varPlan(s: VarSetup): Obj {
  const key = s.key ?? "";
  const list = network().map((r): Res => {
    if (r.type === "aws_instance") return { ...r, before: null, module: ["app", key], after: { ...r.after, subnet_id: null }, unknown: { subnet_id: true }, config: { vpc_security_group_ids: ["aws_security_group.app"] } };
    if (r.type === "aws_security_group") return { ...r, before: null, module: ["app", key] };
    return { ...r, before: null };
  });
  const p = plan(list) as Obj;
  const root = p.configuration.root_module as Obj;
  const call = root.module_calls.app as Obj;
  call.expressions = s.input ? { subnet_id: { references: s.input } } : {};
  const instance = call.module.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
  instance.expressions.subnet_id = { references: s.subnet ?? ["var.subnet_id"] };
  return p;
}

describe("module inputs in references", () => {
  it("follows a variable to the resource that the call passes in", () => {
    expect(verdict(varPlan({ input: ["aws_subnet.a.id", "aws_subnet.a"] })).verdict).toBe("allowed");
  });

  it("follows a variable of a module call with an instance key", () => {
    expect(verdict(varPlan({ key: "[0]", input: ["aws_subnet.a.id", "aws_subnet.a"] })).verdict).toBe("allowed");
  });

  it("follows a variable that the call sets from another module's output", () => {
    const p = varPlan({ input: ["module.net.subnet_id", "module.net"] });
    const root = p.configuration.root_module as Obj;
    // The network moves into module `net`; its subnet keeps its ID, so only the references change.
    root.module_calls.net = { module: { resources: [], outputs: { subnet_id: { expression: { references: ["aws_subnet.a.id", "aws_subnet.a"] } } } } };
    const text = JSON.stringify(p).replaceAll('"address":"aws_subnet.a"', '"address":"module.net.aws_subnet.a"');
    const moved = JSON.parse(text) as Obj;
    const subnet = (moved.resource_changes as Obj[]).find((r) => r.type === "aws_subnet") as Obj;
    expect(subnet.address).toBe("module.net.aws_subnet.a");
    expect(verdict(moved).verdict).toBe("allowed");
  });

  it("follows a variable through two module levels", () => {
    // app gets subnet_id from `outer`'s own input, and outer's call passes the subnet in.
    const p = varPlan({ input: ["var.subnet"] });
    const root = p.configuration.root_module as Obj;
    const text = JSON.stringify(p).replaceAll("module.app.", "module.outer.module.app.");
    const moved = JSON.parse(text) as Obj;
    const movedRoot = moved.configuration.root_module as Obj;
    movedRoot.module_calls = { outer: { expressions: { subnet: { references: ["aws_subnet.a.id", "aws_subnet.a"] } }, module: { resources: [], module_calls: { app: root.module_calls.app } } } };
    expect(verdict(moved).verdict).toBe("allowed");
  });

  it("returns unknown when the call does not set the variable", () => {
    undecided(varPlan({}));
  });

  it("returns unknown when the call sets the variable from a local", () => {
    undecided(varPlan({ input: ["local.subnet"] }));
  });

  it("returns unknown when the instance's own expression also uses a local", () => {
    undecided(varPlan({ input: ["aws_subnet.a.id", "aws_subnet.a"], subnet: ["var.subnet_id", "local.fallback"] }));
  });

  it("returns unknown when the call passes a data source", () => {
    undecided(varPlan({ input: ["data.aws_subnet.x.id", "data.aws_subnet.x"] }));
  });
});

describe("review fixes", () => {
  it("keeps an explicit instance key of the reference (localize)", () => {
    // Instance 1 of module a refers to a resource in instance 0 of module a.
    expect(localize("module.a[1].aws_instance.r", "module.a[0].aws_s.s")).toBe("module.a[0].aws_s.s");
    // A reference without a key adopts the key of the referring resource.
    expect(localize("module.a[1].aws_instance.r", "module.a.aws_s.s")).toBe("module.a[1].aws_s.s");
    // Same key on both sides stays.
    expect(localize("module.a[1].aws_instance.r", "module.a[1].aws_s.s")).toBe("module.a[1].aws_s.s");
    // Reference into a module above, and into a sibling.
    expect(localize("module.a[1].module.b.aws_instance.r", "aws_s.s")).toBe("aws_s.s");
    expect(localize("module.a[1].module.b.aws_instance.r", "module.a.aws_s.s")).toBe("module.a[1].aws_s.s");
    expect(localize("module.a[1].aws_instance.r", "module.c[2].aws_s.s")).toBe("module.c[2].aws_s.s");
    // A resource of the root module.
    expect(localize("aws_instance.r", "aws_s.s")).toBe("aws_s.s");
  });

  it("finishes quickly on a plan whose references repeat and loop", () => {
    const refs = Array.from({ length: 12 }, () => "module.a.o");
    const p = varPlan({ input: ["aws_subnet.a.id", "aws_subnet.a"] });
    const root = p.configuration.root_module as Obj;
    root.module_calls.loop = { expressions: { x: { references: refs } }, module: { resources: [], outputs: { o: { expression: { references: Array.from({ length: 12 }, () => "var.x") } } } } };
    root.module_calls.a = { expressions: { x: { references: refs } }, module: { resources: [], outputs: { o: { expression: { references: Array.from({ length: 12 }, () => "var.x") } } } } };
    const app = root.module_calls.app as Obj;
    const instance = app.module.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
    instance.expressions.subnet_id = { references: ["module.nothing.o"] };
    app.module.module_calls = { a: root.module_calls.a };
    instance.expressions.subnet_id = { references: refs };
    // Before the step budget, this plan ended in a stack overflow (or ran for hours with more copies).
    const reason = undecided(p);
    expect(reason).toMatch(/subnet_id/);
  });

  it("marks a variable as undecided when the call passes a constant", () => {
    // A literal has no references. Dropping `var.subnet_id` would make `cond ? var.subnet_id : aws_x.y.id` look like the resource alone.
    const r = parsePlan(varPlan({ input: [] })).after.resources.get("module.app.aws_instance.app");
    expect(r?.otherRefs.has("subnet_id")).toBe(true);
  });
});

// A list output indexed with a literal (`module.net.subnets[0]`) names one of several instances, and the
// plan does not give the module's order. The engine tries each instance and decides only when all agree.
/** `n` subnets `aws_subnet.a[i]` in module `net`; subnets in `closed` use a route table without an internet route. */
function listPlan(n: number, closed: number[] = []): Obj {
  const subnets: Res[] = Array.from({ length: n }, (_, i) => ({ type: "aws_subnet", name: `a[${i}]`, before: null, module: ["net", ""], after: { id: `subnet-${i + 1}`, vpc_id: "vpc-1", cidr_block: `10.0.${i + 1}.0/24`, map_public_ip_on_launch: false } }));
  const assocs: Res[] = Array.from({ length: n }, (_, i) => ({ type: "aws_route_table_association", name: `a[${i}]`, before: null, module: ["net", ""], after: { id: `rtbassoc-${i + 1}`, subnet_id: `subnet-${i + 1}`, route_table_id: closed.includes(i) ? "rtb-closed" : "rtb-1" } }));
  const closedTable: Res = { type: "aws_route_table", name: "closed", before: null, after: { id: "rtb-closed", vpc_id: "vpc-1", route: [] } };
  const base = network({ subnet: null, assoc: null }).map((r): Res => (r.type === "aws_instance" ? { ...r, before: null, after: { ...r.after, subnet_id: null }, unknown: { subnet_id: true } } : { ...r, before: null }));
  const p = plan([...base, ...subnets, ...assocs, closedTable]) as Obj;
  const root = p.configuration.root_module as Obj;
  const instance = root.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
  instance.expressions = { subnet_id: { references: ["module.net.subnets[0]", "module.net.subnets", "module.net"] } };
  root.module_calls.net.module.outputs = { subnets: { expression: { references: ["aws_subnet.a"] } } };
  return p;
}

describe("one of several instances", () => {
  it("decides when every instance gives the same result, and says so in a note", () => {
    const result = analyze(listPlan(2));
    const path = only(result.paths);
    expect(path.after.verdict).toBe("allowed");
    const note = result.notes.find((n) => n.resource === "aws_instance.app");
    expect(note?.message).toMatch(/subnet_id could be any of 2 resources/);
    expect(note?.message).toMatch(/aws_subnet\.a\[0\], module\.net\.aws_subnet\.a\[1\]|module\.net\.aws_subnet\.a\[0\], module\.net\.aws_subnet\.a\[1\]/);
  });

  it("returns unknown when the instances give different results", () => {
    const reason = undecided(listPlan(2, [1]));
    expect(reason).toMatch(/subnet_id refers to module\.net\.aws_subnet\.a, which has 2 instances/);
  });

  it("returns unknown when the instances give the same verdict for different sources", () => {
    // Subnet 1's NACL lets in the whole internet, subnet 2's only 8.0.0.0/8: both "allowed", for different clients.
    const p = listPlan(2);
    const acl = (name: string, subnet: string, cidr: string): Res => ({ type: "aws_network_acl", name, before: null, after: { id: `acl-${name}`, subnet_ids: [subnet], ingress: [naclRule(100, "allow", "-1", 0, 0, cidr)], egress: [naclRule(100, "allow", "-1", 0, 0)] } });
    const withAcls = plan([...(p.resource_changes as Obj[]).map((c) => ({ type: c.type, name: c.name, before: c.change.before, after: c.change.after, unknown: c.change.after_unknown, ...(c.address.startsWith("module.net.") ? { module: ["net", ""] as [string, string] } : {}) })), acl("one", "subnet-1", "0.0.0.0/0"), acl("two", "subnet-2", "8.0.0.0/8")]) as Obj;
    const root = withAcls.configuration.root_module as Obj;
    const instance = root.resources.find((r: Obj) => r.address === "aws_instance.app") as Obj;
    instance.expressions = { subnet_id: { references: ["module.net.subnets[0]", "module.net.subnets", "module.net"] } };
    root.module_calls.net.module.outputs = { subnets: { expression: { references: ["aws_subnet.a"] } } };
    undecided(withAcls);
  });

  it("returns unknown when there are too many instances to try", () => {
    undecided(listPlan(9));
  });

  it("gives the same bytes on every run", () => {
    expect(JSON.stringify(analyze(listPlan(3)))).toBe(JSON.stringify(analyze(listPlan(3))));
  });
});
