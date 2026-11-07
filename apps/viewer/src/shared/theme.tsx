// Two themes, light and dark; dark is the default on the landing page and in the viewer
// (DESIGN.md). One toggle switches them. Where the browser supports view transitions, the
// new theme opens as a circle from the toggle; with reduced motion it switches at once.
import { MoonIcon, SunIcon } from "@/components/litt/icons";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";
const KEY = "vpcdiff-theme";

/** The saved theme. An older "system" choice, or none, opens dark. */
const saved = (): Theme => (localStorage.getItem(KEY) === "light" ? "light" : "dark");

/** Always sets data-theme, so litt and Tailwind's dark variant read one attribute. */
function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Applies the saved theme before the first render. */
export function initTheme() {
  apply(saved());
  document.documentElement.setAttribute("data-material", "flat");
}

/** The current theme, for parts that need it in JavaScript (the hero demo's stage). */
export function useResolvedTheme(): Theme {
  const read = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Switches the theme. The change is caused by the click, so the new theme grows from the
 * toggle (a view transition clipped to a circle, 500 ms ease-out). Without view
 * transitions, or with reduced motion, the colors change at once.
 */
function switchTo(next: Theme, from: HTMLElement | null) {
  localStorage.setItem(KEY, next);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || reduce || !from) {
    apply(next);
    return;
  }
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => flushSync(() => apply(next)));
  void t.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 500, easing: EASE, pseudoElement: "::view-transition-new(root)" });
  });
}

/**
 * The theme toggle: one round button. The sun and the moon sit on top of each other; the
 * one for the current theme shows, the other turns away and fades (they never pop).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useResolvedTheme();
  const ref = useRef<HTMLButtonElement>(null);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const icon = "absolute inset-0 m-auto size-4 transition-[opacity,rotate,scale] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Dark theme"
      title={`Switch to the ${next} theme`}
      onClick={() => switchTo(next, ref.current)}
      className={`relative inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,scale] duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus active:scale-[0.94] motion-reduce:active:scale-100 ${className}`}
    >
      <SunIcon aria-hidden="true" className={`${icon} ${theme === "light" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"}`} />
      <MoonIcon aria-hidden="true" className={`${icon} ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0"}`} />
    </button>
  );
}
