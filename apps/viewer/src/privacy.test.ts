// The viewer and the landing page make no third party request (DESIGN.md, section 10): every
// script, style, font, and image comes from this origin. This test reads the page sources and
// the policy in vite.config.ts and fails if either names another origin.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

describe("no third party requests", () => {
  for (const page of ["index.html", "app/index.html"]) {
    it(`${page} loads nothing from another origin`, () => {
      const html = read(page);
      // Links and scripts that make the browser fetch something. `canonical`, `alternate`, and
      // `og:` URLs only name pages; they are not fetched.
      const fetched = [...html.matchAll(/<(?:link|script|img|source|iframe)\b[^>]*?\b(?:href|src)="([^"]+)"[^>]*>/g)]
        .filter((m) => !/rel="(?:canonical|alternate)"/.test(m[0]))
        .map((m) => m[1] as string);
      expect(fetched.filter((u) => /^(?:https?:)?\/\//.test(u))).toEqual([]);
      expect(html).not.toMatch(/googleapis|gstatic|cdn\.|unpkg|jsdelivr|cloudflare/i);
    });
  }

  it("the Content Security Policy allows only this origin for styles, fonts, scripts, and images", () => {
    const config = read("vite.config.ts");
    expect(config).not.toMatch(/https:\/\/[a-z.]*(?:google|gstatic)/i);
    expect(config).toContain(`"font-src 'self'"`);
    expect(config).toContain(`"style-src 'self' 'unsafe-inline'"`);
    expect(config).toContain(`"script-src 'self'"`);
    expect(config).toContain(`"img-src 'self' data:"`);
  });

  it("the stylesheets load fonts from the bundled files", () => {
    const css = read("src/styles/app.css");
    expect(css).not.toMatch(/https?:\/\/(?!www\.w3\.org)[^\s")]*\.(?:woff2?|ttf|otf)/);
    expect(css.match(/@font-face/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
