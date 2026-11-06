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

/** Who can connect: "anyone on the internet" or the CIDRs. */
export function whoText(sources: string[]): string {
  if (!sources.length) return "nobody";
  if (sources.length === 1 && sources[0] === "internet") return "anyone on the internet";
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
}

/** The first hop label where the given side stops the traffic, for "blocked at …". */
function stoppedAt(path: Path, side: "before" | "after"): string | undefined {
  const lanes = lanesOf(path);
  const i = lanes[side].cells.findIndex((c) => c.state === "deny");
  return i >= 0 ? `${COLUMNS[i]?.label} hop` : undefined;
}

/** The verdict for one path, in plain words. */
export function verdictOf(path: Path): Verdict {
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
      body: `After this plan, ${whoText(path.after.sources)} can connect to ${path.to} on ${port}.`,
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
      tone: "neutral",
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
      title: "May drop during the apply",
      body: `${path.to} stays reachable on ${port}, but the plan replaces ${res} by deleting it before creating the new one. Traffic can drop until the new one exists.`,
      action: `Add create_before_destroy to ${res}, so the new one exists before the old one is deleted.`,
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

/** One path as Markdown, to paste into a pull request comment. */
export function pathMarkdown(path: Path): string {
  const v = verdictOf(path);
  const lines = [`**${CHANGE_WORD[path.change]}** · internet → \`${path.to}\` ${portLabel(path)}`, "", v.body];
  if (v.cause && v.cause.rule) lines.push("", `Decided at the ${v.cause.hop} hop: \`${v.cause.rule}\``);
  if (v.action) lines.push("", v.action);
  return lines.join("\n");
}

/** The whole plan as Markdown: the counts, then every path that is not unchanged. */
export function planMarkdown(name: string, result: Result): string {
  const s = result.summary;
  const risky = result.paths.filter((p) => p.outageRisk?.length).length;
  const head = `### vpcdiff · ${name}\n\n${s.added} opened · ${s.removed} closed · ${s.changed} changed · ${s.unknown} unknown${risky ? ` · ${risky} outage risk` : ""}`;
  const items = result.paths.filter((p) => p.change !== "unchanged" || p.outageRisk?.length).map((p) => `- ${pathMarkdown(p).split("\n")[0]}`);
  return [head, items.length ? `\n${items.join("\n")}` : "\nNo path from the internet changes."].join("\n");
}
