// A guided tour of the viewer (DESIGN.md, "Tour"). One spotlight stays mounted and moves
// from part to part, so nothing pops; the step card sits next to the part on wide
// screens and becomes a bottom sheet on phones. Esc closes, arrows move, focus stays in
// the card. Under reduced motion nothing animates.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/litt/button";

export interface TourStep {
  /** `data-tour` value of the part to show. */
  target: string;
  title: string;
  body: string;
}

export const VIEWER_TOUR: TourStep[] = [
  { target: "plan", title: "The answer for the whole plan", body: "What to do with the pull request: fix before merge, check by hand, review, or no new exposure. The line under it says what vpcdiff checks." },
  { target: "counts", title: "Counts that filter", body: "Paths the plan opens, closes, or changes, outage risks, and paths vpcdiff could not decide. Choose one to list only those." },
  { target: "view", title: "Changes or all paths", body: "Changes lists only what the plan changes. All also lists the paths that stay the same. Filter by resource, port, or CIDR." },
  { target: "card", title: "One card per path", body: "Where traffic starts (the internet, or a resource inside the VPC), where it goes, the port, and what changes. Click a card to open or close it." },
  { target: "verdict", title: "The verdict first", body: "What happens in one sentence, the hop and rule that decide it, and what to do next. Copy for PR puts this path in a pull request comment." },
  { target: "strip", title: "Every hop at a glance", body: "Before and after, one square per hop, left to right in the order traffic meets them. Every hop must let the traffic through. The shapes are in the legend." },
  { target: "hops", title: "The rules behind each hop", body: "Hops that changed are open. Open any hop to see the rule on each side and how AWS decides that hop." },
  { target: "copy-all", title: "Share the result", body: "Copy all for PR copies the whole plan as Markdown, with the vpcdiff version and the plan's SHA-256, so a reviewer can reproduce it." },
  { target: "local", title: "Nothing leaves this tab", body: "The plan is read in your browser. The page cannot send it anywhere. Open your own plan with Open plan, or drop it on the page." },
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;

function rectOf(el: Element | null): Rect | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | undefined>();
  const card = useRef<HTMLDivElement>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = steps[i] as TourStep;
  const last = i === steps.length - 1;

  const measure = useCallback(() => setRect(rectOf(document.querySelector(`[data-tour="${step.target}"]`))), [step.target]);

  // Bring the part into view, then measure it; follow scrolling and resizing.
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    // On phones the card is a bottom sheet, so the part goes to the top of the screen.
    el?.scrollIntoView({ block: window.innerWidth < 640 ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
    measure();
    const t = window.setTimeout(measure, reduce ? 0 : 420);
    return () => window.clearTimeout(t);
  }, [step.target, measure, reduce]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [measure]);
  useEffect(() => card.current?.focus({ preventScroll: true }), [i]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight" && !last) setI(i + 1);
    else if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    else if (e.key === "Tab") {
      // Keep focus inside the card.
      const items = Array.from(card.current?.querySelectorAll<HTMLElement>("button") ?? []);
      const first = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end?.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  // Wide screens: the card below the part, or above when there is no room, kept on screen.
  const W = 340;
  const wide = typeof window !== "undefined" && window.innerWidth >= 640;
  const below = rect ? rect.top + rect.height + 12 : 0;
  const fitsBelow = rect ? below + 220 < window.innerHeight : true;
  const cardTop = rect ? (fitsBelow ? below : Math.max(12, rect.top - 232)) : 12;
  const cardLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - W - 12) : 12;
  const motion = reduce ? "" : "transition-[transform,width,height,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <div className="fixed inset-0 z-[60]" onKeyDown={onKey}>
      {/* A click outside the card closes the tour. */}
      <button type="button" aria-label="Close the tour" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={onClose} />
      {/* The spotlight: one element that moves; its huge shadow dims the rest of the page. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 left-0 rounded-[12px] shadow-[0_0_0_1.5px_var(--litt-fg),0_0_0_9999px_color-mix(in_oklab,var(--litt-canvas)_72%,transparent)] ${motion} ${rect ? "opacity-100" : "opacity-0"}`}
        style={rect ? { transform: `translate(${rect.left}px, ${rect.top}px)`, width: rect.width, height: rect.height } : undefined}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className={`absolute grid gap-3 rounded-xl bg-litt-surface-1 p-4 shadow-(--mock-shadow-card) outline-none max-sm:inset-x-3 max-sm:bottom-3 ${wide ? motion : ""}`}
        style={wide ? { width: W, transform: `translate(${cardLeft}px, ${cardTop}px)`, top: 0, left: 0 } : undefined}
      >
        <p className="font-litt-mono text-litt-caption text-litt-fg-subtle" aria-live="polite">
          {i + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="text-litt-small font-medium text-litt-fg">
          {step.title}
        </h2>
        <p id="tour-body" className="text-litt-small leading-relaxed text-litt-fg-muted text-pretty">
          {step.body}
        </p>
        {/* Progress: one bar per step, the current one in ink. */}
        <div aria-hidden="true" className="flex gap-1">
          {steps.map((s, n) => (
            <span key={s.target} className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${n <= i ? "bg-litt-fg" : "bg-litt-line-strong"}`} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-[6px] px-1.5 py-1 text-litt-caption text-litt-fg-subtle underline-offset-4 hover:text-litt-fg hover:underline focus-visible:outline-2 focus-visible:outline-litt-focus">
            Skip tour
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setI(i - 1)} className="shadow-[inset_0_0_0_1px_var(--litt-line-strong)] hover:bg-litt-surface-2 active:scale-[0.97] motion-reduce:active:scale-100">
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? onClose() : setI(i + 1))} className="active:scale-[0.97] motion-reduce:active:scale-100">
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
