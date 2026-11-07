import "../styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../shared/theme.tsx";
import { Landing } from "./Landing.tsx";

initTheme();

// The page-load intro (styles/app.css, "Landing intro"). The page stays hidden until the
// fonts are ready (at most 800 ms), so text never swaps from a fallback font and shifts.
// Then, when the load starts at the top of the page and motion is allowed, the intro
// plays. The intro classes go on only once the fonts are in, so the animations start
// then and not while the page is hidden.
const html = document.documentElement;
const playIntro = !window.location.hash && window.scrollY === 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
html.classList.add("fonts-wait");
const show = () => {
  if (!html.classList.contains("fonts-wait")) return;
  html.classList.remove("fonts-wait");
  if (!playIntro) return;
  html.classList.add("intro");
  window.setTimeout(() => html.classList.remove("intro"), 1800);
};
void document.fonts.ready.then(show);
window.setTimeout(show, 800);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
