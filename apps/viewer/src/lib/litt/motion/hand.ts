import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { animate, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { useFun } from "./fun";
import { useTransition } from "./index";

const SLOP = 4; // px of travel before a press is a drag
const WINDOW_MS = 100; // the release speed is read from the last this-many ms of movement
const THROWN_PX = 12; // fun mode: a coast longer than this counts as a throw

export type Axis = "x" | "y";

/** Where the pointer is during a gesture. */
export type HandPoint = {
  /** The pointer, in client px. */
  x: number;
  y: number;
  /** Travel since the press, in px. */
  dx: number;
  dy: number;
  /** `dx` or `dy`, whichever is the gesture's axis. */
  along: number;
};

export type HandRelease = HandPoint & {
  /** False when the pointer never passed the slop: a press, not a drag. */
  claimed: boolean;
  /** True when the gesture was taken away (Escape, a pointercancel, the page's scroll, an unmount): put the part back and commit nothing. */
  cancelled: boolean;
  /** Speed along the axis over the last 100ms, in px/s, signed like `along`. 0 when the hand rested before letting go. */
  speed: number;
};

export type HandOptions = {
  /** The axis the part moves on. A first move that is mostly the other axis belongs to the page: the gesture ends cancelled. */
  axis: Axis;
  /** Travel before a press becomes a drag. Default 4. */
  slop?: number;
  /** The slop was passed and the pointer is captured: take hold of the part. */
  onClaim?: (point: HandPoint) => void;
  /** Every move after the claim. Set the part's MotionValue here, one to one. */
  onMove: (point: HandPoint) => void;
  /** The pointer came up, or the gesture was cancelled. A mouse drag's trailing click is already swallowed. */
  onRelease: (release: HandRelease) => void;
};

export type Hand = {
  /** Call it from onPointerDown. It ignores a second pointer, a mouse button other than the first, and a press while a gesture is live. */
  begin: (event: ReactPointerEvent, options: HandOptions) => void;
  /** Ends a live gesture as cancelled. Safe when none is live. */
  cancel: () => void;
};

const swallowClick = (e: Event) => {
  e.stopPropagation();
  e.preventDefault();
};

/** One hand: pointer events in; claim, move and release out. */
export function useHand(): Hand {
  const live = useRef<((cancelled: boolean) => void) | null>(null);
  useEffect(() => () => live.current?.(true), []);

  return useMemo<Hand>(
    () => ({
      cancel: () => live.current?.(true),
      begin: (event, o) => {
        if (live.current || !event.isPrimary) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const el = event.currentTarget as HTMLElement;
        const id = event.pointerId;
        const touch = event.pointerType !== "mouse";
        const x0 = event.clientX;
        const y0 = event.clientY;
        const slop = o.slop ?? SLOP;
        let claimed = false;
        let trail: { t: number; v: number }[] = [];
        let last: HandPoint = { x: x0, y: y0, dx: 0, dy: 0, along: 0 };

        const point = (e: PointerEvent): HandPoint => {
          const dx = e.clientX - x0;
          const dy = e.clientY - y0;
          return { x: e.clientX, y: e.clientY, dx, dy, along: o.axis === "x" ? dx : dy };
        };

        const move = (e: PointerEvent) => {
          if (e.pointerId !== id) return;
          last = point(e);
          if (!claimed) {
            const across = o.axis === "x" ? last.dy : last.dx;
            if (Math.abs(across) > slop && Math.abs(across) > Math.abs(last.along)) return finish(e.timeStamp, true);
            if (Math.abs(last.along) < slop) return;
            claimed = true;
            try {
              el.setPointerCapture(id);
            } catch {
              /* the pointer is already gone */
            }
            window.getSelection()?.removeAllRanges();
            o.onClaim?.(last);
          }
          trail.push({ t: e.timeStamp, v: last.along });
          trail = trail.filter((s) => e.timeStamp - s.t <= WINDOW_MS);
          o.onMove(last);
        };
        const up = (e: PointerEvent) => e.pointerId === id && finish(e.timeStamp, e.type === "pointercancel");
        const key = (e: KeyboardEvent) => {
          if (e.key !== "Escape" || !claimed) return;
          e.preventDefault();
          finish(e.timeStamp, true);
        };
        /* touch-action on the element decides who owns a touch; once it is ours, the page must not take it back. */
        const hold = (e: TouchEvent) => {
          if (claimed && e.cancelable) e.preventDefault();
        };

        const finish = (now: number, cancelled: boolean) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          window.removeEventListener("keydown", key, true);
          window.removeEventListener("touchmove", hold);
          live.current = null;
          const first = trail[0];
          const end = trail[trail.length - 1];
          const fresh = !!end && now - end.t <= WINDOW_MS;
          const speed = fresh && first && end.t > first.t ? ((end.v - first.v) / (end.t - first.t)) * 1000 : 0;
          if (claimed && !touch) {
            window.addEventListener("click", swallowClick, { capture: true, once: true });
            setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
          }
          o.onRelease({ ...last, claimed, cancelled, speed: cancelled ? 0 : speed });
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        window.addEventListener("keydown", key, true);
        if (touch) window.addEventListener("touchmove", hold, { passive: false });
        live.current = (cancelled) => finish(performance.now(), cancelled);
      },
    }),
    [],
  );
}

export type SnapRule = {
  /** The grid's step, in the value's units. */
  step: number;
  /** Where the grid starts. Defaults to `min`. */
  origin?: number;
  /** The lowest value the part may rest on. */
  min: number;
  /** The highest value the part may rest on. */
  max: number;
  /** Values that pull a release toward them, such as the start of each segment or an event. Off the grid is fine. */
  anchors?: readonly number[];
  /** How near an anchor must be to take the release, in the value's units. Defaults to half a step. */
  pull?: number;
};

/** Decimal places of a number, so a step of 0.1 never drifts to 0.30000000000000004. */
function places(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** The nearest anchor within the pull, else the nearest grid point, kept in [min, max]. */
export function snap(value: number, rule: SnapRule): number {
  const { step, min, max, anchors = [], pull = step / 2 } = rule;
  const origin = rule.origin ?? min;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  let best: number | null = null;
  for (const raw of anchors) {
    const a = clamp(raw);
    if (Math.abs(a - value) <= pull && (best === null || Math.abs(a - value) < Math.abs(best - value))) best = a;
  }
  if (best !== null) return best;
  const digits = Math.max(places(step), places(origin));
  const onGrid = Number((Math.round((value - origin) / step) * step + origin).toFixed(digits));
  return clamp(onGrid);
}

/** Where a release would come to rest if it were left to coast, and whether fun mode counts it as a throw. */
export type Landing = {
  /** One point per value: where the hand let go, plus fun mode's coast when there is one. */
  points: number[];
  /** True only in fun mode, and only when the coast carries more than a few px. Pull wider then. */
  thrown: boolean;
};

export type Settle = {
  /**
   * Takes the values to `targets` on the settle spring (responsive in Calm, fun mode's throw spring in fun), each
   * carrying its entry in `velocities` (px/s, ignored in Calm). `commit` runs once, after all of them have arrived,
   * unless a newer settle or `hold()` took them first. Keys, buttons and a controlled value use this with no hand.
   */
  to: (targets: number[], options?: { velocities?: number[]; commit?: () => void }) => void;
  /**
   * A hand let go with the values at `at`, moving at `speeds` px/s. In Calm they rest from where they were let go,
   * from rest. In fun mode they coast first and may be thrown. `land` turns the landing into the targets, so the
   * component owns the snapping and this file owns the fork.
   */
  release: (options: { at: number[]; speeds: number[]; land: (landing: Landing) => number[]; commit?: () => void }) => void;
  /** Where to show a part the hand wants at `want` but that is kept in [lo, hi]: pinned in Calm, a rubber band in fun mode. `kept` is the pinned value. */
  limit: (want: number, lo: number, hi: number) => { kept: number; shown: number };
  /** Stops any running settle and leaves the values where they are: a hand took the part mid-flight. A stopped settle never commits. */
  hold: () => void;
};

/** The finish of a gesture, for any set of MotionValues: one for a ruler, two for a brush's edges, one per row. */
export function useSettle(values: MotionValue<number>[]): Settle {
  const fun = useFun();
  const responsive = useTransition("responsive");
  const latest = useRef({ values, fun, spring: fun ? fun.throw : responsive });
  latest.current = { values, fun, spring: fun ? fun.throw : responsive };
  const run = useRef<AnimationPlaybackControls[] | null>(null);

  const settle = useMemo<Settle>(() => {
    const hold = () => {
      run.current?.forEach((r) => r.stop());
      run.current = null;
    };
    const to: Settle["to"] = (targets, options) => {
      hold();
      const { values: vs, spring, fun: f } = latest.current;
      /* Calm settles from rest whatever the caller passes, so a velocity can never carry a part past its target. */
      const mine = vs.map((v, i) => animate(v, targets[i] ?? v.get(), { ...spring, velocity: f ? (options?.velocities?.[i] ?? 0) : 0 }));
      run.current = mine;
      void Promise.all(mine).then(() => {
        if (run.current !== mine) return;
        run.current = null;
        options?.commit?.();
      });
    };
    return {
      to,
      hold,
      release: ({ at, speeds, land, commit }) => {
        const { fun: f } = latest.current;
        const carry = at.map((_, i) => (f ? f.coast(speeds[i] ?? 0) : 0));
        const thrown = !!f && carry.some((c) => Math.abs(c) > THROWN_PX);
        const targets = land({ points: at.map((p, i) => p + (carry[i] ?? 0)), thrown });
        to(targets, { velocities: speeds, commit });
      },
      limit: (want, lo, hi) => {
        const kept = Math.min(hi, Math.max(lo, want));
        const { fun: f } = latest.current;
        return { kept, shown: f && want !== kept ? kept + f.rubber(want - kept) : kept };
      },
    };
  }, []);

  useEffect(() => settle.hold, [settle]);
  return settle;
}
