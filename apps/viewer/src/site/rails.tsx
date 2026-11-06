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

/** An edge-to-edge hairline with a gap where it meets each rail. */
export function Divider() {
  return (
    <div aria-hidden="true" className="relative z-10 h-px">
      <div className="absolute inset-x-3 top-0 h-px bg-litt-line" />
      <div className="relative mx-3 h-px sm:mx-6 xl:mx-auto xl:max-w-[1200px]">
        <span className="absolute -top-3 -left-3 size-6 bg-litt-canvas" />
        <span className="absolute -top-3 -right-3 size-6 bg-litt-canvas" />
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
 * A card with a small cross at each corner, after cardcn's basic card #6
 * (https://cardcn.dev/cards/basic-cards). Rebuilt here on litt tokens.
 */
export function CrossCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const corner = "pointer-events-none absolute size-[11px] text-litt-fg-subtle before:absolute before:top-1/2 before:left-0 before:h-px before:w-full before:-translate-y-1/2 before:bg-current after:absolute after:top-0 after:left-1/2 after:h-full after:w-px after:-translate-x-1/2 after:bg-current";
  return (
    <div className={`relative border border-litt-line ${className}`}>
      <span aria-hidden="true" className={`${corner} -top-[6px] -left-[6px]`} />
      <span aria-hidden="true" className={`${corner} -top-[6px] -right-[6px]`} />
      <span aria-hidden="true" className={`${corner} -bottom-[6px] -left-[6px]`} />
      <span aria-hidden="true" className={`${corner} -right-[6px] -bottom-[6px]`} />
      {children}
    </div>
  );
}
