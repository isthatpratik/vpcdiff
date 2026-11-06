// Example plans are the repository's synthetic fixtures, bundled with the page and
// loaded on demand from the same origin. No real account data.
export interface Example {
  id: string;
  title: string;
  description: string;
  load: () => Promise<string>;
}

const text = (m: { default: unknown }) => JSON.stringify(m.default);

export const EXAMPLES: Example[] = [
  {
    id: "sg-5432-opened",
    title: "Database port opened",
    description: "A security group rule on 5432 changes from the VPC range to 0.0.0.0/0.",
    load: () => import("../../../fixtures/sg-5432-opened/plan.json").then(text),
  },
  {
    id: "nacl-denies-ssh",
    title: "SSH stopped by a network ACL",
    description: "New instance: the group opens 22 and 443, a NACL rule denies 22 first.",
    load: () => import("../../../fixtures/nacl-denies-ssh/plan.json").then(text),
  },
  {
    id: "rule-resources",
    title: "Rules as separate resources",
    description: "Routes, NACL rules, group rules, and an Elastic IP as their own resources.",
    load: () => import("../../../fixtures/rule-resources/plan.json").then(text),
  },
];
