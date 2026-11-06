"use client";
// @litt/motion 2026.11.01. What changed: https://littmd.vercel.app/changelog.md

/**
 * Fun mode: a trial, off unless a <FunMode> is on above the components. While it runs, the gallery's Customize panel is
 * where a viewer turns it on (Motion: Calm or Fun), the way the neutrals were split-tested before Stone was locked in.
 *
 * The one rule: fun mode changes how things move, never how they look at rest. A component in fun mode comes to rest
 * on exactly the frame it draws with fun mode off, and with fun mode off it runs the code it always ran. The fun is in
 * three moments:
 * - Arrival: a data part's marks grow to their values in a choreographed wave, and its figures count up with them.
 * - Change: a new value springs from the old one, interruptibly.
 * - Touch: what is under the finger answers it (a press that squishes, a tick that draws, a lens over a heatmap).
 *   Things you hold are physical: a held thumb lifts and stretches with the speed of the finger (useFunGrab), a held
 *   switch stretches toward where it will go, and a thrown thing keeps the speed it was let go at, coasts (coast) and
 *   settles on a step (the throw spring). Past an end it gives like a rubber band (rubber) and comes back.
 *
 * Two honesty rules: a mark may overshoot by a hair, as a physical thing would, but a figure never shows a value the
 * data does not hold, and a count never goes back while a mark settles. And celebration is earned: only a real
 * milestone (a run that went live) gets one, once, small, in the hues already on screen.
 *
 * Reduced motion turns it off, as does StillMotion: useFun() returns null and every component runs as it always has.
 *
 * The springs here go past the locked dial on purpose (the expressive bounce is 0.12); that is the trial. If fun mode
 * is locked in, they move into tokens.css and the rules, through the evolve workflow.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, useMotionValue, useMotionValueEvent, type MotionValue, type Transition } from "motion/react";
import { toCss, type Spring } from "./spring";
import { useMotionDial } from "./index";

/** Fun mode's springs, as time and bounce, the engine's own form. */
export const FUN_SPRINGS = {
  /** A mark growing to its value: one soft overshoot, then still. Rails, ticks, bars. */
  grow: { time: 0.75, bounce: 0.2 },
  /** A small thing landing: a dot, a check, a step's icon. */
  pop: { time: 0.38, bounce: 0.55 },
  /** Rows trading places. */
  swap: { time: 0.5, bounce: 0.18 },
  /** Following a pointer: tight and without overshoot, so it never lags the finger. */
  follow: { time: 0.18, bounce: 0 },
  /** The selected segment gliding to a new choice. */
  glide: { time: 0.3, bounce: 0.3 },
  /** A press: down and back with a little life. */
  press: { time: 0.2, bounce: 0.45 },
  /** A thrown thing landing on its step: it carries the speed it was let go at, so the time is the settle, not the trip. */
  throw: { time: 0.45, bounce: 0.22 },
} satisfies Record<string, Spring>;

/** How far a throw carries: the distance it would cover in this many seconds at the speed it was let go. */
const COAST_SECONDS = 0.2;
/** How far past an end a pull can go, in px, however hard it pulls. */
const RUBBER_LIMIT = 40;
/** How stiff the pull past an end starts (1 would be one to one). */
const RUBBER_GIVE = 0.55;
/** A held thumb lifts this much, and stretches along the way it moves by up to STRETCH_MAX, reached at STRETCH_SPEED px/s. */
const LIFT = 1.15;
const STRETCH_MAX = 0.3;
const STRETCH_SPEED = 1600;
/** A held thumb that stops moving for this long, in ms, loses its stretch. */
const STRETCH_REST_MS = 80;

/** Drawing a line or a count: a tween, so the pen moves at a steady hand and a count never overshoots. */
const DRAW_SECONDS = 0.9;
const DRAW_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
/** A tick is short, so its pen is quick. */
const TICK_SECONDS = 0.28;
/** Seconds between neighbours in a wave. */
const WAVE = 0.014;
/** A failure's one shake, sideways, in px: the way a wrong password says no. */
const SHAKE = [0, -3, 3, -2, 2, 0];
const SHAKE_SECONDS = 0.4;
/** A celebration's dots scatter and fade over this long, after a beat. */
const BURST_SECONDS = 0.7;
const BURST_DELAY = 0.12;
const BURST_EASE: [number, number, number, number] = [0.2, 0, 0, 1];
/** How deep a press goes in fun mode (the locked --litt-press-scale is 0.98). */
const PRESS_SCALE = 0.95;

const spring = (s: Spring): Transition => ({ type: "spring", visualDuration: s.time, bounce: s.bounce });
const press = toCss(FUN_SPRINGS.press);

export type FunMotion = {
  grow: Transition;
  pop: Transition;
  swap: Transition;
  follow: Transition;
  glide: Transition;
  /** The pen: a steady tween for drawing a line and counting a figure together. */
  draw: Transition & { duration: number };
  /** The pen for a tick or a check mark: the same steady hand, quicker. */
  tick: Transition;
  /** Seconds between neighbours in a wave. */
  wave: number;
  /** A failure's one shake: the x keyframes in px and their timing. */
  shake: { x: number[]; transition: Transition };
  /** A celebration's dots: how they scatter and fade. */
  burst: Transition;
  /** For CSS: the press as a scale, a linear() easing and its settle time in ms. */
  press: { scale: number; easing: string; duration: number };
  /** For CSS: the glide as a linear() easing and its settle time in ms, for a thumb that crosses its track. */
  glideCss: { easing: string; duration: number };
  /** A thrown thing landing on its step. Pass the release speed as `velocity`, in the animated value's units per second. */
  throw: Transition;
  /** How far a throw at `velocity` (px per second, signed) carries past where it was let go, in px. */
  coast: (velocity: number) => number;
  /** A pull `over` px past an end, as the px it shows: one to one at first, then giving less and less, never past a limit. */
  rubber: (over: number) => number;
};

const MOTION: FunMotion = {
  grow: spring(FUN_SPRINGS.grow),
  pop: spring(FUN_SPRINGS.pop),
  swap: spring(FUN_SPRINGS.swap),
  follow: spring(FUN_SPRINGS.follow),
  glide: spring(FUN_SPRINGS.glide),
  draw: { type: "tween", duration: DRAW_SECONDS, ease: DRAW_EASE },
  tick: { type: "tween", duration: TICK_SECONDS, ease: DRAW_EASE },
  wave: WAVE,
  shake: { x: SHAKE, transition: { type: "tween", duration: SHAKE_SECONDS, ease: "easeOut" } },
  burst: { type: "tween", duration: BURST_SECONDS, delay: BURST_DELAY, ease: BURST_EASE },
  press: { scale: PRESS_SCALE, easing: press.easing, duration: press.duration },
  glideCss: toCss(FUN_SPRINGS.glide),
  throw: spring(FUN_SPRINGS.throw),
  coast: (velocity) => velocity * COAST_SECONDS,
  rubber: (over) => Math.sign(over) * RUBBER_LIMIT * (1 - Math.exp((-RUBBER_GIVE * Math.abs(over)) / RUBBER_LIMIT)),
};

const FunContext = createContext(false);

/** Turns fun mode on (or off, with on={false}) for everything inside. Reduced motion still wins. */
export function FunMode({ on = true, children }: { on?: boolean; children: ReactNode }) {
  return <FunContext.Provider value={on}>{children}</FunContext.Provider>;
}

/** Fun mode's motion, or null when it is off: no <FunMode> above, reduced motion, or inside StillMotion. */
export function useFun(): FunMotion | null {
  const on = useContext(FunContext);
  const { reduced } = useMotionDial();
  return on && !reduced ? MOTION : null;
}

/** A figure on its way from `from` to `to`, `p` of the way there: never past `to`, whichever way it is going. */
export function honestCount(from: number, to: number, p: number) {
  return from + (to - from) * Math.max(0, Math.min(1, p));
}

const groupDigits = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/**
 * A number counting inside its own text: "1,380 of 3,000" at 640 reads "640 of 3,000". The value is found as written
 * (grouped, "1,380", or plain, "1380"); text that does not hold it stays as it is, so a count is never invented.
 */
export function countText(text: string, value: number, shown: number) {
  const now = groupDigits(Math.round(shown));
  for (const form of [groupDigits(value), String(value)]) {
    const at = text.indexOf(form);
    if (at >= 0) return text.slice(0, at) + now + text.slice(at + form.length);
  }
  return text;
}

export type FunValue = {
  /** The animated value, in the caller's units (a percent, a tick count). Read it into transforms while `moving`. */
  value: MotionValue<number>;
  /** The figure to show: it counts honestly from where it was to `count`, never past it and never back. */
  shown: number;
  /** True while it moves. Settled, draw the component's own markup from the real value, not the motion value. */
  moving: boolean;
};

/**
 * A value as fun mode moves it. With fun mode on it grows from 0 when the component mounts (after `delay` seconds) and
 * springs to every new value, on the `kind` spring (or the pen, `draw`, for a count that keeps pace with a line). With it off it is simply the value, and nothing ever moves.
 * `count` is the figure counted alongside (the value itself by default), so a bar in percent can count its number.
 */
export function useFunValue(target: number, { kind = "grow", delay = 0, count = target }: { kind?: "grow" | "swap" | "pop" | "draw"; delay?: number; count?: number } = {}): FunValue {
  const fun = useFun();
  const value = useMotionValue(target);
  const [shown, setShown] = useState(count);
  const [moving, setMoving] = useState(false);
  const span = useRef({ from: count, to: count, fromV: target, toV: target });
  const came = useRef(1);
  const shownNow = useRef(count);

  useMotionValueEvent(value, "change", (v) => {
    const { from, to, fromV, toV } = span.current;
    const p = toV === fromV ? 1 : (v - fromV) / (toV - fromV);
    came.current = Math.max(came.current, Math.max(0, Math.min(1, p)));
    shownNow.current = honestCount(from, to, came.current);
    setShown(shownNow.current);
  });
  useMotionValueEvent(value, "animationStart", () => setMoving(true));
  useMotionValueEvent(value, "animationComplete", () => setMoving(false));
  useMotionValueEvent(value, "animationCancel", () => setMoving(false));

  /* Arrival, once, before the first paint, so the rest frame never flashes first. */
  useLayoutEffect(() => {
    if (!fun) return;
    span.current = { from: 0, to: count, fromV: 0, toV: target };
    came.current = 0;
    value.set(0);
    const run = animate(value, target, { ...fun[kind], delay });
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arrival plays on mount only
  }, []);

  /* A new value springs from wherever it is; with fun mode off it simply is the new value. */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!fun) {
      span.current = { from: count, to: count, fromV: target, toV: target };
      value.jump(target);
      shownNow.current = count;
      setShown(count);
      return;
    }
    span.current = { from: shownNow.current, to: count, fromV: value.get(), toV: target };
    came.current = 0;
    const run = animate(value, target, fun[kind]);
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the value only
  }, [target, count]);

  return { value, shown, moving };
}

export type FunGrab = {
  /** A finger took hold of `el`: it lifts. Lets go by itself when the pointer comes up anywhere. */
  grab: (el: HTMLElement | null) => void;
  /** The held thing is now at `at` px along its track: it stretches along the way it moves, by the finger's speed. */
  move: (at: number) => void;
};

/**
 * A thumb you hold, in fun mode: it lifts when a finger takes it, stretches along the way it moves with the finger's
 * speed (and thins across it, so it reads as one soft thing), and wobbles back to its own size when let go. Only its
 * scale moves, never its place, so the thumb still sits exactly where the value puts it. Null with fun mode off.
 */
export function useFunGrab(): FunGrab | null {
  const fun = useFun();
  const held = useRef<{ el: HTMLElement; at: number | null; t: number; rest: number } | null>(null);

  useEffect(
    () => () => {
      const h = held.current;
      if (h) window.clearTimeout(h.rest);
      held.current = null;
    },
    [],
  );

  if (!fun) return null;

  const stretch = (el: HTMLElement, s: number) =>
    animate(el, { scaleX: LIFT * (1 + s), scaleY: LIFT * (1 - s / 2) }, fun.follow);

  return {
    grab(el) {
      if (!el) return;
      held.current = { el, at: null, t: 0, rest: 0 };
      animate(el, { scaleX: LIFT, scaleY: LIFT }, fun.pop);
      const up = () => {
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const h = held.current;
        if (!h || h.el !== el) return;
        window.clearTimeout(h.rest);
        held.current = null;
        animate(el, { scaleX: 1, scaleY: 1 }, fun.pop);
      };
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    move(at) {
      const h = held.current;
      if (!h) return;
      const now = performance.now();
      if (h.at !== null && now > h.t) {
        const speed = (Math.abs(at - h.at) / (now - h.t)) * 1000;
        stretch(h.el, STRETCH_MAX * Math.min(1, speed / STRETCH_SPEED));
      }
      h.at = at;
      h.t = now;
      window.clearTimeout(h.rest);
      h.rest = window.setTimeout(() => held.current === h && stretch(h.el, 0), STRETCH_REST_MS);
    },
  };
}
