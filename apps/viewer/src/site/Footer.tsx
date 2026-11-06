// The landing page footer, in the page's own frame: one row between the rails, cut into
// hairline cells like every other section (the brand and the call to action, then three
// link groups), and a closing line written the way the CLI writes a report, with this
// page's own numbers. No card, no motion.
import { version } from "../../package.json";
import { REPO, Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { Cta } from "./Cta.tsx";
import { Divider, PAD } from "./rails.tsx";

const RAIL = "relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]";
const APP = "./app/";
const BASE = import.meta.env.BASE_URL;

/** Footer links in three short groups: the product, ways to use it, and references. */
const GROUPS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Viewer", APP],
      ["How it works", "#how"],
      ["Coverage", "#coverage"],
      ["FAQ", "#faq"],
    ],
  },
  {
    title: "Use it",
    links: [
      ["GitHub Action", "https://github.com/marketplace/actions/vpcdiff"],
      ["CLI", `${REPO}#quick-start-cli`],
      ["Releases", `${REPO}/releases`],
      ["Report an issue", `${REPO}/issues/new/choose`],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Docs", `${REPO}/tree/main/docs`],
      ["Support matrix", `${REPO}#support-matrix`],
      ["Roadmap", `${REPO}#roadmap`],
      ["llms.txt", `${BASE}llms.txt`],
      ["llms-full.txt", `${BASE}llms-full.txt`],
    ],
  },
];

const LABEL = "font-litt-mono text-xs tracking-[0.12em] text-litt-fg-subtle uppercase";
const LINK = "rounded-[4px] py-0.5 transition-colors duration-200 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus";

/**
 * The page's own report, in the CLI's words: what this page sends and stores. These are
 * facts of the build (a Content Security Policy, no analytics, no cookies), not a claim
 * about any plan.
 */
function Report() {
  const item = (n: string, what: string) => (
    <span className="whitespace-nowrap">
      <span className="text-litt-fg">{n}</span> {what}
    </span>
  );
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-litt-mono text-xs text-litt-fg-subtle">
      <span className="text-litt-fg">vpcdiff</span>
      <span aria-hidden="true">·</span>
      <span>this page</span>
      <span aria-hidden="true">·</span>
      {item("0", "requests with your data")}
      <span aria-hidden="true">·</span>
      {item("0", "cookies")}
      <span aria-hidden="true">·</span>
      {item("0", "trackers")}
    </p>
  );
}

export function Footer() {
  return (
    <footer id="footer">
      <div className={RAIL}>
        <div className="grid grid-cols-1 gap-px bg-litt-line md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <div className="grid content-between gap-10 bg-litt-canvas px-6 py-12 md:py-14 md:pl-16">
            <div className="grid content-start gap-4">
              <Wordmark size={22} />
              <p className="max-w-[36ch] text-base leading-relaxed text-litt-fg-muted">See what a Terraform plan opens to the internet, hop by hop, before you apply it.</p>
              <a href={`${REPO}/releases/latest`} className={`justify-self-start font-litt-mono text-xs text-litt-fg-subtle ${LINK}`}>
                v{version} · Apache 2.0
              </a>
            </div>
            <div className="flex items-center gap-3">
              <Cta href={APP} primary>
                Try it free
              </Cta>
              <GithubLink />
            </div>
          </div>
          {GROUPS.map((g) => (
            <nav key={g.title} aria-label={g.title} className="grid content-start gap-4 bg-litt-canvas px-6 py-12 md:px-8 md:py-14">
              <p className={LABEL}>{g.title}</p>
              <ul className="grid gap-2.5 text-litt-small text-litt-fg-muted">
                {g.links.map(([l, h]) => (
                  <li key={l}>
                    <a href={h} className={`${LINK} ${l.endsWith(".txt") ? "font-litt-mono text-xs" : ""}`}>
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <Divider />
      <div className={RAIL}>
        <div className={`${PAD} grid gap-4 py-8 text-litt-caption text-litt-fg-subtle`}>
          <Report />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p>© {new Date().getFullYear()} vpcdiff · Apache 2.0</p>
            <div className="flex gap-5">
              <a href={`${REPO}/blob/main/LICENSE`} className={LINK}>
                License
              </a>
              <a href={`${REPO}/blob/main/SECURITY.md`} className={LINK}>
                Security
              </a>
              <a href={`${REPO}/blob/main/CONTRIBUTING.md`} className={LINK}>
                Contributing
              </a>
            </div>
          </div>
          <p className="max-w-[72ch] text-xs leading-relaxed text-litt-fg-subtle/80">Terraform, AWS, GitHub, GitHub Actions, and Node.js are trademarks of their owners. vpcdiff is not affiliated with them.</p>
        </div>
      </div>
      <Divider dots />
      <div aria-hidden="true" className="h-10" />
    </footer>
  );
}
