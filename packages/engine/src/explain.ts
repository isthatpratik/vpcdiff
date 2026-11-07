// Plain-language explanations for the viewer: the verdict for a path in one sentence,
// the rule that caused it, what to do next, short definitions for tooltips, and a
// Markdown summary to paste into a pull request. Pure functions of the engine result.
import type { Path, Result } from "./types.js";
import { COLUMNS, lanesOf, type CellState, type ColumnKey } from "./lanes.js";

/** Well-known ports, so "tcp/5432" can also say "PostgreSQL". */
const SERVICES: Record<string, string> = {
  "20": "FTP data",
  "21": "FTP",
  "22": "SSH",
  "23": "Telnet",
  "25": "SMTP",
  "53": "DNS",
  "80": "HTTP",
  "110": "POP3",
  "143": "IMAP",
  "443": "HTTPS",
  "445": "SMB",
  "1433": "SQL Server",
  "1521": "Oracle",
  "2049": "NFS",
  "2379": "etcd",
  "3306": "MySQL",
  "3389": "RDP",
  "5432": "PostgreSQL",
  "5601": "Kibana",
  "5672": "AMQP",
  "6379": "Redis",
  "6443": "Kubernetes API",
  "8080": "HTTP alt",
  "8443": "HTTPS alt",
  "9200": "Elasticsearch",
  "11211": "Memcached",
  "27017": "MongoDB",
};

/** The service name for a single well-known port, or undefined for ranges and others. */
export function serviceOf(ports: string): string | undefined {
  return /^\d+$/.test(ports) ? SERVICES[ports] : undefined;
}

/** "tcp/5432 (PostgreSQL)" or "tcp/8000-8100". */
export function portLabel(path: Pick<Path, "protocol" | "ports">): string {
  const svc = serviceOf(path.ports);
  return `${path.protocol}/${path.ports}${svc ? ` (${svc})` : ""}`;
}

/**
 * Who can connect: "any public IPv4 address" or the CIDRs. The engine checks the network
 * path only (not a host firewall or whether a service listens), and IPv4 only, so the
 * words say what the network allows, not who can log in.
 */
export function whoText(sources: string[]): string {
  if (!sources.length) return "nobody";
  if (sources.length === 1 && sources[0] === "internet") return "any public IPv4 address";
  return sources.join(", ");
}

/** Short definitions for each hop, for tooltips. Plain words first, the AWS term second. */
export const HOP_HELP: Record<ColumnKey, string> = {
  source: "Where the traffic starts: public addresses on the internet.",
  "public-ip": "Does the target have a public IP address (or an Elastic IP)? Without one, the internet cannot address it.",
  "internet-gateway": "The VPC's door to the internet. The subnet's route table must send 0.0.0.0/0 to it.",
  "nacl-inbound": "Subnet firewall, incoming. Network ACL rules are checked in number order; the first match decides.",
  "security-group": "The resource's own firewall. A port is open only if some rule allows it from the source.",
  target: "The resource the traffic is trying to reach.",
  "nacl-outbound": "Subnet firewall, outgoing. The reply must leave the subnet on an ephemeral port (1024 to 65535).",
  route: "Can the reply find its way back? The subnet's route table needs a route to the internet gateway.",
  "source-security-group": "The source's own firewall, outgoing. A rule must allow the port to the target's group or subnet.",
  "source-route": "Inside the VPC, traffic to the target's subnet must use the local route.",
  "source-nacl-outbound": "The source subnet's firewall, outgoing. Skipped when both are in the same subnet.",
  "target-nacl-inbound": "The target subnet's firewall, incoming. Skipped when both are in the same subnet.",
  "target-nacl-outbound": "The target subnet's firewall for the reply, outgoing, on an ephemeral port (1024 to 65535).",
  "source-nacl-inbound": "The source subnet's firewall for the reply, incoming, on an ephemeral port (1024 to 65535).",
  "target-route": "Can the reply find its way back? The target's route table must use the local route to the source's subnet.",
};

/** Short definitions for each decision, for tooltips and the legend. */
export const STATE_HELP: Record<CellState, string> = {
  allow: "Lets this traffic through.",
  partial: "Lets some sources through, not every public address.",
  deny: "Blocks this traffic here.",
  unknown: "vpcdiff could not decide this hop, usually because a value is known only after apply.",
  "not-reached": "Not checked: an earlier hop already blocked the traffic.",
  absent: "Not in the plan on this side: the resource is created or destroyed by the plan.",
};

export const CHANGE_HELP = {
  added: "Paths the plan opens to the internet.",
  removed: "Paths the plan closes.",
  changed: "Still reachable, but from different sources.",
  unknown: "Paths vpcdiff could not decide. Check them by hand.",
  outage: "Open paths whose security group or route the plan replaces delete-first. Traffic can drop during the apply.",
} as const;

export type Tone = "danger" | "success" | "warning" | "neutral";

export interface Verdict {
  tone: Tone;
  /** A short headline, for example "Opened to the internet". */
  title: string;
  /** One sentence that says what happens to the path. */
  body: string;
  /** The hop and rule that decide the change, when there is one. */
  cause?: { hop: string; resource: string; rule: string };
  /** What to do next, when there is something to do. */
  action?: string;
  /** A Terraform snippet that fixes the problem, when there is a standard one. */
  snippet?: string;
  /**
   * Sources the engine could not decide on a path it calls reachable. The engine reports
   * them in the path's reason; they are neither allowed nor blocked.
   */
  doubt?: string;
}

/** Ports where exposure to the internet is usually serious: remote admin and data stores. */
const SENSITIVE = new Set(["22", "23", "445", "1433", "1521", "2049", "2379", "3306", "3389", "5432", "5601", "6379", "6443", "9200", "11211", "27017"]);
const CHANGE_RANK: Record<Path["change"], number> = { added: 0, unknown: 1, changed: 2, unchanged: 5, removed: 4 };

/**
 * Sort key for paths, most serious first: opened, then unknown, then changed, then outage
 * risk, then closed, then the rest. Within a group, open to every address before some
 * addresses, and admin or database ports before others.
 */
export function severityOf(path: Path): number {
  const rank = path.change === "unchanged" && path.outageRisk?.length ? 3 : CHANGE_RANK[path.change];
  const sources = path.after.verdict === "allowed" ? path.after.sources : path.before.sources;
  const wide = sources.includes("internet") ? 0 : 1;
  const sensitive = SENSITIVE.has(path.ports) ? 0 : 1;
  return rank * 4 + wide * 2 + sensitive;
}

/** The first hop label where the given side stops the traffic, for "blocked at …". */
function stoppedAt(path: Path, side: "before" | "after"): string | undefined {
  const lanes = lanesOf(path);
  const i = lanes[side].cells.findIndex((c) => c.state === "deny");
  return i >= 0 ? `${COLUMNS[i]?.label} hop` : undefined;
}

/** The verdict for one path, in plain words, with any undecided sources. */
export function verdictOf(path: Path): Verdict {
  const v = baseVerdict(path);
  const doubt = path.change !== "unknown" && path.after.verdict === "allowed" ? path.after.reason : undefined;
  return doubt ? { ...v, doubt } : v;
}

function baseVerdict(path: Path): Verdict {
  const lanes = lanesOf(path);
  const port = portLabel(path);
  const firstChanged = lanes.changed.indexOf(true);
  const causeFrom = (side: "before" | "after", i: number) => {
    const cell = lanes[side].cells[i];
    return cell ? { hop: COLUMNS[i]?.label ?? "", resource: cell.resource, rule: cell.rule } : undefined;
  };
  // A new resource: the decisive hop is the one that lets traffic through or stops it.
  const decisive = (side: "before" | "after") => {
    const cells = lanes[side].cells;
    const deny = cells.findIndex((c) => c.state === "deny");
    if (deny >= 0) return deny;
    const sg = COLUMNS.findIndex((c) => c.key === "security-group");
    return sg;
  };

  if (path.change === "added") {
    const i = firstChanged >= 0 ? firstChanged : decisive("after");
    const cause = causeFrom("after", i);
    return {
      tone: "danger",
      title: path.after.sources.includes("internet") ? "Opened to the internet" : "Opened to some addresses",
      body: `After this plan, the network lets ${whoText(path.after.sources)} reach ${path.to} on ${port}.`,
      ...(cause ? { cause } : {}),
      action:
        path.after.sources.includes("internet")
          ? "If this is not intended, narrow the rule's source to a private range, such as your VPC CIDR."
          : "Check that these source ranges are the ones you mean to allow.",
    };
  }
  if (path.change === "removed") {
    const i = firstChanged >= 0 ? firstChanged : decisive("before");
    const cause = causeFrom("after", i);
    const at = stoppedAt(path, "after");
    return {
      tone: "success",
      title: "Closed",
      body: path.after.verdict === "absent" ? `This plan removes ${path.to}, so the path from the internet on ${port} goes away.` : `After this plan, the internet can no longer reach ${path.to} on ${port}${at ? `: it is blocked at the ${at}` : ""}.`,
      ...(cause ? { cause } : {}),
    };
  }
  if (path.change === "changed") {
    const cause = firstChanged >= 0 ? causeFrom("after", firstChanged) : undefined;
    return {
      tone: "warning",
      title: "Reachable from different sources",
      body: `${path.to} stays reachable on ${port}. Before: ${whoText(path.before.sources)}. After: ${whoText(path.after.sources)}.`,
      ...(cause ? { cause } : {}),
      action: "Check that the new source ranges are the ones you mean to allow.",
    };
  }
  if (path.change === "unknown") {
    const reason = path.after.reason || path.before.reason;
    return {
      tone: "warning",
      title: "Could not decide",
      body: `vpcdiff could not decide whether the internet can reach ${path.to} on ${port}${reason ? `: ${reason}` : "."}`,
      action: "Check this path by hand. vpcdiff reports unknown instead of guessing.",
    };
  }
  // Unchanged.
  if (path.outageRisk?.length) {
    const res = path.outageRisk.join(", ");
    return {
      tone: "warning",
      title: "Outage risk during the apply",
      body: `${path.to} stays reachable on ${port}, but the plan replaces ${res} by deleting it before creating the new one. Traffic can drop until the new one exists.`,
      action: `Add create_before_destroy to ${res}, so the new one exists before the old one is deleted.${path.outageRisk.some((r) => /^(module\.[^.]+\.)*aws_security_group\./.test(r)) ? " If the group has a fixed name, use name_prefix instead, because AWS does not allow two groups with the same name in a VPC." : ""}`,
      snippet: "lifecycle {\n  create_before_destroy = true\n}",
    };
  }
  if (path.before.verdict === "absent" && path.after.verdict === "blocked") {
    const at = stoppedAt(path, "after");
    const cause = causeFrom("after", decisive("after"));
    return { tone: "neutral", title: "New, and not reachable", body: `This plan creates ${path.to}, and the internet cannot reach it on ${port}${at ? `: it is blocked at the ${at}` : ""}.`, ...(cause ? { cause } : {}) };
  }
  if (path.after.verdict === "allowed") {
    return { tone: "neutral", title: "No change", body: `${path.to} is reachable on ${port} from ${whoText(path.after.sources)}, before and after this plan.` };
  }
  const at = stoppedAt(path, "after");
  return { tone: "neutral", title: "Stays blocked", body: `The internet cannot reach ${path.to} on ${port}, before or after this plan${at ? `: it is blocked at the ${at}` : ""}.` };
}

const CHANGE_WORD: Record<Path["change"], string> = { added: "New exposure", removed: "Closed", changed: "Sources changed", unknown: "Unknown", unchanged: "No change" };

/**
 * Inline code that a value cannot close early: the fence is one backtick longer than any
 * run of backticks inside. Resource addresses can hold any characters (for_each keys).
 */
export function mdCode(value: string): string {
  const text = value.replace(/[\r\n]+/g, " ");
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Plain text that is safe to paste as Markdown: Markdown and HTML characters are escaped,
 * and a zero-width space after "@" stops GitHub from notifying anyone.
 */
export function mdText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()<>#+!|~]/g, (c) => `\\${c}`)
    .replace(/@/g, "@\u200b");
}

/** The answer for one side of a path, in words that read before → after. */
export function sideWord(path: Path, side: "before" | "after"): string {
  const v = path[side].verdict;
  if (v === "absent") return side === "before" ? "New resource" : "Removed";
  return v === "allowed" ? "Reachable" : v === "blocked" ? "Blocked" : "Unknown";
}

/** "Blocked → Reachable", or "Stays reachable" when both sides are reachable. */
export function changeWords(path: Path): string {
  if (path.before.verdict === "allowed" && path.after.verdict === "allowed") return "Stays reachable";
  if (path.before.verdict === "blocked" && path.after.verdict === "blocked") return "Stays blocked";
  return `${sideWord(path, "before")} → ${sideWord(path, "after")}`;
}

export interface PlanVerdict {
  tone: Tone;
  /** What to do with the pull request, for example "Fix before merge". */
  title: string;
  /** Why, in one short line. */
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One answer for the whole plan, from the most serious finding down. It never says
 * "safe": with nothing opened it says "No new exposure", within the engine's scope.
 */
export function planVerdict(result: Result): PlanVerdict {
  const s = result.summary;
  const risky = result.paths.filter((p) => p.outageRisk?.length).length;
  if (s.added) {
    const wide = result.paths.filter((p) => p.change === "added" && p.after.sources.includes("internet")).length;
    return { tone: "danger", title: "Fix before merge", detail: wide ? `${plural(wide, "path opens", "paths open")} to any public IPv4 address` : `${plural(s.added, "path opens", "paths open")} to some addresses` };
  }
  if (s.unknown) return { tone: "warning", title: "Check by hand", detail: `vpcdiff could not decide ${plural(s.unknown, "path", "paths")}` };
  if (risky || s.changed) {
    const parts = [risky ? plural(risky, "outage risk", "outage risks") : "", s.changed ? plural(s.changed, "path changes sources", "paths change sources") : ""].filter(Boolean);
    return { tone: "warning", title: "Review before merge", detail: parts.join(" · ") };
  }
  return { tone: "success", title: "No new exposure", detail: s.removed ? `${plural(s.removed, "path closes", "paths close")}; nothing new opens` : "Nothing new opens to the internet" };
}

/** The headline word for a path: the change, or the outage risk on an unchanged path. */
function headline(path: Path): string {
  return path.change === "unchanged" && path.outageRisk?.length ? verdictOf(path).title : CHANGE_WORD[path.change];
}

/** One path as Markdown, to paste into a pull request comment. */
export function pathMarkdown(path: Path): string {
  const v = verdictOf(path);
  const lines = [`**${headline(path)}** · internet → ${mdCode(path.to)} ${portLabel(path)}`, "", mdText(v.body)];
  if (v.doubt) lines.push("", `**Partly undecided:** ${mdText(v.doubt)}`);
  if (v.cause && v.cause.rule) lines.push("", `Decided at the ${v.cause.hop} hop: ${mdCode(v.cause.rule)}`);
  if (v.action) lines.push("", mdText(v.action));
  if (v.snippet) lines.push("", "```hcl", v.snippet, "```");
  return lines.join("\n");
}

/** What the engine checks, for the scope line in the viewer and the Markdown. */
export const SCOPE = "IPv4 paths from the internet";

/**
 * The whole plan as Markdown: the counts, the scope, every path that changes or carries a
 * risk (most serious first), and what is not modeled. `meta` adds a footer so a reviewer
 * can reproduce the result.
 */
export function planMarkdown(name: string, result: Result, meta?: { version?: string; sha256?: string }): string {
  const s = result.summary;
  const risky = result.paths.filter((p) => p.outageRisk?.length).length;
  const pv = planVerdict(result);
  const out = [`### vpcdiff · ${mdText(name)}`, "", `**${pv.title}:** ${pv.detail}.`, "", `${s.added} opened · ${s.removed} closed · ${s.changed} changed · ${s.unknown} unknown${risky ? ` · ${risky} outage risk` : ""}`, "", `Scope: ${SCOPE}.${result.notes.length ? ` ${result.notes.length} not modeled yet (listed below).` : ""}`];
  const items = result.paths
    .filter((p) => p.change !== "unchanged" || p.outageRisk?.length)
    .toSorted((a, b) => severityOf(a) - severityOf(b) || (a.id < b.id ? -1 : 1))
    .map((p) => {
      const [head = "", ...rest] = pathMarkdown(p).split("\n");
      return `<details><summary>${head}</summary>\n${rest.join("\n")}\n\n</details>`;
    });
  out.push("", items.length ? items.join("\n\n") : "No path from the internet changes.");
  if (result.notes.length) {
    out.push("", "Not modeled yet:", ...result.notes.map((n) => `- ${mdCode(n.resource)}: ${mdText(n.message)}`));
  }
  if (meta?.version || meta?.sha256) {
    out.push("", `<sub>vpcdiff ${mdText(meta.version ?? "")}${meta.sha256 ? ` · plan sha256 ${meta.sha256.slice(0, 16)}` : ""}</sub>`);
  }
  return out.join("\n");
}
