import { Segmented } from "@/components/litt/segmented";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/litt/icons";
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "vpcdiff-theme";

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
let current: ThemeChoice = "system";
// The choice used when none is saved: the landing page opens dark, the viewer follows the system.
let fallback: ThemeChoice = "system";
const saved = () => (localStorage.getItem(KEY) as ThemeChoice | null) ?? fallback;
const store = (v: ThemeChoice) => localStorage.setItem(KEY, v);

/** Always sets data-theme, so litt and Tailwind's dark variant read one attribute. */
function apply(choice: ThemeChoice) {
  current = choice;
  const resolved = choice === "system" ? (systemDark() ? "dark" : "light") : choice;
  document.documentElement.setAttribute("data-theme", resolved);
}

/** Applies the saved theme before the first render; `initial` is used when no choice is saved. */
export function initTheme(initial: ThemeChoice = "system") {
  fallback = initial;
  apply(saved());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current === "system") apply("system");
  });
  document.documentElement.setAttribute("data-material", "flat");
}

/** The effective theme, for parts that need it in JavaScript (the graph). */
export function useResolvedTheme(): "light" | "dark" {
  const read = (): "light" | "dark" => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      obs.disconnect();
    };
  }, []);
  return theme;
}

export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(saved);
  return (
    <Segmented<ThemeChoice>
      legend="Theme"
      size="sm"
      value={choice}
      onValueChange={(v) => {
        setChoice(v);
        store(v);
        apply(v);
      }}
      options={[
        { value: "system", label: <><MonitorIcon aria-hidden="true" /><span className="sr-only">System theme</span></> },
        { value: "light", label: <><SunIcon aria-hidden="true" /><span className="sr-only">Light theme</span></> },
        { value: "dark", label: <><MoonIcon aria-hidden="true" /><span className="sr-only">Dark theme</span></> },
      ]}
    />
  );
}

/** One button that cycles system, light, dark: for compact places like the landing nav. */
export function ThemeCycle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(saved);
  const next: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
  const Icon = choice === "light" ? SunIcon : choice === "dark" ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      aria-label={`Theme: ${choice}. Switch to ${next[choice]}`}
      title={`Theme: ${choice}`}
      onClick={() => {
        const v = next[choice];
        setChoice(v);
        store(v);
        apply(v);
      }}
      className={`inline-flex size-8 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-4 ${className}`}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
