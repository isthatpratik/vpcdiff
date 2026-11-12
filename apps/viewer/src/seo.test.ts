// The words that search engines and AI assistants read must agree with the page. The FAQ, the
// "What it checks" text, the JSON-LD, and the sitemap are built from src/site/seo.ts at build
// time (vite.config.ts). llms.txt and llms-full.txt are plain files, so this test fails when
// they drift from seo.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKS, FAQ, UNKNOWN_NOTE, checksHtml, faqHtml, jsonLd, sitemap } from "./site/seo.ts";

const root = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const version = (JSON.parse(readFileSync(join(root, "../../packages/engine/package.json"), "utf8")) as { version: string }).version;

describe("llms.txt and llms-full.txt", () => {
  for (const file of ["public/llms.txt", "public/llms-full.txt"]) {
    it(`${file} has every question and answer, word for word`, () => {
      const text = read(file);
      for (const f of FAQ) expect(text, f.q).toContain(`- **${f.q}** ${f.a}`);
    });
  }

  it("llms.txt says what each cloud checks", () => {
    const text = read("public/llms.txt");
    for (const c of CHECKS) expect(text).toContain(`- **${c.cloud}:** ${c.text}`);
    expect(text).toContain(UNKNOWN_NOTE);
  });

  it("both name the pinned Action version and no old one", () => {
    expect(read("public/llms.txt")).toContain(`isthatpratik/vpcdiff@v${version}`);
    expect(read("public/llms-full.txt")).toContain(`isthatpratik/vpcdiff@v${version}`);
  });
});

describe("the generated HTML and JSON-LD", () => {
  const graph = JSON.parse(jsonLd(version)) as { "@type": string; [k: string]: unknown }[];

  it("is valid, carries the engine's version, and cannot close its script tag", () => {
    expect(jsonLd(version)).not.toContain("</");
    expect(graph.map((g) => g["@type"])).toEqual(["SoftwareApplication", "WebSite", "FAQPage"]);
    expect(graph[0]?.softwareVersion).toBe(version);
  });

  it("has a Question for every FAQ entry, with the same text", () => {
    const faq = graph[2] as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(FAQ.map((f) => [f.q, f.a]));
  });

  it("escapes HTML in the static fallback", () => {
    expect(faqHtml()).toContain("<dt>");
    expect(checksHtml()).toContain("<strong>AWS:</strong>");
    expect(faqHtml().match(/<dt>/g)).toHaveLength(FAQ.length);
    expect(faqHtml()).not.toMatch(/<dd>[^<]*<[a-z]/);
  });

  it("the landing page source holds placeholders, not copies", () => {
    const html = read("index.html");
    for (const key of ["jsonld", "checks", "faq"]) expect(html).toContain(`<!--seo:${key}-->`);
    expect(html).not.toContain("<dt>");
  });

  it("the sitemap lists both pages, with a date when there is one", () => {
    expect(sitemap("2026-11-12")).toContain("<lastmod>2026-11-12</lastmod>");
    expect(sitemap(undefined)).not.toContain("lastmod");
    expect(sitemap(undefined).match(/<loc>/g)).toHaveLength(2);
  });
});
