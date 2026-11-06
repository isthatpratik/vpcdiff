import type { Spring } from "./spring";

export type Dial = {
  /** ms, the instant tween. */
  instant: number;
  responsive: Spring;
  expressive: Spring;
  /** ms between items in an expressive entrance. */
  stagger: number;
  /** px, the furthest anything moves on entry. */
  travel: number;
  /** Exits run at this fraction of the spring's visual time, as a tween, never bouncing. */
  exit: number;
};

export type Locked = {
  dial: Dial;
  /** px, --litt-radius-control. */
  radius: number;
  /** --litt-ease-out as a cubic-bezier array for Motion. */
  easeOut: [number, number, number, number];
};

/** A surface is a control plus the 4px inset, so nested corners stay concentric. */
export const surfaceRadius = (control: number) => (control === 0 ? 0 : control + 4);

const NUMBER = "(-?(?:\\d+\\.?\\d*|\\.\\d+))";

/** What tokens.css ships, for a render with no document (a server). The browser reads the real values. */
const SERVER_VALUES: Record<string, string> = {
  "--litt-dur-instant": "100ms",
  "--litt-spring-responsive": "200ms 0",
  "--litt-spring-expressive": "350ms 0.12",
  "--litt-stagger": "40ms",
  "--litt-travel": "16px",
  "--litt-exit": "0.75",
  "--litt-radius-control": "4px",
  "--litt-ease-out": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
};

function computed(name: string): string {
  if (typeof document === "undefined") return SERVER_VALUES[name] ?? "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * The value a token declares outside the reduced-motion block. Under the OS
 * setting tokens.css zeroes the durations, but the Playground still needs the
 * real numbers to show and to copy, so it reads the stylesheet rules instead
 * of the computed style. Returns undefined when it cannot find the rule.
 */
function declared(name: string): string | undefined {
  let found: string | undefined;
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule && /prefers-reduced-motion/.test(rule.conditionText)) continue;
      if (rule instanceof CSSStyleRule) {
        if (/(^|,)\s*:root\s*(,|$)/.test(rule.selectorText)) {
          const v = rule.style.getPropertyValue(name).trim();
          if (v) found = v;
        }
      } else if ("cssRules" in rule) {
        walk((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* a cross-origin sheet (the font stylesheet) hides its rules */
    }
  }
  return found;
}

type Read = (name: string) => string;

function parseTime(name: string, v: string): number {
  const m = new RegExp(`^${NUMBER}(ms|s)$`).exec(v);
  if (!m) throw new Error(`tokens.css: ${name} should be a time such as 100ms, found "${v}"`);
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
}

function parsePx(name: string, v: string): number {
  const m = new RegExp(`^${NUMBER}px$`).exec(v);
  if (!m) throw new Error(`tokens.css: ${name} should be a length such as 16px, found "${v}"`);
  return Number(m[1]);
}

function parseNumber(name: string, v: string): number {
  const m = new RegExp(`^${NUMBER}$`).exec(v);
  if (!m) throw new Error(`tokens.css: ${name} should be a plain number, found "${v}"`);
  return Number(m[1]);
}

function parseSpring(name: string, v: string): Spring {
  const m = new RegExp(`^${NUMBER}(ms|s)\\s+${NUMBER}$`).exec(v);
  if (!m) throw new Error(`tokens.css: ${name} must read "<time>ms <bounce>", found "${v}"`);
  return { time: (m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])) / 1000, bounce: Number(m[3]) };
}

function parseBezier(name: string, v: string): [number, number, number, number] {
  const m = new RegExp(`^cubic-bezier\\(\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*\\)$`).exec(v);
  if (!m) throw new Error(`tokens.css: ${name} must be a cubic-bezier(), found "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/**
 * Read the locked motion and shape tokens. Pass `ignoreReducedMotion` when the
 * OS asks for reduced motion and the real numbers are still wanted.
 */
export function readLocked(ignoreReducedMotion = false): Locked {
  const read: Read = (name) => computed(name);
  // These three are the only motion tokens the reduced-motion block rewrites.
  const real: Read = (name) => (ignoreReducedMotion ? (declared(name) ?? computed(name)) : computed(name));
  return {
    dial: {
      instant: parseTime("--litt-dur-instant", real("--litt-dur-instant")),
      responsive: parseSpring("--litt-spring-responsive", read("--litt-spring-responsive")),
      expressive: parseSpring("--litt-spring-expressive", read("--litt-spring-expressive")),
      stagger: parseTime("--litt-stagger", real("--litt-stagger")),
      travel: parsePx("--litt-travel", real("--litt-travel")),
      exit: parseNumber("--litt-exit", read("--litt-exit")),
    },
    radius: parsePx("--litt-radius-control", read("--litt-radius-control")),
    easeOut: parseBezier("--litt-ease-out", read("--litt-ease-out")),
  };
}
