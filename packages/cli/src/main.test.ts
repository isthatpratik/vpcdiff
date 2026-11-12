import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./main.ts";

const fixture = (name: string) => join(import.meta.dirname, "../../../fixtures", name, "plan.json");

function cli(args: string[], stdin = "") {
  let out = "";
  let err = "";
  const code = run(args, { stdin: () => stdin, out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe("vpcdiff CLI", () => {
  it("escapes Markdown, links, and mentions that a for_each key carries", async () => {
    const { readFileSync } = await import("node:fs");
    const evil = readFileSync(fixture("sg-5432-opened"), "utf8").replaceAll("aws_instance.db", 'aws_instance.db[\\"x` [Approve](https://evil.example) ![t](https://evil.example/p.png) @someone |\\"]');
    const out = cli(["--format", "markdown", "-"], evil).out;
    // In the table, the name stays inside one code span that the backtick cannot close,
    // where GitHub shows links, images, and mentions as plain text.
    const row = out.split("\n").find((l) => l.startsWith("| 🔴")) ?? "";
    expect(row).toMatch(/``aws_instance\.db\[.*\[Approve\]\(https:\/\/evil\.example\).*@someone \\\|.*``/);
    // The table keeps its five columns: the pipe in the name is escaped.
    expect(row.split(/(?<!\\)\|/).length).toBe(7);
    // Outside code (the hop details), Markdown is escaped and the mention is broken.
    // The summary lines are raw HTML blocks (checked in the test below): Markdown is not rendered there.
    const rest = out.split("\n").filter((l) => !l.startsWith("| 🔴") && !l.startsWith("<details><summary>")).join("\n");
    expect(rest).not.toMatch(/(?<![\\`])\[Approve\]\(/);
    expect(rest).not.toContain("@someone");
  });

  it("never lets an address start a real HTML tag in the hop details", async () => {
    const { readFileSync } = await import("node:fs");
    const evil = readFileSync(fixture("sg-5432-opened"), "utf8").replaceAll("aws_instance.db", 'aws_instance.db[\\"x</summary></details><img src=https://evil.example/p.png> @someone\\"]');
    const out = cli(["--format", "markdown", "-"], evil).out;
    const summaries = out.split("\n").filter((l) => l.startsWith("<details><summary>"));
    expect(summaries.length).toBeGreaterThan(0);
    for (const line of summaries) {
      expect(line).not.toMatch(/<img/i);
      expect(line.match(/<\/summary>/g)).toHaveLength(1);
      expect(line).not.toContain("@someone");
    }
  });

  it("never prints a terminal escape sequence from the plan", async () => {
    const { readFileSync } = await import("node:fs");
    const evil = readFileSync(fixture("sg-5432-opened"), "utf8").replaceAll("aws_instance.db", "aws_instance.db\\u001b]8;;https://evil.example\\u0007x\\u001b[2J");
    for (const f of ["text", "markdown"]) {
      const r = cli(["--format", f, "-"], evil);
      // eslint-disable-next-line no-control-regex
      expect(r.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
      expect(r.out).toContain("aws_instance.db\uFFFD]8;;");
    }
  });


  it("prints the text report and exits 1 for a new exposure", () => {
    const r = cli([fixture("sg-5432-opened")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("ADDED     internet -> aws_instance.db  tcp/5432");
    expect(r.out).toContain("route            allow   aws_route_table.public route 0.0.0.0/0 -> aws_internet_gateway.main");
  });

  it("prints the engine JSON unchanged", () => {
    const r = cli(["--format", "json", fixture("sg-5432-opened")]);
    expect(JSON.parse(r.out)).toMatchObject({ format: "0.2", summary: { added: 1 } });
  });

  it("prints Markdown with a summary table and hop details", () => {
    const r = cli(["-f", "markdown", fixture("nacl-denies-ssh")]);
    expect(r.out).toContain("| 🔴 added | internet → `aws_instance.web` | tcp/443 |");
    expect(r.out).not.toContain("tcp/22 |");
    expect(r.out).toContain("[nacl-inbound](https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html)");
  });

  it("shows unchanged paths with --all", () => {
    expect(cli(["--all", fixture("nacl-denies-ssh")]).out).toContain("UNCHANGED internet -> aws_instance.web  tcp/22");
  });

  it("shows an unchanged path with outage risk without --all", () => {
    const r = cli([fixture("sg-replaced")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 with outage risk");
    expect(r.out).toContain("outage risk: the plan replaces aws_security_group.web by deleting before creating");
  });

  it("exits 0 with --fail-on never", () => {
    expect(cli(["--fail-on", "never", fixture("sg-5432-opened")]).code).toBe(0);
  });

  it("reads the plan from stdin", () => {
    const r = cli(["-f", "json", "-"], JSON.stringify({ format_version: "1.2", resource_changes: [] }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).paths).toEqual([]);
  });

  it("exits 2 for bad input and bad options", () => {
    expect(cli(["-"], "not json").err).toContain("not valid JSON");
    expect(cli(["-"], "not json").code).toBe(2);
    expect(cli(["-"], "{}").err).toContain("Not a Terraform plan");
    expect(cli(["--format", "xml", "x"]).code).toBe(2);
    expect(cli([]).code).toBe(2);
    expect(cli(["/no/such/file.json"]).code).toBe(2);
  });
});
