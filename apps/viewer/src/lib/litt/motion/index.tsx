"use client";
// @litt/motion 2026.11.01. What changed: https://littmd.vercel.app/changelog.md

/**
 * Motion for the gallery: the locked litt.md values everywhere, and a dial on
 * the Playground only.
 *
 * Three tiers (see CONTRIBUTING.md):
 * - instant     hover, press, toggles. A short ease-out tween. Invisible.
 * - responsive  menus, tabs, tooltips, the gliding highlight. A spring with no bounce.
 * - expressive  one signature moment per view: dialog, toasts, the list entrance.
 *
 * tokens.css owns every number. On every page the provider writes no CSS
 * variables at all, and the hooks below return values parsed from the same
 * tokens (tokens.ts), so CSS and JS springs agree by construction.
 *
 * On a page that sets `tune` (the Playground) the provider lets the dial
 * override the tokens: it writes inline variables on <html>, and removes them
 * again the moment the page is left. Components never write durations or
 * springs. They ask these hooks, so they follow the dial and reduced motion.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { MotionConfig, MotionConfigContext, useReducedMotion, type Transition } from "motion/react";
import { toCss, type Spring } from "./spring";
import { readLocked, surfaceRadius, type Dial, type Locked } from "./tokens";

export { surfaceRadius, type Dial };
export { countText, FUN_SPRINGS, FunMode, honestCount, useFun, useFunGrab, useFunValue, type FunGrab, type FunMotion, type FunValue } from "./fun";
export {
  DeviceProvider,
  readDismiss,
  useDevice,
  useSheetOpen,
  useSheetPresence,
  useVisibleScreen,
  type Device,
  type DeviceMode,
  type VisibleScreen,
} from "./device";

export type Tier = "instant" | "responsive" | "expressive";
export type PresetName = "locked" | "invisible" | "expressive";

/** The choices the Playground offers for the discrete controls. */
export const TRAVELS = [4, 8, 16, 24] as const;
export const RADII = [0, 2, 4, 6] as const;

export const PRESET_LABEL: Record<PresetName, string> = {
  locked: `Locked (v${"0.5"})`,
  invisible: "Invisible",
  expressive: "Expressive",
};

/** Locked is whatever tokens.css says. The other two are trials to compare against it. */
export function makePresets(locked: Dial): Record<PresetName, Dial> {
  return {
    locked,
    invisible: { instant: 120, responsive: { time: 0.16, bounce: 0 }, expressive: { time: 0.2, bounce: 0 }, stagger: 0, travel: 4, exit: 0.8 },
    expressive: { instant: 120, responsive: { time: 0.28, bounce: 0.15 }, expressive: { time: 0.5, bounce: 0.25 }, stagger: 60, travel: 24, exit: 0.75 },
  };
}

type Ctx = {
  /** The values the hooks use: the locked tokens, or the dial's on a tuning page. */
  dial: Dial;
  /** The tokens.css values, always. */
  locked: Locked;
  presets: Record<PresetName, Dial>;
  preset: PresetName | "custom";
  /** True on a page that sets `tune`. */
  tuning: boolean;
  /** True when something on the Playground differs from the tokens. */
  modified: boolean;
  setPreset: (p: PresetName) => void;
  update: (patch: Partial<Dial>) => void;
  /** Back to the tokens: dial, radius, slow motion and the reduced preview. */
  reset: () => void;
  slow: number;
  setSlow: (n: number) => void;
  reducedPreview: boolean;
  setReducedPreview: (b: boolean) => void;
  /** True when the system asks for reduced motion or the preview switch is on. */
  reduced: boolean;
  /** Control radius in px. Surfaces get this plus the 4px inset. */
  radius: number;
  setRadius: (r: number) => void;
};

const DialContext = createContext<Ctx | null>(null);

/* The Playground remembers a change, and only a change. An untouched visit
   writes nothing, so a later change to tokens.css is never shadowed. */
const DIAL_KEY = "litt-gallery:dial";
const RADIUS_KEY = "litt-gallery:radius";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isSpring = (v: unknown): v is Spring =>
  typeof v === "object" && v !== null && isNum((v as Spring).time) && isNum((v as Spring).bounce) &&
  (v as Spring).time >= 0.05 && (v as Spring).time <= 2 && (v as Spring).bounce >= 0 && (v as Spring).bounce <= 1;

function readStoredDial(): Dial | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DIAL_KEY) || "null") as Partial<Dial> | null;
    if (raw && isNum(raw.instant) && isNum(raw.stagger) && isNum(raw.travel) && isNum(raw.exit) && isSpring(raw.responsive) && isSpring(raw.expressive)) {
      return { instant: raw.instant, responsive: raw.responsive, expressive: raw.expressive, stagger: raw.stagger, travel: raw.travel, exit: raw.exit };
    }
  } catch {
    /* storage can be unavailable or hold something else; fall back to the tokens */
  }
  return null;
}

function readStoredRadius(): number | null {
  try {
    const v = localStorage.getItem(RADIUS_KEY);
    const r = v === null ? NaN : Number(v);
    if ((RADII as readonly number[]).includes(r)) return r;
  } catch {
    /* ignore */
  }
  return null;
}

const sameDial = (a: Dial, b: Dial) => JSON.stringify(a) === JSON.stringify(b);

/** Every inline variable the Playground can write. All of them are removed on leave. */
const VARS = [
  "--litt-dur-instant",
  "--litt-ease-responsive",
  "--litt-dur-responsive",
  "--litt-ease-expressive",
  "--litt-dur-expressive",
  "--litt-dur-exit-responsive",
  "--litt-dur-exit-expressive",
  "--litt-stagger",
  "--litt-travel",
  "--litt-radius-control",
  "--litt-radius-surface",
  "--litt-press-scale",
] as const;

export function MotionDialProvider({ tuning, children }: { tuning: boolean; children: ReactNode }) {
  const system = useReducedMotion() ?? false;
  const locked = useMemo(() => readLocked(system), [system]);
  const presets = useMemo(() => makePresets(locked.dial), [locked]);

  const [tuned, setTuned] = useState<Dial | null>(readStoredDial);
  const [radiusTuned, setRadiusTuned] = useState<number | null>(readStoredRadius);
  const [slow, setSlow] = useState(1);
  const [reducedPreview, setReducedPreview] = useState(false);

  const dial = tuning && tuned ? tuned : locked.dial;
  const radius = tuning && radiusTuned !== null ? radiusTuned : locked.radius;
  const slowNow = tuning ? slow : 1;
  const reduced = system || (tuning && reducedPreview);
  const modified = tuned !== null || radiusTuned !== null || slow !== 1 || reducedPreview;

  const preset = (Object.keys(presets) as PresetName[]).find((k) => sameDial(presets[k], dial)) ?? "custom";

  useEffect(() => {
    try {
      if (tuned) localStorage.setItem(DIAL_KEY, JSON.stringify(tuned));
      else localStorage.removeItem(DIAL_KEY);
      if (radiusTuned !== null) localStorage.setItem(RADIUS_KEY, String(radiusTuned));
      else localStorage.removeItem(RADIUS_KEY);
    } catch {
      /* ignore */
    }
  }, [tuned, radiusTuned]);

  /* Mirror the dial into CSS variables so CSS-only parts follow it too. Only
     on a tuning page, only while something differs from the tokens, and always
     cleaned up. A layout effect, so a page change never paints a stale value. */
  useLayoutEffect(() => {
    if (!tuning || !modified) return;
    const s = document.documentElement.style;
    const r = toCss(dial.responsive);
    const e = toCss(dial.expressive);
    const z = reduced ? 0 : 1;
    const k = slowNow * z;
    const exit = (sp: Spring) => Math.round(Math.round(sp.time * 1000) * dial.exit);
    const set = (name: (typeof VARS)[number], value: string) => s.setProperty(name, value);
    set("--litt-dur-instant", `${dial.instant * k}ms`);
    set("--litt-ease-responsive", r.easing);
    set("--litt-dur-responsive", `${r.duration * k}ms`);
    set("--litt-ease-expressive", e.easing);
    set("--litt-dur-expressive", `${e.duration * k}ms`);
    set("--litt-dur-exit-responsive", `${exit(dial.responsive) * k}ms`);
    set("--litt-dur-exit-expressive", `${exit(dial.expressive) * k}ms`);
    set("--litt-stagger", `${dial.stagger * k}ms`);
    set("--litt-travel", `${dial.travel * z}px`);
    set("--litt-radius-control", `${radius}px`);
    set("--litt-radius-surface", `${surfaceRadius(radius)}px`);
    /* Inline variables beat tokens.css's reduced-motion block, so mirror its press rule too. */
    if (reduced) set("--litt-press-scale", "1");
    return () => VARS.forEach((n) => s.removeProperty(n));
  }, [tuning, modified, dial, slowNow, reduced, radius]);

  const commit = (next: Dial) => setTuned(sameDial(next, locked.dial) ? null : next);

  const value: Ctx = {
    dial,
    locked,
    presets,
    preset,
    tuning,
    modified,
    setPreset: (p) => commit(presets[p]),
    update: (patch) => commit({ ...dial, ...patch }),
    reset: () => {
      setTuned(null);
      setRadiusTuned(null);
      setSlow(1);
      setReducedPreview(false);
    },
    slow,
    setSlow,
    reducedPreview,
    setReducedPreview,
    reduced,
    radius,
    setRadius: (r) => setRadiusTuned(r === locked.radius ? null : r),
  };

  return (
    <DialContext.Provider value={value}>
      <MotionConfig reducedMotion={tuning && reducedPreview ? "always" : "user"}>{children}</MotionConfig>
    </DialContext.Provider>
  );
}

/** The locked tokens as a dial, for an app that mounts no <MotionDialProvider> (any app but the gallery). */
function useStandaloneDial(enabled: boolean): Ctx | null {
  const system = useReducedMotion() ?? false;
  return useMemo(() => {
    if (!enabled) return null;
    const locked = readLocked(system);
    const noop = () => {};
    return {
      dial: locked.dial,
      locked,
      presets: makePresets(locked.dial),
      preset: "locked",
      tuning: false,
      modified: false,
      setPreset: noop,
      update: noop,
      reset: noop,
      slow: 1,
      setSlow: noop,
      reducedPreview: false,
      setReducedPreview: noop,
      reduced: system,
      radius: locked.radius,
      setRadius: noop,
    };
  }, [enabled, system]);
}

/** The dial the hooks read. Without a provider it is the locked tokens, so the components work in any app. */
export function useMotionDial(): Ctx {
  const ctx = useContext(DialContext);
  const standalone = useStandaloneDial(ctx === null);
  return ctx ?? standalone!;
}

/* What tokens.css's reduced-motion block sets, for CSS transitions inside StillMotion. */
const STILL_TOKENS = {
  "--litt-dur-instant": "0ms",
  "--litt-dur-responsive": "0ms",
  "--litt-dur-expressive": "0ms",
  "--litt-dur-exit-responsive": "0ms",
  "--litt-dur-exit-expressive": "0ms",
  "--litt-stagger": "0ms",
  "--litt-travel": "0px",
  "--litt-press-scale": "1",
} as CSSProperties;

/**
 * Holds everything inside it still, as reduced motion does: the hooks return 0 (no duration, travel or stagger),
 * Motion skips its animations, and the CSS transitions read zeroed tier tokens from a display: contents wrapper,
 * which takes no part in layout. For a thumbnail or a preview of live components, where many entrances at once would
 * break the one expressive moment per view. Outside it, nothing changes.
 *
 * `active={false}` lets everything inside move again without remounting it, so a preview held still on arrival can
 * come alive when someone reaches for it, keeping its state and never replaying its entrance.
 */
export function StillMotion({ active = true, children }: { active?: boolean; children: ReactNode }) {
  const ctx = useMotionDial();
  const parent = useContext(MotionConfigContext);
  const still = useMemo(() => (active ? { ...ctx, reduced: true } : ctx), [ctx, active]);
  return (
    <DialContext.Provider value={still}>
      <MotionConfig reducedMotion={active ? "always" : parent.reducedMotion}>
        <div className="contents" style={active ? STILL_TOKENS : undefined}>
          {children}
        </div>
      </MotionConfig>
    </DialContext.Provider>
  );
}

/** The enter transition for a tier. Pass it to a motion component's `transition`. */
export function useTransition(tier: Tier): Transition {
  const { dial, locked, slow, reduced, tuning } = useMotionDial();
  if (reduced) return { duration: 0 };
  const k = tuning ? slow : 1;
  if (tier === "instant") return { type: "tween", duration: (dial.instant / 1000) * k, ease: locked.easeOut };
  const sp = dial[tier];
  return { type: "spring", visualDuration: sp.time * k, bounce: sp.bounce };
}

/** The exit transition for a tier: quicker than the enter, a plain ease-out tween, never a bounce. */
export function useExit(tier: Tier): Transition {
  const { dial, locked, slow, reduced, tuning } = useMotionDial();
  if (reduced) return { duration: 0 };
  const k = tuning ? slow : 1;
  const base = tier === "instant" ? dial.instant / 1000 : dial[tier].time;
  return { type: "tween", duration: base * dial.exit * k, ease: locked.easeOut };
}

/** How far things travel on entry, in px (0 under reduced motion). Use fractions of it, never more. */
export function useTravel(): number {
  const { dial, reduced } = useMotionDial();
  return reduced ? 0 : dial.travel;
}

/** Seconds between items in an expressive entrance (0 under reduced motion). */
export function useStagger(): number {
  const { dial, slow, reduced, tuning } = useMotionDial();
  return reduced ? 0 : (dial.stagger / 1000) * (tuning ? slow : 1);
}
