// "How it works" as a row of step tabs over a split panel, after unkey.com's gateway
// section: the words on the left, the step's terminal on a grain plate on the right.
// The steps advance on their own until someone picks one; a thin line shows the time
// left. Tabs are plain buttons: the focus ring shows for the keyboard only.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useInViewOnce } from "./rails.tsx";
import { PanelWindow, Plate } from "./Plate.tsx";

/** How long each tab shows during autoplay: enough to read a panel, not so long it stalls. */
const DWELL = 6500;
/** After a click, the chosen tab stays this long before autoplay goes on from it. */
const RESUME = 12000;

type Step = { id: string; tab: string; title: string; rest: string; body: ReactNode; panelTitle: string; panel: ReactNode };

function Code({ lines }: { lines: { t: string; tone?: "muted" | "add" | "strong" }[] }) {
  return (
    <pre className="overflow-x-auto p-6 font-litt-mono text-[13px] leading-6 text-litt-fg">
      {lines.map((l, i) => (
        <div key={i} className={l.tone === "muted" ? "text-litt-fg-subtle" : l.tone === "strong" ? "font-semibold" : l.tone === "add" ? "text-litt-danger" : ""}>
          {l.t || " "}
        </div>
      ))}
    </pre>
  );
}

const STEPS: Step[] = [
  {
    id: "plan",
    tab: "Plan",
    title: "Make the plan",
    rest: "the one you would apply",
    body: "Terraform writes the plan as JSON. vpcdiff needs nothing else: no cloud account, no credentials, no state.",
    panelTitle: "Terminal",
    panel: <Code lines={[{ t: "$ terraform plan -out=tfplan", tone: "strong" }, { t: "Plan: 0 to add, 1 to change, 0 to destroy.", tone: "muted" }, { t: "" }, { t: "$ terraform show -json tfplan > plan.json", tone: "strong" }, { t: "" }, { t: "  # aws_security_group.db will be updated in-place", tone: "muted" }, { t: '  ~ cidr_blocks = ["10.0.0.0/16"] -> ["0.0.0.0/0"]' }]} />,
  },
  {
    id: "run",
    tab: "Run",
    title: "Run vpcdiff",
    rest: "in CI, a terminal, or a tab",
    body: "Add the GitHub Action to check every pull request, run the CLI, or drop the file on the viewer. The engine is the same in all three.",
    panelTitle: ".github/workflows/plan.yml",
    panel: <Code lines={[{ t: "- run: terraform show -json tfplan > plan.json" }, { t: "- uses: isthatpratik/vpcdiff@v0.3.0", tone: "strong" }, { t: "  with:" }, { t: "    plan: plan.json" }, { t: "    fail-on: added" }, { t: "" }, { t: "# or, in a terminal", tone: "muted" }, { t: "$ node packages/cli/dist/vpcdiff.mjs plan.json", tone: "strong" }]} />,
  },
  {
    id: "read",
    tab: "Read",
    title: "Read the diff",
    rest: "hop by hop",
    body: "Every path from the internet is listed with its verdict before and after the plan, and the hop that changed.",
    panelTitle: "Output",
    panel: <Code lines={[{ t: "$ vpcdiff plan.json", tone: "strong" }, { t: "vpcdiff: 1 added, 0 removed, 0 changed, 0 unknown", tone: "muted" }, { t: "" }, { t: "ADDED   internet -> aws_instance.db  tcp/5432", tone: "add" }, { t: "  before: blocked at security-group" }, { t: "  after:  allowed from internet" }, { t: "  rule:   aws_security_group.db ingress 0.0.0.0/0", tone: "muted" }]} />,
  },
  {
    id: "gate",
    tab: "Gate",
    title: "Stop the merge",
    rest: "when a path opens",
    body: "The Action fails the check on new exposure, writes the report to the job summary, and keeps one comment on the pull request up to date.",
    panelTitle: "Checks",
    panel: (
      <div className="grid gap-px bg-litt-line">
        {[
          { name: "vpcdiff / reachability", note: "1 new path from the internet", bad: true },
          { name: "terraform / plan", note: "Plan: 0 to add, 1 to change", bad: false },
          { name: "lint", note: "Passed in 12s", bad: false },
        ].map((c) => (
          <div key={c.name} className="flex items-center gap-4 bg-litt-surface-1 px-6 py-4">
            <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full text-[11px] font-semibold ${c.bad ? "bg-litt-danger text-white" : "border border-litt-line-strong text-litt-fg-subtle"}`}>
              {c.bad ? "×" : "✓"}
            </span>
            <span className="grid">
              <span className="font-litt-mono text-[13px] text-litt-fg">{c.name}</span>
              <span className="text-litt-caption text-litt-fg-subtle">{c.note}</span>
            </span>
            <span className={`ml-auto text-litt-caption ${c.bad ? "text-litt-danger" : "text-litt-fg-subtle"}`}>{c.bad ? "Failing" : "Passed"}</span>
          </div>
        ))}
        <div className="bg-litt-surface-1 px-6 py-4 text-litt-caption text-litt-fg-subtle">Merging is blocked until the check passes.</div>
      </div>
    ),
  },
];

export function StepTabs() {
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [hold, setHold] = useState(DWELL);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [ref, seen] = useInViewOnce<HTMLDivElement>("0px 0px -25% 0px");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const remaining = useRef(DWELL);
  const shown = useRef("");
  const paused = hover || focus;
  const running = seen && !reduced;

  useEffect(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  // One timer per shown tab. Pausing keeps the time left, so the bar and the timer resume together.
  useEffect(() => {
    if (!running || paused) return;
    const key = `${active}-${cycle}`;
    if (shown.current !== key) {
      shown.current = key;
      remaining.current = hold;
    }
    const start = performance.now();
    const t = window.setTimeout(() => {
      setHold(DWELL);
      setActive((a) => (a + 1) % STEPS.length);
      setCycle((c) => c + 1);
    }, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [active, cycle, hold, running, paused]);

  const pick = (i: number) => {
    setHold(RESUME);
    setActive(i);
    setCycle((c) => c + 1);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const i = (active + d + STEPS.length) % STEPS.length;
    pick(i);
    tabs.current[i]?.focus();
  };
  const step = STEPS[active] ?? STEPS[0];
  if (!step) return null;

  return (
    <div
      ref={ref}
      // Keyboard focus pauses autoplay; focus from a mouse click does not.
      onFocus={(e) => setFocus(e.target.matches(":focus-visible"))}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocus(false)}
    >
      <div role="tablist" aria-label="How it works" onKeyDown={onKey} className="grid grid-cols-2 gap-px border-y border-litt-line bg-litt-line sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const on = i === active;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`step-${s.id}`}
              aria-selected={on}
              aria-controls="step-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => pick(i)}
              className={`relative flex h-16 items-center justify-center gap-3 outline-none transition-colors duration-300 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus ${on ? "bg-litt-surface-2 text-litt-fg" : "bg-litt-canvas text-litt-fg-subtle hover:text-litt-fg"}`}
            >
              <span className="font-litt-mono text-litt-caption opacity-60">0{i + 1}</span>
              <span className="text-lg">{s.tab}</span>
              {on && running && (
                <span
                  key={`${s.id}-${cycle}`}
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-px origin-left animate-[step-progress_linear_forwards] bg-litt-fg motion-reduce:hidden"
                  style={{ animationDuration: `${hold}ms`, animationPlayState: paused ? "paused" : "running" }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        id="step-panel"
        role="tabpanel"
        aria-labelledby={`step-${step.id}`}
        // Reading the panel with the mouse over it pauses autoplay; the tab row does not.
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={() => setHover(false)}
        className="grid lg:grid-cols-[5fr_7fr]"
      >
        {/* Every step is rendered in the same grid cell and only the current one shows, so
            the panel keeps the height of the tallest step and the page never shifts when
            the tabs switch. Hidden steps are inert and hidden from screen readers. */}
        <div className="grid">
          {STEPS.map((st) => {
            const on = st.id === step.id;
            return (
              <div key={st.id} aria-hidden={!on} inert={!on} className={`[grid-area:1/1] grid content-start gap-4 px-6 py-12 md:px-16 md:py-16 ${on ? "visible animate-[step-in_500ms_ease-out_both] motion-reduce:animate-none" : "invisible"}`}>
                <h3 className="font-display text-3xl leading-tight font-normal tracking-[-0.03em] text-litt-fg">
                  {st.title}
                  <span className="block text-litt-fg-subtle">{st.rest}</span>
                </h3>
                <p className="max-w-[44ch] text-base leading-relaxed text-litt-fg-muted">{st.body}</p>
              </div>
            );
          })}
        </div>
        <Plate className="min-h-[320px] border-t border-litt-line lg:border-t-0 lg:border-l" inset="pt-10 pl-8 sm:pt-14 sm:pl-14">
          <div className="grid">
            {STEPS.map((st) => {
              const on = st.id === step.id;
              return (
                <div key={st.id} aria-hidden={!on} inert={!on} className={`[grid-area:1/1] ${on ? "visible animate-[step-in_500ms_ease-out_both] motion-reduce:animate-none" : "invisible"}`}>
                  <PanelWindow title={st.panelTitle} className="h-full min-h-[300px]">
                    {st.panel}
                  </PanelWindow>
                </div>
              );
            })}
          </div>
        </Plate>
      </div>
    </div>
  );
}
