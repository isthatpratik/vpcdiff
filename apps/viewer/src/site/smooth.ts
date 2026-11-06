// Smooth scrolling for the landing page (ADR 0007). Lenis eases wheel and anchor
// scrolling; it is off for people who ask for reduced motion, and the viewer never loads it.
import Lenis from "lenis";
import "lenis/dist/lenis.css";

export function startSmoothScroll(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), anchors: { offset: -72 } });
  let frame = requestAnimationFrame(function raf(time) {
    lenis.raf(time);
    frame = requestAnimationFrame(raf);
  });
  return () => {
    cancelAnimationFrame(frame);
    lenis.destroy();
  };
}
