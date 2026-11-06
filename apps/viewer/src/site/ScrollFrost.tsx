import { useEffect, useState } from "react";
import { ProgressiveBlur } from "@/components/sora-ui/effects/progressive-blur";

/**
 * A frosted band along the bottom of the screen that says "there is more below". It
 * fades out as the page reaches its end, so it never covers the footer. Clicks pass
 * through; it is hidden for people who ask for reduced transparency.
 */
export function ScrollFrost() {
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      setAtEnd(window.scrollY + window.innerHeight >= doc.scrollHeight - 120);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 h-24 transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none [@media(prefers-reduced-transparency:reduce)]:hidden ${atEnd ? "opacity-0" : "opacity-100"}`}
    >
      <ProgressiveBlur direction="bottom" size="100%" className="absolute inset-0" />
    </div>
  );
}
