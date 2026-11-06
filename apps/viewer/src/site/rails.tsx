// The landing page's frame (DESIGN.md, section 5): a 1200px column drawn by two thin
// rails, cut into sections by hairlines that run edge to edge. Where a hairline meets a
// rail it stops short, so lines never cross; a few headings get a short ink bar on the
// left rail. Every line is 1px in the line token, so the frame stays quiet.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";
/** Horizontal padding inside the rails. The ink bar offsets below match it. */
export const PAD = "px-6 md:px-16";
const RAIL = "relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]";

/**
 * True once the element has entered the viewport. Elements already on screen at first
 * paint (and everything under reduced motion) count as seen at once, so nothing that is
 * visible on load starts faded.
 */
export function useInViewOnce<T extends Element>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.getBoundingClientRect().top < window.innerHeight) setSeen(true);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setSeen(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

/** A section between the rails. Its content rises 24px and fades in once, on first view. */
export function Rail({ children, className = "", id, label, reveal = true, as: Tag = "section" }: { children: ReactNode; className?: string; id?: string; label?: string; reveal?: boolean; as?: "section" | "div" | "footer" | "header" }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>();
  const shown = !reveal || seen;
  return (
    <Tag id={id} aria-label={label} className={`${RAIL} scroll-mt-20`}>
      <div ref={ref} className={`transition-[opacity,transform] duration-700 ${EASE} ${shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}>
        {children}
      </div>
    </Tag>
  );
}

/**
 * An edge-to-edge hairline with a gap where it meets each rail. With `dots`, a small dot
 * sits in each gap. Use it only where a crossing frames something (the tagline), so most
 * crossings stay as plain gaps.
 */
export function Divider({ dots = false }: { dots?: boolean }) {
  const gap = "absolute -top-3 grid size-6 place-items-center bg-litt-canvas";
  const dot = dots ? <span className="size-[3px] rounded-full bg-litt-fg-subtle" /> : null;
  return (
    <div aria-hidden="true" className="relative z-10 h-px">
      <div className="absolute inset-x-3 top-0 h-px bg-litt-line" />
      <div className="relative mx-3 h-px sm:mx-6 xl:mx-auto xl:max-w-[1200px]">
        <span className={`${gap} -left-3`}>{dot}</span>
        <span className={`${gap} -right-3`}>{dot}</span>
      </div>
    </div>
  );
}

/** A small ink square and a mono label, above a section title. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-litt-mono text-litt-caption tracking-[0.12em] text-litt-fg-subtle uppercase">
      <span aria-hidden="true" className="size-2 bg-litt-fg" />
      {children}
    </p>
  );
}

/**
 * A section title in two tones: the claim in ink, the rest in the subtle tone. With `bar`,
 * a 2px ink bar draws down the left rail beside the title when it comes into view.
 */
export function SectionHead({ eyebrow, title, rest, children, bar = false, className = "" }: { eyebrow: string; title: ReactNode; rest?: ReactNode; children?: ReactNode; bar?: boolean; className?: string }) {
  const [ref, seen] = useInViewOnce<HTMLHeadingElement>("0px 0px -20% 0px");
  return (
    <div className={`grid max-w-[720px] gap-6 ${className}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 ref={ref} className="relative font-display text-4xl leading-[1.08] font-normal tracking-[-0.035em] text-litt-fg sm:text-5xl sm:leading-[1.04]">
        {bar && <span aria-hidden="true" className={`absolute top-1 bottom-1 -left-[25px] w-0.5 origin-top bg-litt-fg transition-transform duration-700 md:-left-[65px] ${EASE} ${seen ? "scale-y-100" : "scale-y-0"}`} />}
        {title}
        {rest && <span className="text-litt-fg-subtle"> {rest}</span>}
      </h2>
      {children && <p className="max-w-[600px] text-lg leading-relaxed text-litt-fg-muted">{children}</p>}
    </div>
  );
}

/**
 * Cursor spotlight: a soft light under the pointer, in the ink tone. Sets --mx and --my on
 * the element itself (not a parent) so only it restyles. Off on touch screens and under
 * reduced motion, where the light never shows.
 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", move, { passive: true });
    return () => el.removeEventListener("pointermove", move);
  }, []);
  return ref;
}

/** The light for `useSpotlight`. Put it first inside a `group relative` element. */
export function Spotlight({ size = 360 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-300 ${EASE} group-hover:opacity-100 motion-reduce:hidden`}
      style={{ background: `radial-gradient(${size}px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklab, var(--litt-fg) 6%, transparent), transparent 70%)` }}
    />
  );
}

/**
 * A framed card: four hairlines that stop short of each corner, and a small dot in each
 * corner, like the line crossings on firecrawl.dev and primora.xyz.
 */
export function DotCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useSpotlight<HTMLDivElement>();
  const dot = "pointer-events-none absolute size-[3px] rounded-full bg-litt-fg-subtle";
  const line = "pointer-events-none absolute bg-litt-line";
  return (
    <div ref={ref} className={`group relative ${className}`}>
      <span aria-hidden="true" className={`${line} top-0 right-2.5 left-2.5 h-px`} />
      <span aria-hidden="true" className={`${line} right-2.5 bottom-0 left-2.5 h-px`} />
      <span aria-hidden="true" className={`${line} top-2.5 bottom-2.5 left-0 w-px`} />
      <span aria-hidden="true" className={`${line} top-2.5 right-0 bottom-2.5 w-px`} />
      <span aria-hidden="true" className={`${dot} -top-px -left-px`} />
      <span aria-hidden="true" className={`${dot} -top-px -right-px`} />
      <span aria-hidden="true" className={`${dot} -bottom-px -left-px`} />
      <span aria-hidden="true" className={`${dot} -right-px -bottom-px`} />
      <div className="relative p-px">
        <Spotlight />
        {children}
      </div>
    </div>
  );
}
