// The words that search engines and AI assistants read, in one place. The landing page
// (FAQ accordion), the static HTML fallback, the JSON-LD in index.html, and the sitemap
// are all built from this file (vite.config.ts, "vpcdiff-seo"). public/llms.txt and
// public/llms-full.txt are plain files; src/seo.test.ts fails when they drift from it.
// Nothing here imports React or the DOM, so the build can load it.

export const SITE = "https://isthatpratik.github.io/vpcdiff/";
export const REPO = "https://github.com/isthatpratik/vpcdiff";
export const MARKETPLACE = "https://github.com/marketplace/actions/vpcdiff";

export const FAQ: { q: string; a: string }[] = [
  { q: "Which clouds and resources does vpcdiff support?", a: "AWS, Google Cloud, and Azure. On AWS it checks instances, RDS and Aurora, ECS services, load balancers, and VPC endpoints from the internet, and paths between your own resources. On Google Cloud it checks Compute Engine VMs and Cloud SQL from the internet, and on Azure Linux and Windows VMs. The support matrix in the README lists every resource type." },
  { q: "Does vpcdiff need cloud credentials or a cloud account?", a: "No. It reads the JSON that terraform show produces. Terraform needs credentials to make the plan; vpcdiff does not." },
  { q: "Does my plan leave my machine?", a: "No. The CLI and the GitHub Action run where you run them. The viewer analyzes the file in your browser tab (kept in that tab's session storage until you close it), makes no request to any other site, and its Content Security Policy blocks every data request. The Action writes a comment to your own pull request only when you turn that on." },
  { q: "What does unknown mean?", a: "The engine could not decide that hop: a value Terraform learns only at apply time, a resource it does not model yet, or a load balancer whose subnets give different answers. The reason is always shown. Unknown is a result, never a guess." },
  { q: "How is this different from Checkov, tfsec, or Trivy?", a: "Those tools judge each rule on its own. vpcdiff follows the whole path: an open security group behind a network ACL that denies the port is not an exposure, and a narrow rule can still open a path when a route changes." },
  { q: "How is it different from AWS Reachability Analyzer, Google Connectivity Tests, or Azure Network Watcher?", a: "Those tools check a live account, one path at a time, after you deploy. vpcdiff works on the plan, before you apply, for every endpoint at once. Each test fixture includes the steps to check it against the matching cloud tool; those paid checks have not been run yet." },
  { q: "Does it check traffic between my own services?", a: "Yes, on AWS. When a security group allows traffic from another group, such as a load balancer to its service or an app to its database, vpcdiff checks that path too: both groups, the routes, and the network ACLs both ways, also across a VPC peering connection or a transit gateway. A plan that cuts such a path gets a review. Google Cloud and Azure paths start at the internet." },
  { q: "Does it work with OpenTofu?", a: "Yes. OpenTofu writes the same plan JSON as Terraform (tofu show -json). CI plans every test fixture with OpenTofu and checks that the result is byte for byte the same." },
  { q: "Can it block a pull request?", a: "Yes. The GitHub Action fails the check when the plan adds a path from the internet or makes one wider, such as a rule that goes from one host to 0.0.0.0/0 (you choose the level with fail-on; changed also counts other changes, and paths inside the VPC that open or close), writes the report to the job summary, and keeps one comment on the pull request up to date." },
  { q: "What does it cost?", a: "Nothing. vpcdiff is free and open source under the Apache 2.0 license." },
];

/** What each cloud's check covers: the "What it checks" text for crawlers and llms.txt. */
export const CHECKS: { cloud: string; text: string }[] = [
  { cloud: "AWS", text: "Public IP, internet gateway, network ACL inbound, security groups, network ACL outbound (ephemeral ports), and the return route, for instances, RDS and Aurora, ECS services, load balancers, and VPC endpoints, over IPv4 and IPv6. Also paths between your own resources inside a VPC, across VPC peering, and through a transit gateway." },
  { cloud: "Google Cloud", text: "External IP, VPC firewall rules (priority order, a deny wins a tie, target tags and service accounts), and the default route, for Compute Engine VMs; the authorized networks of Cloud SQL." },
  { cloud: "Azure", text: "Public IP, the subnet's and the network interface's network security groups (priority order, default rules), and the subnet's routes, for Linux and Windows VMs." },
];

export const UNKNOWN_NOTE = "Anything it cannot decide is reported as unknown with the reason.";

export const FEATURES = [
  "Internet reachability before and after a Terraform plan, for every endpoint at once, on AWS, Google Cloud, and Azure",
  "Hop by hop: public IP, gateway, network ACL or firewall or NSG rules, security groups, return route",
  "The rule that decides each hop, with a link to the cloud's documentation",
  "Paths between your own resources inside an AWS VPC, across peering and a transit gateway",
  "Unknown with a reason instead of a guess",
  "Outage risk when a group or route is replaced delete-first",
  "A plan verdict: Fix before merge, Check by hand, Review before merge, or No new exposure",
  "GitHub Action that comments on the pull request and can fail the check",
  "CLI with a guided mode that finds or makes the plan",
  "Offline web viewer; the plan never leaves the device",
  "Works with Terraform and OpenTofu plans",
];

export const DESCRIPTION =
  "vpcdiff reads a Terraform plan (terraform show -json) and computes which AWS, Google Cloud, and Azure resources the internet can reach before and after the plan, hop by hop, with the rule that decides each hop. It runs as a CLI, a GitHub Action, and an offline web viewer.";

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The "What it checks" block of the static fallback. */
export function checksHtml(): string {
  return [
    "<h2>What it checks</h2>",
    "        <ul>",
    ...CHECKS.map((c) => `          <li><strong>${escapeHtml(c.cloud)}:</strong> ${escapeHtml(c.text)}</li>`),
    "        </ul>",
    `        <p>${escapeHtml(UNKNOWN_NOTE)}</p>`,
  ].join("\n");
}

/** The questions of the static fallback, as a definition list. */
export function faqHtml(): string {
  return ["<dl>", ...FAQ.flatMap((f) => [`          <dt>${escapeHtml(f.q)}</dt>`, `          <dd>${escapeHtml(f.a)}</dd>`]), "        </dl>"].join("\n");
}

/**
 * The JSON-LD graph: the software, the site, and the FAQ. `</script` cannot appear in the
 * output because "<" is escaped.
 */
export function jsonLd(version: string): string {
  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "vpcdiff",
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Infrastructure as code security",
      operatingSystem: "Any (Node.js 24+, or a web browser)",
      softwareVersion: version,
      softwareRequirements: "Node.js 24 or later for the CLI; a web browser for the viewer",
      programmingLanguage: "TypeScript",
      description: DESCRIPTION,
      url: SITE,
      codeRepository: REPO,
      installUrl: MARKETPLACE,
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: { "@type": "Person", name: "Pratik Desai", url: "https://github.com/isthatpratik" },
      image: `${SITE}og.png`,
      featureList: FEATURES,
      sameAs: [REPO, MARKETPLACE],
    },
    { "@context": "https://schema.org", "@type": "WebSite", name: "vpcdiff", url: SITE },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}

/** sitemap.xml for the two pages. `lastmod` is the date of the last commit that touched the site. */
export function sitemap(lastmod: string | undefined): string {
  const mod = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}</loc>${mod}</url>\n  <url><loc>${SITE}app/</loc>${mod}</url>\n</urlset>\n`;
}
