// The landing page footer, after primora.xyz: a band with the mark and the name drawn
// large in a faint ink, drifting sideways; hairline tracks with a few moving segments; a
// framed card with the brand, links, and the call to action; and a bottom bar.
// The drift and the segments are constant motion, so they are linear. Both stop under
// reduced motion.
import { Mark, REPO, Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { Cta } from "./Cta.tsx";
import { Divider, PAD } from "./rails.tsx";

const RAIL = "relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]";
const APP = "./app/";

const LINE = "var(--litt-line-strong)";

/**
 * The open delta in outline: the shape is stroked a little wider in the line color, then
 * covered by the same shape in the canvas color, so only a clean outer edge shows.
 */
function OutlineMark() {
  const d = "M8.81 17.50 L4.4 25.4 L27.6 25.4 L16 4.6 L12.52 10.84";
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-[0.9em] w-[0.9em] shrink-0">
      <path d={d} stroke={LINE} strokeWidth={2.85} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={10.66} cy={14.17} r={2.83} fill={LINE} />
      <path d={d} stroke="var(--litt-canvas)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={10.66} cy={14.17} r={2.7} fill="var(--litt-canvas)" />
    </svg>
  );
}

/**
 * The name in outline. A variable font draws overlapping contours inside letters when
 * stroked, so the stroke sits behind a filled copy in the canvas color: only the outer
 * edge stays visible.
 */
function OutlineName() {
  return (
    <span className="relative">
      <span className="text-transparent [-webkit-text-stroke:2px_var(--litt-line-strong)]">vpcdiff</span>
      <span className="absolute inset-0 text-litt-canvas">vpcdiff</span>
    </span>
  );
}

function Unit() {
  return (
    <div className="flex shrink-0 items-center gap-[0.3em] pr-[0.3em]">
      <OutlineName />
      <OutlineMark />
    </div>
  );
}

/**
 * The big outlined name, full bleed (no rails), on a track that slides by one copy and
 * repeats, so it scrolls without end. The band fades out at its top and bottom.
 */
function NameBand() {
  return (
    <div aria-hidden="true" className="overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent)]">
      <div className="flex w-max animate-[footer-drift_60s_linear_infinite] items-center py-12 font-display text-[clamp(96px,17vw,250px)] leading-none font-medium tracking-[-0.04em] motion-reduce:animate-none">
        <Unit />
        <Unit />
        <Unit />
        <Unit />
      </div>
    </div>
  );
}

/** Hairline tracks with a bright segment moving along each, at its own pace. */
function Tracks() {
  const rows = [
    { dur: "9s", delay: "-2s", len: "18%" },
    { dur: "13s", delay: "-7s", len: "42%" },
    { dur: "11s", delay: "-4s", len: "24%" },
  ];
  return (
    <div aria-hidden="true" className="grid gap-6 py-6">
      {rows.map((r) => (
        <div key={r.dur} className="relative mx-3 h-px overflow-hidden bg-litt-line">
          <span className="absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--litt-fg)_55%,transparent)] animate-[footer-track_var(--d)_linear_infinite] motion-reduce:hidden" style={{ width: r.len, "--d": r.dur, animationDelay: r.delay } as React.CSSProperties} />
        </div>
      ))}
    </div>
  );
}

const LINKS: [string, string][] = [
  ["How it works", "#how"],
  ["Coverage", "#coverage"],
  ["FAQ", "#faq"],
  ["Viewer", APP],
  ["Design system", `${REPO}/blob/main/DESIGN.md`],
];

export function Footer() {
  return (
    <>
      <NameBand />
      <Divider />
      <Tracks />
      <Divider />
      <footer id="footer" className={RAIL}>
        <div className="p-3 sm:p-5">
          <div className="grid gap-12 rounded-[14px] border border-litt-line bg-litt-surface-1 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
            <div className="grid content-start gap-5">
              <Wordmark size={22} />
              <p className="max-w-[44ch] text-base leading-relaxed text-litt-fg-muted">See what a Terraform plan opens to the internet, hop by hop, before you apply it. Free, open source, and offline.</p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap content-start gap-x-6 gap-y-2 text-litt-small text-litt-fg-subtle md:justify-end">
              {LINKS.map(([l, h]) => (
                <a key={l} href={h} className="py-1 transition-colors duration-200 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus">
                  {l}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2 self-end">
              <GithubLink />
            </div>
            <div className="self-end md:justify-self-end">
              <Cta href={APP} primary>
                Open the viewer
              </Cta>
            </div>
          </div>
        </div>
        <div className={`${PAD} grid gap-3 py-6 text-litt-caption text-litt-fg-subtle md:grid-cols-[1fr_auto] md:items-start`}>
          <div className="grid gap-2">
            <p>© {new Date().getFullYear()} vpcdiff. Apache 2.0 license.</p>
            <p className="max-w-[640px]">No analytics and no cookies. Fonts load from Google Fonts; nothing about your plan is ever sent. Terraform, AWS, GitHub, GitHub Actions, and Node.js are trademarks of their owners; vpcdiff is not affiliated with them.</p>
          </div>
          <div className="flex gap-5">
            <a href={`${REPO}/blob/main/LICENSE`} className="hover:text-litt-fg">
              License
            </a>
            <a href={`${REPO}/blob/main/SECURITY.md`} className="hover:text-litt-fg">
              Security
            </a>
          </div>
        </div>
      </footer>
      <Divider />
      <div className="flex justify-center py-6" aria-hidden="true">
        <Mark size={14} />
      </div>
    </>
  );
}
