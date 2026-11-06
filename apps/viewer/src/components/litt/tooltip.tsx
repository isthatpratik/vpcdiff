"use client";
// @litt/tooltip 2026.10.25. What changed: https://littmd.vercel.app/changelog.md

/**
 * Tooltip: a small label for an icon, a shortcut or a status.
 *
 * - Radix Tooltip is the accessibility layer (aria-describedby, Escape, hover
 *   intent, the skip window). Everything visual is ours.
 * - Look: a solid surface-3 chip with shadow-litt-tooltip. It is too small for glass
 *   to read. rounded-litt-control, text-litt-small, 6px by 8px, 240px at most. A shortcut
 *   is the shared Kbd chip (kbd.tsx).
 * - Motion (responsive tier): it grows from the trigger. Opacity 0 to 1, scale
 *   0.98 to 1, and a nudge of travel/4 toward the trigger, from the side it
 *   really renders on (Radix data-side, read after collision flipping).
 *   transform-origin is Radix's trigger-side origin. The exit is useExit, a
 *   quiet fade, run by AnimatePresence on a force-mounted Radix portal.
 * - Delays are interaction, not animation: 200ms of hover intent, then a 300ms
 *   window in which the next tooltip opens at once. Keyboard focus opens
 *   instantly (Radix does this on its own; a click never opens one).
 * - Touch (foundations.md section 6): Radix never opens on touch, and a tap is
 *   the button's own action, so a tap no longer shows a label. A press and hold
 *   of 500ms does (an interaction delay like the 200ms above, not a motion
 *   token). The hold is cancelled by lifting early, by drifting past a small
 *   slop, or by the browser taking the touch to scroll. The click a hold may
 *   leave behind is swallowed once, so reading a label never also runs the
 *   action. The next touch anywhere closes it, and a touch on the trigger
 *   still does what the trigger does. The native long-press menu and text
 *   selection are off on the trigger on coarse pointers. Shortcut chips are
 *   not rendered on coarse pointers.
 * - Both signals come from useDevice (coarse), so <DeviceProvider mode="phone">
 *   previews it with a mouse: there the hold works for any pointer and hover
 *   opens nothing, as on a finger device. A touch on a pointer-fine device
 *   (a touch laptop) holds too.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, motion } from "motion/react";
import { useDevice, useExit, useTransition, useTravel } from "../../lib/litt/motion";
import { Kbd } from "./kbd";

/* Radix's asChild, spread in: shadcn's CLI rewrites a written asChild to Base UI's render prop in base-* hosts. */
const asChildProps = { asChild: true } as const;

export type TooltipSide = "top" | "right" | "bottom" | "left";

const OPEN_DELAY = 200; // ms of hover intent before the first tooltip opens (interaction delay, not animation)
const SKIP_WINDOW = 300; // ms after one closes during which the next opens at once (interaction delay)
const HOLD_DELAY = 500; // ms of press and hold before a tooltip opens on touch (interaction delay, not animation)
const HOLD_SLOP = 10; // px a finger may drift during the hold before it counts as a scroll or a drag
const CLICK_WINDOW = 500; // ms after a hold ends in which the click it may leave behind is swallowed

const HasProvider = createContext(false);

/**
 * Mount once near the root so every tooltip shares the skip window. Without it each
 * Tooltip adds its own provider, so tooltips still work but do not share that window.
 */
export function TooltipProvider({
  children,
}: {
  /** Your app, or the part of it that holds tooltips. */
  children: ReactNode;
}) {
  return (
    <HasProvider.Provider value>
      <TooltipPrimitive.Provider delayDuration={OPEN_DELAY} skipDelayDuration={SKIP_WINDOW}>
        {children}
      </TooltipPrimitive.Provider>
    </HasProvider.Provider>
  );
}

export type TooltipProps = {
  /** The label. Keep it short; long text wraps at 240px. On touch it only shows on a press and hold, so the label that matters must also be the trigger's aria-label or visible text. */
  content: ReactNode;
  /** A real keyboard shortcut, shown as a kbd chip. It is not shown on touch screens. */
  shortcut?: string;
  /** Which side of the trigger it opens on. With no room there it flips to the other side, and the entrance follows. */
  side?: TooltipSide;
  /** How it lines up along that side: with the start, the center or the end of the trigger. */
  align?: "start" | "center" | "end";
  /** Controlled open state. Leave undefined to let hover and focus decide. */
  open?: boolean;
  /** Whether it starts open when you do not control it. Hover and focus decide after that. */
  defaultOpen?: boolean;
  /** Called with true or false each time it opens or closes. Pair it with open to control it. */
  onOpenChange?: (open: boolean) => void;
  /** The trigger: one focusable element. */
  children: ReactElement;
};

const isSide = (v: string | null): v is TooltipSide => v === "top" || v === "right" || v === "bottom" || v === "left";

/** A short label for the one element inside it. It opens after a hover delay, at once on focus, or on a press and hold on touch. */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  align = "center",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: TooltipProps) {
  const hasProvider = useContext(HasProvider);
  const { coarse } = useDevice();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;

  const change = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const latest = useRef(change);
  latest.current = change;

  /* Press and hold. `pending` is the timer and where the finger went down. `held` is true from the moment the hold
     opens the tooltip until that press ends; `swallowUntil` then covers the click the release may cause. */
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const swallowUntil = useRef(0);
  const cancelHold = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };
  useEffect(() => cancelHold, []);

  /* The next touch anywhere closes it, at once: Radix waits for the click of an outside touch, which a scroll never makes. */
  useEffect(() => {
    if (!open) return;
    const onTouch = (e: PointerEvent) => {
      if (e.pointerType === "touch") latest.current(false);
    };
    document.addEventListener("pointerdown", onTouch, true);
    return () => document.removeEventListener("pointerdown", onTouch, true);
  }, [open]);

  const tree = (
    <TooltipPrimitive.Root open={open} onOpenChange={change}>
      <TooltipPrimitive.Trigger
        {...asChildProps}
        className="pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
        onPointerDown={(e) => {
          held.current = false;
          swallowUntil.current = 0;
          cancelHold();
          if ((e.pointerType !== "touch" && !coarse) || !e.isPrimary) return;
          pending.current = {
            x: e.clientX,
            y: e.clientY,
            timer: window.setTimeout(() => {
              pending.current = null;
              held.current = true;
              latest.current(true);
            }, HOLD_DELAY),
          };
        }}
        onPointerMove={(e) => {
          const at = pending.current;
          if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > HOLD_SLOP) cancelHold();
          /* A finger has no hover. This also keeps a mouse from opening it while a phone is previewed. */
          if (coarse && e.pointerType !== "touch") e.preventDefault();
        }}
        onPointerUp={() => {
          cancelHold();
          if (held.current) swallowUntil.current = performance.now() + CLICK_WINDOW;
          held.current = false;
        }}
        onPointerCancel={() => {
          cancelHold();
          held.current = false;
        }}
        onContextMenu={(e) => {
          /* The long press must not also raise the browser's own menu. */
          if (pending.current || held.current) e.preventDefault();
        }}
        onClickCapture={(e) => {
          /* Reading a label is not pressing the button. Stopping it here also keeps Radix's click from closing the label. */
          if (performance.now() < swallowUntil.current) {
            swallowUntil.current = 0;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <AnimatePresence>
        {open && (
          <TooltipPrimitive.Portal key="tooltip" forceMount>
            <TooltipSurface side={side} align={align} content={content} shortcut={coarse ? undefined : shortcut} />
          </TooltipPrimitive.Portal>
        )}
      </AnimatePresence>
    </TooltipPrimitive.Root>
  );

  return hasProvider ? tree : <TooltipProvider>{tree}</TooltipProvider>;
}

function TooltipSurface({
  side: requested,
  align,
  content,
  shortcut,
}: Pick<TooltipProps, "content" | "shortcut" | "align"> & { side: TooltipSide }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<TooltipSide>(requested);
  const enter = useTransition("responsive");
  const exit = useExit("responsive");
  const travel = useTravel();

  /* Radix flips the tooltip when it would collide with the viewport. It writes
     the side it really renders on to data-side, a beat after mount. Follow it,
     and remount the surface (key) so the entrance starts on the right side. */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => {
      const s = host.getAttribute("data-side");
      if (isSide(s)) setSide(s);
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(host, { attributes: true, attributeFilter: ["data-side"] });
    return () => watch.disconnect();
  }, []);

  /* Start a quarter of the travel nearer the trigger, then move away from it. */
  const d = travel / 4;
  const toward = side === "top" ? { y: d } : side === "bottom" ? { y: -d } : side === "left" ? { x: d } : { x: -d };

  return (
    <TooltipPrimitive.Content
      ref={hostRef}
      side={requested}
      align={align}
      sideOffset={8}
      collisionPadding={8}
      className="z-50 data-[state=closed]:pointer-events-none"
    >
      <motion.div
        key={side}
        className="flex max-w-60 origin-(--radix-tooltip-content-transform-origin) items-center gap-3 rounded-litt-control bg-litt-surface-3 px-2 py-1.5 text-litt-small text-litt-fg shadow-litt-tooltip inset-shadow-litt-highlight"
        initial={{ opacity: 0, scale: 0.98, ...toward }}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0, transition: enter }}
        exit={{ opacity: 0, scale: 0.98, transition: exit }}
      >
        <span className="min-w-0 text-pretty">{content}</span>
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </motion.div>
    </TooltipPrimitive.Content>
  );
}
