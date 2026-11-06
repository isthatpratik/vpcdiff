import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { animate, useIsPresent, useMotionValue, type AnimationPlaybackControls, type MotionStyle, type MotionValue, type Transition, type ValueAnimationTransition } from "motion/react";
import { readDismiss } from "./device";
import { useFun } from "./fun";
import { useExit, useTransition } from "./index";

export type DismissDirection = "down" | "left" | "right" | "sideways";

export type DismissInfo = {
  /** The way the surface left. "sideways" resolves to "left" or "right" by the side it was going. */
  direction: "down" | "left" | "right";
  /** The release speed along the leaving direction, in px per ms (0 when it was held still before letting go). */
  velocity: number;
};

export type DismissDragOptions = {
  /** Which way the surface leaves. A sheet is "down"; a toast is "sideways" (either way). */
  direction: DismissDirection;
  /** Called once the release decides to leave. The caller closes the surface (its exit then plays from here). */
  onDismiss: (info: DismissInfo) => void;
  /** Off when the surface is closed or leaving, or a drag makes no sense (for example on fine pointers for a toast). Default true. */
  enabled?: boolean;
  /** The tier whose exit token the leave uses (`exit` in the result). Default "expressive" for "down", "responsive" sideways. */
  tier?: "responsive" | "expressive";
};

export type DismissPanel = {
  /** The moving MotionValue (`y` or `x`) and `touch-action`. Merge it into your own style. */
  style: MotionStyle;
  /** Lets the pointer handler find the moving element when it sits on a handle inside it. */
  "data-dismiss-panel": "" | undefined;
};

export type DismissDrag = {
  /** Spread on the moving `motion` element, then merge `panel.style` into its style. */
  panel: DismissPanel;
  /** Put on the element a drag may start from (the whole panel, or a handle); the guards above apply. */
  onPointerDown: (event: ReactPointerEvent) => void;
  /** The offset along the drag axis, in px, for anything that should follow the drag (a scrim's opacity). */
  offset: MotionValue<number>;
  /** The leave transition for the tier: use it as the `transition` of the exit. */
  exit: Transition;
};

/* Interaction constants. These are distances and delays of gesture recognition, not motion tokens. */
const OPEN_GUARD_MS = 500; // foundations.md section 6: drags are ignored this long after the sheet opens
const SLOP = 6; // px of travel before a touch is a drag, not a tap
const WINDOW_MS = 100; // the release velocity is read from the last this-many ms of movement
const PULL_BACK = 0.5; // how stiff the wrong-way pull starts (1 would be one to one)

/* A drag never starts in these: they own the gesture (foundations.md section 6). */
const NO_DRAG = ["[data-no-drag]", "input[type=range]", "[role=slider]"].join(",");

/* Text fields own the gesture only while they have focus, when a drag moves the caret or selects text. An unfocused
   field is just part of the panel, so a thumb that lands on one still drags the sheet. Radio, checkbox and button
   inputs are never text fields. */
const TEXT_FIELD = [
  "input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[type=image],[type=file],[type=color],[type=hidden],[type=range])",
  "textarea",
  "select",
  "[role=textbox]",
  "[contenteditable]:not([contenteditable=false])",
].join(",");

const SIGN: Record<DismissDirection, 1 | -1 | 0> = { down: 1, right: 1, left: -1, sideways: 0 };

/** `--litt-space-6` in px, from tokens.css (a length in px or rem). Read at gesture time, like readDismiss(). */
function readLimit(): number {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue("--litt-space-6").trim();
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`tokens.css: --litt-space-6 should be a length, found "${raw}"`);
  return raw.endsWith("rem") ? v * parseFloat(getComputedStyle(root).fontSize) : v;
}

/** The pull past rest: starts at PULL_BACK of the finger and flattens out at `limit`. */
const resist = (pulled: number, limit: number) => limit * (1 - Math.exp((-PULL_BACK * pulled) / limit));

/**
 * What a touch that starts at `from` may do, looking up to the moving panel. "blocked": a region that scrolls on
 * this axis is not at its start. "contested": one is at its start, so the first move decides (scroll or drag).
 */
function scanScroll(from: Element, panel: Element, direction: DismissDirection): "free" | "contested" | "blocked" {
  const vertical = direction === "down";
  let contested = false;
  for (let el: Element | null = from; el; el = el.parentElement) {
    const overflow = vertical ? getComputedStyle(el).overflowY : getComputedStyle(el).overflowX;
    if (/auto|scroll|overlay/.test(overflow)) {
      const room = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      if (room > 1) {
        const at = vertical ? el.scrollTop : el.scrollLeft;
        if (direction === "sideways") return "blocked"; // either way is a scroll
        const atStart = direction === "left" ? at >= room - 1 : at <= 0.5; // the edge a swipe this way pulls toward
        if (!atStart) return "blocked";
        contested = true;
      }
    }
    if (el === panel) break;
  }
  return contested ? "contested" : "free";
}

export function useDismissDrag({ direction, onDismiss, enabled = true, tier }: DismissDragOptions): DismissDrag {
  const offset = useMotionValue(0);
  /* Inside an AnimatePresence the surface is also off while it leaves, so a late release can never fight the exit. */
  const present = useIsPresent();
  const active = enabled && present;
  const responsive = useTransition("responsive");
  const fun = useFun();
  const spring = fun ? fun.throw : responsive;
  const exit = useExit(tier ?? (direction === "down" ? "expressive" : "responsive"));

  /* Handlers live as long as a gesture, so they read the latest options through a ref. */
  const live = useRef({ direction, onDismiss, enabled: active, spring });
  live.current = { direction, onDismiss, enabled: active, spring };
  const openedAt = useRef(0);
  const latch = useRef(false); // a release already decided to leave; ignore touches until it is closed or springs back
  const abort = useRef<(() => void) | null>(null);
  const running = useRef<AnimationPlaybackControls | null>(null);

  const springBack = useCallback(
    (velocity: number) => {
      running.current?.stop();
      running.current = animate(offset, 0, { ...live.current.spring, velocity: velocity * 1000 } as ValueAnimationTransition<number>);
    },
    [offset],
  );

  useEffect(() => {
    if (active) {
      openedAt.current = performance.now();
      latch.current = false;
    } else {
      abort.current?.();
    }
  }, [active]);

  useEffect(
    () => () => {
      abort.current?.();
      running.current?.stop();
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const cfg = live.current;
      if (!cfg.enabled || latch.current || abort.current || !event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (performance.now() - openedAt.current < OPEN_GUARD_MS) return;
      const target = event.target as Element;
      if (!event.currentTarget.contains(target)) return; // a portaled child's event bubbling through React
      const panel = event.currentTarget.closest<HTMLElement>("[data-dismiss-panel]") ?? (event.currentTarget as HTMLElement);
      const hit = target.closest(NO_DRAG);
      if (hit && panel.contains(hit)) return;
      const field = target.closest(TEXT_FIELD);
      if (field && panel.contains(field) && field.contains(document.activeElement)) return;
      const region = scanScroll(target, panel, cfg.direction);
      if (region === "blocked") return;

      const dir = cfg.direction;
      const vertical = dir === "down";
      const sign = SIGN[dir];
      const { distance, velocity } = readDismiss();
      const limit = readLimit();
      const size = vertical ? panel.offsetHeight : panel.offsetWidth;
      const id = event.pointerId;
      const touch = event.pointerType === "touch";
      const x0 = event.clientX;
      const y0 = event.clientY;
      const savedSelect = panel.style.userSelect;
      let claimed = false;
      let base = 0;
      let along = 0;
      let samples: { t: number; a: number }[] = [];

      const place = (a: number) => {
        along = a;
        if (sign === 0) return offset.set(base + a);
        const progress = a * sign;
        offset.set(base + sign * (progress >= 0 ? progress : -resist(-progress, limit)));
      };

      const move = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        const a = vertical ? dy : dx;
        const across = vertical ? dx : dy;
        if (!claimed) {
          if (Math.abs(across) > SLOP && Math.abs(across) > Math.abs(a)) return stop(); // the other axis: not ours
          if (Math.abs(a) < SLOP) return;
          if (region === "contested" && sign !== 0 && a * sign < 0) return stop(); // the region scrolls the other way
          claimed = true;
          running.current?.stop();
          const now = offset.get() as unknown;
          base = typeof now === "number" ? now : 0; // grabbed mid spring-back: carry on from there
          panel.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
          try {
            panel.setPointerCapture(id);
          } catch {
            /* the pointer is already gone */
          }
        }
        place(a);
        samples.push({ t: e.timeStamp, a });
        samples = samples.filter((s) => e.timeStamp - s.t <= WINDOW_MS);
      };

      const swallowClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };

      const release = (e: PointerEvent, cancelled: boolean) => {
        if (e.pointerId !== id) return;
        const wasClaimed = claimed;
        stop();
        if (!wasClaimed) return;
        if (!touch) {
          window.addEventListener("click", swallowClick, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
        }
        // Velocity along the axis over the last WINDOW_MS; zero if the finger rested before letting go.
        const last = samples[samples.length - 1];
        const first = samples[0];
        const fresh = last && e.timeStamp - last.t <= WINDOW_MS;
        const vAxis = fresh && last.t > first.t ? (last.a - first.a) / (last.t - first.t) : 0;
        const progress = sign === 0 ? Math.abs(along) : along * sign;
        const speed = sign === 0 ? Math.abs(vAxis) : vAxis * sign;
        if (!cancelled && (progress >= distance * size || speed >= velocity)) {
          const way = sign === 0 ? ((speed >= velocity ? vAxis : along) < 0 ? "left" : "right") : dir;
          latch.current = true;
          live.current.onDismiss({ direction: way as DismissInfo["direction"], velocity: speed });
          // A controlled surface may refuse to close. If it is still enabled after two frames, it came back to rest.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (!latch.current || !live.current.enabled) return;
              latch.current = false;
              springBack(0);
            }),
          );
        } else {
          springBack(cancelled ? 0 : vAxis);
        }
      };

      const up = (e: PointerEvent) => release(e, false);
      const cancel = (e: PointerEvent) => release(e, true);
      // The browser scrolls on a touch unless this is stopped; once the drag has claimed the touch, stop it.
      const touchMove = (e: TouchEvent) => {
        if (claimed && e.cancelable) e.preventDefault();
      };

      function stop() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("touchmove", touchMove);
        if (claimed) panel.style.userSelect = savedSelect;
        abort.current = null;
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      if (touch) window.addEventListener("touchmove", touchMove, { passive: false });
      abort.current = stop;
    },
    [offset, springBack],
  );

  const axis = direction === "down" ? "y" : "x";
  const panel = useMemo<DismissPanel>(() => {
    const style: MotionStyle = { [axis]: offset };
    if (active) style.touchAction = axis === "y" ? "pan-x pinch-zoom" : "pan-y pinch-zoom";
    return { style, "data-dismiss-panel": active ? "" : undefined };
  }, [axis, offset, active]);

  return { panel, onPointerDown, offset, exit };
}
