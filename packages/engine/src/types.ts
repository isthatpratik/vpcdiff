/** Version of the result format. Bump on any breaking change to these types. */
export const RESULT_FORMAT = "0.2";

export type Verdict = "allowed" | "blocked" | "unknown" | "absent";
export type Decision = "allow" | "partial" | "deny" | "unknown";
export type Change = "added" | "removed" | "changed" | "unchanged" | "unknown";
export type Protocol = "tcp" | "udp";

export type HopKind =
  | "public-ip"
  | "internet-gateway"
  | "nacl-inbound"
  | "security-group"
  | "nacl-outbound"
  | "route"
  // Paths inside the VPC (docs/semantics/internal-paths.md). Hop 5 is "security-group".
  | "source-security-group"
  | "source-route"
  | "source-nacl-outbound"
  | "target-nacl-inbound"
  | "target-nacl-outbound"
  | "source-nacl-inbound"
  | "target-route";

export interface Hop {
  hop: HopKind;
  /** Terraform address of the deciding resource, or a description of an implicit one. */
  resource: string;
  decision: Decision;
  /** The rule or setting that decided, in plain text. */
  rule: string;
  /** AWS documentation for the behavior applied at this hop. */
  doc: string;
}

export interface Outcome {
  verdict: Verdict;
  /**
   * Source addresses that reach the target, as CIDRs. "internet" means every public
   * address. For a path inside the VPC, the source endpoint's address.
   */
  sources: string[];
  hops: Hop[];
  /**
   * Why the verdict is blocked or unknown. When allowed: sources that some hop could not
   * decide (they are not in `sources`), or empty. Empty when absent.
   */
  reason: string;
}

export interface Path {
  id: string;
  /** "internet", or the address of the source endpoint for a path inside the VPC. */
  from: string;
  /** Resource type of the source endpoint. Absent for internet paths. */
  fromType?: string;
  /** "ipv6" for an IPv6 path from the internet; absent for IPv4. */
  family?: "ipv6";
  to: string;
  toType: string;
  protocol: Protocol;
  ports: string;
  change: Change;
  before: Outcome;
  after: Outcome;
  /**
   * For a path allowed before and after: resources on it that the plan replaces by
   * deleting the old object before creating the new one. Traffic can drop during the
   * apply. Absent when there are none.
   */
  outageRisk?: string[];
}

export interface Note {
  resource: string;
  message: string;
}

export interface Result {
  format: string;
  summary: Record<Change, number>;
  paths: Path[];
  /** Things the engine could not model, for example unsupported resources. */
  notes: Note[];
}
