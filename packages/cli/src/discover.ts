// Finding plans in a folder for the interactive mode. Pure functions over a listing and
// a reader, so they can be tested without a disk.

export type Candidate = { kind: "json"; file: string } | { kind: "binary"; file: string };

/** File names Terraform users commonly give binary plans. */
const BINARY = /^(tfplan|.*\.tfplan|.*\.plan|plan\.out|.*\.tfplan\.out)$/i;

/** True when the text looks like the output of `terraform show -json` for a plan. */
export function looksLikePlanJson(head: string): boolean {
  return /"format_version"\s*:/.test(head) && /"(resource_changes|planned_values)"\s*:/.test(head);
}

/**
 * Plan candidates in a folder, JSON plans first, each group sorted by name.
 * `head(file)` returns the first part of a file, or undefined when it cannot be read.
 */
export function findPlans(entries: { name: string; isFile: boolean; size: number }[], head: (file: string) => string | undefined): Candidate[] {
  const json: Candidate[] = [];
  const binary: Candidate[] = [];
  for (const e of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile || e.size === 0) continue;
    if (e.name.toLowerCase().endsWith(".json") && e.size < 512 * 1024 * 1024) {
      const h = head(e.name);
      if (h && looksLikePlanJson(h)) json.push({ kind: "json", file: e.name });
    } else if (BINARY.test(e.name)) {
      binary.push({ kind: "binary", file: e.name });
    }
  }
  return [...json, ...binary];
}
