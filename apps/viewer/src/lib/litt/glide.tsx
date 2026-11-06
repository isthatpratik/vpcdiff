"use client";
// @litt/glide 2026.11.02. What changed: https://littmd.vercel.app/changelog.md

/**
 * Glide: the one highlight that travels between the rows of a list.
 *
 * Used by the menu and the command menu (litt.md Q16: one gliding highlight
 * instead of a per-row fill).
 *
 * - One highlight element per list, absolutely positioned behind the rows. It
 *   moves with Motion `y` (a transform) on the responsive tier. Rows sit edge
 *   to edge, so the list never goes dark between them.
 * - It fades in AT the row when it first appears (no travel), and fades out in
 *   place when the pointer leaves (useExit). Touch never glides: a tap snaps.
 * - Mouse: the row nearest the pointer wins, even over a gap or a separator.
 *   Keyboard: it follows the highlighted item.
 * - Keyboard-driven highlights also show an inset 1px focus ring for 3:1
 *   visibility. A pointer-driven highlight shows no ring.
 * - Forced colors: the highlight is Highlight, the system's current-item fill, so
 *   the row on it sets forced-color-adjust: none (the browser's backplate would
 *   paint Canvas under its words) and HighlightText on itself and its children. A
 *   list whose highlight is hover only, beside a selection that is Highlight
 *   already, passes forcedHighlight: false.
 * - Fun mode (motion/fun.tsx, a trial, off unless a <FunMode> is on): the highlight
 *   stretches toward the row it is going to. Its leading edge goes on fun mode's glide
 *   spring and its trailing edge follows on the slower swap spring, so it reaches out,
 *   then gathers itself on the row (a scale along y, from its top). It rests exactly
 *   where it does without fun mode. Reduced motion turns it off.
 *
 * Usage
 *   const glide = useGlide();
 *   <div ref={glide.ref} {...glide.props} className="relative">
 *     {glide.highlight}
 *     <div {...GLIDE_ROW} className="relative">…</div>   // every row, in DOM order
 *   </div>
 *   glide.setActive(index | null, "keyboard" | "pointer" | "touch")
 *
 * Rows are the elements marked data-glide-row, and an index is a row's position
 * in DOM order. A row marked data-disabled or aria-disabled is skipped by the pointer.
 */
import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useExit, useFun, useTransition } from "./motion";

export type GlideSource = "pointer" | "keyboard" | "touch";

export type GlideOptions = {
  /**
   * Called with the row nearest a pointer. The default highlights it directly.
   * The command menu overrides this to keep its own state as the source of truth.
   */
  onPointerRow?: (index: number, row: HTMLElement, type: "mouse" | "touch") => void;
  /**
   * Radix menus keep their highlight on DOM focus. With this on, a mouse over a gap
   * focuses the nearest row, and the focus event drives the highlight (see focusRow).
   */
  focusRows?: boolean;
  /** Keep the highlight when the pointer leaves. A function can decide (a submenu is open). */
  keepOnLeave?: boolean | (() => boolean);
  /** Scroll the row into view on keyboard moves (a list with a max height). */
  scroll?: boolean;
  /** Under forced colors, fill the highlight with Highlight (the default). Off where Highlight already means selected. */
  forcedHighlight?: boolean;
};

/** Spread onto every row. */
export const GLIDE_ROW = { "data-glide-row": "" } as const;

const ROW = "[data-glide-row]";
const isDisabled = (el: HTMLElement) => el.hasAttribute("data-disabled") || el.getAttribute("aria-disabled") === "true";

export function useGlide(options: GlideOptions = {}) {
  const enter = useTransition("responsive");
  const exit = useExit("responsive");
  const fun = useFun();
  const latest = useRef({ enter, exit, options, fun });
  latest.current = { enter, exit, options, fun };

  const y = useMotionValue(0);
  /* Fun mode: the bottom edge moves on its own spring, and the highlight is drawn from y to it. */
  const bottom = useMotionValue(0);
  const height = useRef(1);
  const scaleY = useTransform(() => (bottom.get() - y.get()) / height.current);
  const opacity = useMotionValue(0);
  const list = useRef<HTMLElement | null>(null);
  const hl = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const shown = useRef(false);
  const current = useRef<number | null>(null);
  const modality = useRef<"pointer" | "keyboard">("keyboard");
  const inside = useRef(false);
  const lastPoint = useRef({ x: -1, y: -1 });
  const runs = useRef<{ y?: AnimationPlaybackControls; b?: AnimationPlaybackControls; o?: AnimationPlaybackControls }>({});

  const rows = useCallback(() => Array.from(list.current?.querySelectorAll<HTMLElement>(ROW) ?? []), []);

  const place = useCallback(
    (row: HTMLElement, jump: boolean) => {
      const el = hl.current;
      if (!el) return;
      /* Geometry is static (every row is the same size); only y moves. */
      el.style.left = `${row.offsetLeft}px`;
      el.style.width = `${row.offsetWidth}px`;
      el.style.height = `${row.offsetHeight}px`;
      runs.current.y?.stop();
      runs.current.b?.stop();
      const f = latest.current.fun;
      if (f) {
        /* Fun mode: the edge on the side it is going leads on the glide spring, the other trails on the swap spring. */
        const top = row.offsetTop;
        const end = top + row.offsetHeight;
        height.current = row.offsetHeight || 1;
        if (jump) {
          y.jump(top);
          bottom.jump(end);
          return;
        }
        /* Fun mode turned on while a highlight showed: the bottom edge starts where the highlight is. */
        if (Math.abs(bottom.get() - y.get() - row.offsetHeight) > 1 && !runs.current.b) bottom.jump(y.get() + row.offsetHeight);
        const down = top > y.get();
        runs.current.y = animate(y, top, down ? f.swap : f.glide);
        runs.current.b = animate(bottom, end, down ? f.glide : f.swap);
        return;
      }
      if (jump) y.jump(row.offsetTop);
      else runs.current.y = animate(y, row.offsetTop, latest.current.enter);
    },
    [y, bottom],
  );

  const hide = useCallback(() => {
    if (!shown.current) return;
    shown.current = false;
    current.current = null;
    runs.current.o?.stop();
    runs.current.o = animate(opacity, 0, latest.current.exit);
  }, [opacity]);

  const setActive = useCallback(
    (index: number | null, source: GlideSource, opts?: { jump?: boolean }) => {
      if (index === null) return hide();
      const row = rows()[index];
      const el = hl.current;
      if (!row || !el) return;
      el.dataset.ring = String(source === "keyboard");
      const first = !shown.current;
      if (first || index !== current.current || opts?.jump) place(row, first || !!opts?.jump || source === "touch");
      if (first) {
        shown.current = true;
        runs.current.o?.stop();
        runs.current.o = animate(opacity, 1, latest.current.enter);
      }
      current.current = index;
      if (latest.current.options.scroll && source === "keyboard") {
        if (index === 0 && list.current) list.current.scrollTop = 0;
        else row.scrollIntoView({ block: "nearest" });
      }
    },
    [hide, opacity, place, rows],
  );

  /** Re-measure after the list changed shape. Snaps, never glides. */
  const refresh = useCallback(() => {
    if (!shown.current || current.current === null) return;
    const row = rows()[current.current];
    if (row) place(row, true);
  }, [place, rows]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      observer.current?.disconnect();
      list.current = el;
      if (el && typeof ResizeObserver !== "undefined") {
        observer.current = new ResizeObserver(() => refresh());
        observer.current.observe(el);
      }
    },
    [refresh],
  );

  /** For Radix items: call from onFocus. The source follows the last input. */
  const focusRow = useCallback(
    (el: HTMLElement) => {
      const i = rows().indexOf(el);
      if (i >= 0) setActive(i, modality.current);
    },
    [rows, setActive],
  );

  /** Drop or restore the ring without moving: focus has gone into a submenu, so the ring belongs there. */
  const setRing = useCallback((on: boolean) => {
    if (hl.current) hl.current.dataset.ring = String(on);
  }, []);

  /** A submenu closed: if the pointer is elsewhere, let go of the parent's highlight. */
  const release = useCallback(() => {
    if (modality.current === "pointer" && !inside.current) hide();
  }, [hide]);

  const nearest = useCallback(
    (e: PointerEvent, type: "mouse" | "touch") => {
      const root = list.current;
      /* Events from a portaled submenu bubble through React; only handle our own DOM. */
      if (!root || !root.contains(e.target as Node)) return;
      const all = rows();
      let best = -1;
      let bestD = Infinity;
      all.forEach((r, i) => {
        if (isDisabled(r)) return;
        const b = r.getBoundingClientRect();
        const d = e.clientY < b.top ? b.top - e.clientY : e.clientY > b.bottom ? e.clientY - b.bottom : 0;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return;
      const row = all[best];
      const o = latest.current.options;
      if (o.onPointerRow) return o.onPointerRow(best, row, type);
      if (type === "mouse" && o.focusRows) {
        /* Over a row, Radix focuses it itself (and honours its submenu grace area). */
        if ((e.target as HTMLElement).closest(ROW)) return;
        const keep = o.keepOnLeave;
        if (typeof keep === "function" ? keep() : keep) return;
        if (document.activeElement !== row) row.focus({ preventScroll: true });
        return;
      }
      setActive(best, type === "mouse" ? "pointer" : "touch");
    },
    [rows, setActive],
  );

  const props = useMemo(
    () => ({
      onPointerEnter: () => {
        inside.current = true;
      },
      onPointerLeave: (e: PointerEvent) => {
        inside.current = false;
        if (e.pointerType === "touch") return;
        const keep = latest.current.options.keepOnLeave;
        if (typeof keep === "function" ? keep() : keep) return;
        hide();
      },
      onPointerMoveCapture: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        /* A list that scrolls under a resting mouse fires fake moves; ignore them. */
        const p = lastPoint.current;
        if (p.x === e.clientX && p.y === e.clientY) return;
        lastPoint.current = { x: e.clientX, y: e.clientY };
        modality.current = "pointer";
        nearest(e, "mouse");
      },
      onPointerDownCapture: (e: PointerEvent) => {
        if (e.pointerType === "touch") nearest(e, "touch");
      },
      onKeyDownCapture: (_e: KeyboardEvent) => {
        modality.current = "keyboard";
      },
    }),
    [hide, nearest],
  );

  const highlight = (
    <motion.div
      ref={hl}
      aria-hidden="true"
      data-ring="false"
      className={
        "pointer-events-none absolute top-0 left-0 rounded-litt-control bg-[color-mix(in_oklab,var(--litt-fg)_7%,transparent)] data-[ring=true]:shadow-[inset_0_0_0_1px_var(--litt-focus)]" +
        (options.forcedHighlight === false ? "" : " forced-colors:bg-[Highlight] forced-colors:[forced-color-adjust:none]")
      }
      style={fun ? { y, opacity, scaleY, originY: 0 } : { y, opacity }}
    />
  );

  return { ref, props, highlight, setActive, hide, refresh, focusRow, release, setRing };
}

export type Glide = ReturnType<typeof useGlide>;
