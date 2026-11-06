"use client";
// @litt/scroll-area 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * ScrollArea: a region that scrolls inside the page, such as a log, a long list in a fixed-height card or a side
 * panel. Never the page itself (components.md, Scroll area; decision 21). Built on Radix ScrollArea: the scrolling
 * stays native (wheel, touch, keyboard, momentum), and only the scrollbar is litt's.
 *
 * - Thumb: 6px at the control radius, fg 24%, fg 40% while its strip is hovered or dragged (instant tier, color
 *   only). It sits on a transparent track with 2px of inset, so the hit area is 10px, and it overlays the content.
 * - When it shows: while the area scrolls, or while a mouse is over it, then it fades out on the instant tier
 *   after a short pause. On coarse pointers there is no hover, so it shows only while scrolling. Nothing shows
 *   or fades before a person has touched, scrolled, hovered or focused the area: a log that starts at its end
 *   does not flash a thumb on load.
 * - Edges: a 1px --litt-line hairline appears on any edge with more content beyond it, and goes when that edge is
 *   reached (instant tier, color only). No gradient fades, because material is static (R2).
 * - Focus: when it scrolls, the viewport is a labelled region and a Tab stop, so the arrow keys, Page Up and Down,
 *   Home and End scroll it. Keyboard focus draws an inset 2px focus ring, inside its edges.
 * - Axes: vertical by default, horizontal or both on request. Vertical content is a block, so text wraps; sideways
 *   content keeps its own width and scrolls.
 * - Reduced motion: the duration token is zero, so the thumb and the hairlines change at once.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { useDevice } from "../../lib/litt/motion";

/** How long the thumb stays after the last scroll, or after the pointer leaves (an interaction delay, not animation). */
const HIDE_DELAY = 600; // ms

type Edges = { top: boolean; bottom: boolean; left: boolean; right: boolean; scrollsY: boolean; scrollsX: boolean };
const NONE: Edges = { top: false, bottom: false, left: false, right: false, scrollsY: false, scrollsX: false };
const same = (a: Edges, b: Edges) => (Object.keys(a) as (keyof Edges)[]).every((k) => a[k] === b[k]);

/* Classes once the area is armed (see the header): before that, a change snaps. */
const FADE = "transition-opacity duration-(--litt-dur-instant) ease-litt ";
const TINT = "transition-colors duration-(--litt-dur-instant) ease-litt ";

const THUMB =
  "relative flex-1 rounded-litt-control bg-[color-mix(in_oklab,var(--litt-fg)_24%,transparent)] " +
  "transition-colors duration-(--litt-dur-instant) ease-litt " +
  "group-hover/bar:bg-[color-mix(in_oklab,var(--litt-fg)_40%,transparent)] group-active/bar:bg-[color-mix(in_oklab,var(--litt-fg)_40%,transparent)]";

export type ScrollAreaProps = {
  /** What the region holds, such as "Build log". It names the scrolling region, which is a Tab stop while it scrolls. */
  label: string;
  /** Which way it scrolls: vertical, horizontal, or both. */
  orientation?: "vertical" | "horizontal" | "both";
  /** Classes for the box. Give it a height (h-72) or a max height (max-h-96) to scroll vertically, and a width or a parent with one to scroll sideways. */
  className?: string;
  /** A ref to the scrolling element, to read or set its scroll position, such as starting a log at its end. */
  viewportRef?: Ref<HTMLDivElement>;
  /** The content. Leave a little room at the end edge (pr-3, or pb-3 sideways) so the thumb does not sit on text. */
  children: ReactNode;
};

/** A box that scrolls natively with litt's thin thumb, and a hairline on each edge that has more beyond it. */
export function ScrollArea({ label, orientation = "vertical", className = "", viewportRef, children }: ScrollAreaProps) {
  const { coarse } = useDevice();
  const y = orientation !== "horizontal";
  const x = orientation !== "vertical";

  const viewport = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const setViewport = useCallback(
    (el: HTMLDivElement | null) => {
      viewport.current = el;
      if (typeof viewportRef === "function") viewportRef(el);
      else if (viewportRef) viewportRef.current = el;
    },
    [viewportRef],
  );

  /* Which edges have more beyond them, and whether each axis scrolls at all. */
  const [edges, setEdges] = useState<Edges>(NONE);
  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const maxY = el.scrollHeight - el.clientHeight;
    const maxX = el.scrollWidth - el.clientWidth;
    const left = Math.abs(el.scrollLeft); // right-to-left pages scroll to negative values
    const next: Edges = {
      top: y && el.scrollTop > 1,
      bottom: y && el.scrollTop < maxY - 1,
      left: x && left > 1,
      right: x && left < maxX - 1,
      scrollsY: y && maxY > 1,
      scrollsX: x && maxX > 1,
    };
    setEdges((prev) => (same(prev, next) ? prev : next));
  }, [x, y]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [measure]);

  /* Armed once a person reaches for the area. Until then nothing fades and the thumb never shows. */
  const armedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const arm = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    setArmed(true);
  };

  const [hover, setHover] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const hoverTimer = useRef(0);
  const scrollTimer = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  const onScroll = () => {
    measure();
    if (!armedRef.current) return;
    setScrolling(true);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setScrolling(false), HIDE_DELAY);
  };

  /* A mouse over the area shows the thumb. A finger has no hover, so on coarse pointers only scrolling shows it. */
  const hovers = (e: PointerEvent) => !coarse && e.pointerType !== "touch";
  const onPointerEnter = (e: PointerEvent) => {
    if (!hovers(e)) return;
    arm();
    window.clearTimeout(hoverTimer.current);
    setHover(true);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (!hovers(e)) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover(false), HIDE_DELAY);
  };

  const shown = hover || scrolling;
  const scrolls = edges.scrollsX || edges.scrollsY;
  const bar = (on: boolean) =>
    "group/bar flex touch-none select-none p-0.5 " + (armed ? FADE : "") + (on ? "opacity-100" : "pointer-events-none opacity-0");
  const line = (on: boolean) => "pointer-events-none absolute " + (armed ? TINT : "") + (on ? "bg-litt-line" : "bg-transparent");

  return (
    <ScrollAreaPrimitive.Root
      type="always"
      className={"relative overflow-hidden " + className}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onWheelCapture={arm}
      onTouchStartCapture={arm}
      onPointerDownCapture={arm}
      onKeyDownCapture={arm}
      onFocusCapture={arm}
    >
      <ScrollAreaPrimitive.Viewport
        ref={setViewport}
        disableImplicitContentElement
        onScroll={onScroll}
        role={scrolls ? "region" : undefined}
        aria-label={scrolls ? label : undefined}
        tabIndex={scrolls ? 0 : undefined}
        style={{ borderRadius: "inherit" }}
        className="size-full max-h-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus"
      >
        {/* Radix lays the content out as a table so it can grow sideways. Vertical content is a block, so it wraps. */}
        <ScrollAreaPrimitive.Content ref={content} style={x ? undefined : { display: "block" }}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>

      {y && (
        <>
          <span aria-hidden="true" className={line(edges.top) + " inset-x-0 top-0 h-px"} />
          <span aria-hidden="true" className={line(edges.bottom) + " inset-x-0 bottom-0 h-px"} />
          <ScrollAreaPrimitive.Scrollbar orientation="vertical" className={bar(shown && edges.scrollsY) + " w-2.5"}>
            <ScrollAreaPrimitive.Thumb className={THUMB} />
          </ScrollAreaPrimitive.Scrollbar>
        </>
      )}
      {x && (
        <>
          <span aria-hidden="true" className={line(edges.left) + " inset-y-0 left-0 w-px"} />
          <span aria-hidden="true" className={line(edges.right) + " inset-y-0 right-0 w-px"} />
          <ScrollAreaPrimitive.Scrollbar orientation="horizontal" className={bar(shown && edges.scrollsX) + " h-2.5 flex-col"}>
            <ScrollAreaPrimitive.Thumb className={THUMB} />
          </ScrollAreaPrimitive.Scrollbar>
        </>
      )}
      {x && y && <ScrollAreaPrimitive.Corner />}
    </ScrollAreaPrimitive.Root>
  );
}
