import { useEffect, useState } from "react";

// Five blur layers, each stronger and lower, after primora.xyz's bottom band.
const LAYERS = [
  { blur: 1.5, mask: "transparent 50%, black 62.5%, black 75%, transparent 87.5%" },
  { blur: 3, mask: "transparent 62.5%, black 75%, black 87.5%, transparent 100%" },
  { blur: 6, mask: "transparent 75%, black 87.5%, black 100%" },
  { blur: 12, mask: "transparent 82%, black 92%, black 100%" },
  { blur: 24, mask: "transparent 88%, black 100%" },
];

/**
 * A frosted band along the bottom of the screen that says "there is more below". It
 * fades out once the footer comes into view, so it never covers the end of the page.
 * Clicks pass through; it is hidden for people who ask for reduced transparency.
 */
export function ScrollFrost({ until }: { until: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const end = document.querySelector(until);
    if (!end) return;
    const io = new IntersectionObserver(([e]) => setHidden(!!e?.isIntersecting));
    io.observe(end);
    return () => io.disconnect();
  }, [until]);
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 h-60 transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none [@media(prefers-reduced-transparency:reduce)]:hidden ${hidden ? "opacity-0" : "opacity-100"}`}
    >
      {LAYERS.map((l) => (
        <div key={l.blur} className="absolute inset-0" style={{ backdropFilter: `blur(${l.blur}px)`, WebkitBackdropFilter: `blur(${l.blur}px)`, maskImage: `linear-gradient(${l.mask})`, WebkitMaskImage: `linear-gradient(${l.mask})` }} />
      ))}
    </div>
  );
}
