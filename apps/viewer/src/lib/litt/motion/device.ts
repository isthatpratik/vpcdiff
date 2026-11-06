import { createContext, createElement, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export type Device = { compact: boolean; coarse: boolean };
export type DeviceMode = "auto" | "phone" | "desktop";

const COMPACT = "(max-width: 39.999rem)";
const COARSE = "(pointer: coarse)";

const lists = new Map<string, MediaQueryList>();
function list(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  let mql = lists.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    lists.set(query, mql);
  }
  return mql;
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = list(query);
      if (!mql) return () => {};
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => list(query)?.matches ?? false,
    () => false,
  );
}

const ModeContext = createContext<DeviceMode>("auto");

/** Forces the device for everything inside it. Only the Playground uses it; "auto" follows the real screen. */
export function DeviceProvider({ mode, children }: { mode: DeviceMode; children: ReactNode }) {
  return createElement(ModeContext.Provider, { value: mode }, children);
}

/** `{ compact, coarse }` for this screen, or what the nearest DeviceProvider forces. */
export function useDevice(): Device {
  const mode = useContext(ModeContext);
  const compact = useMedia(COMPACT);
  const coarse = useMedia(COARSE);
  if (mode === "phone") return { compact: true, coarse: true };
  if (mode === "desktop") return { compact: false, coarse: false };
  return { compact, coarse };
}

/** The part of the screen a person can see: its top edge and height, in layout pixels. */
export type VisibleScreen = { top: number; height: number };

/**
 * The visible screen, from window.visualViewport. It shrinks when the on-screen keyboard opens and moves when the
 * page is panned to keep a field in view; the layout viewport, `fixed inset-0` and 100dvh do not always follow it.
 * Null while disabled, on the server, before the first read, or with no visual viewport: fall back to 100dvh then.
 *
 * @param enabled - Read and follow it only while this is true, such as while a sheet is on a compact screen.
 */
export function useVisibleScreen(enabled: boolean): VisibleScreen | null {
  const [screen, setScreen] = useState<VisibleScreen | null>(null);
  useLayoutEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !vv) return;
    const read = () => {
      const next = { top: Math.round(vv.offsetTop), height: Math.round(vv.height) };
      setScreen((prev) => (prev && prev.top === next.top && prev.height === next.height ? prev : next));
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      setScreen(null);
    };
  }, [enabled]);
  return enabled ? screen : null;
}

/* How many bottom sheets are open on the page. One page shares it, like the media queries. */
let sheets = 0;
const sheetListeners = new Set<() => void>();
const sheetChanged = (by: number) => {
  sheets += by;
  sheetListeners.forEach((listener) => listener());
};

/**
 * Counts a bottom sheet as open while `open` is true. The sheet calls it with its open state (not its exit), so a
 * toast fired as the sheet closes goes to the usual edge.
 *
 * @param open - Whether the sheet is open.
 */
export function useSheetPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    sheetChanged(1);
    return () => sheetChanged(-1);
  }, [open]);
}

/** Whether a bottom sheet is open anywhere on the page. False on the server and while hydrating. */
export function useSheetOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      sheetListeners.add(onChange);
      return () => sheetListeners.delete(onChange);
    },
    () => sheets > 0,
    () => false,
  );
}

/**
 * The dismissal thresholds from tokens.css: a released drag leaves when it has travelled `distance` of the
 * surface's size, or moves faster than `velocity` px per ms. Read at gesture time, in the browser.
 */
export function readDismiss(): { distance: number; velocity: number } {
  const style = getComputedStyle(document.documentElement);
  const num = (name: string) => {
    const raw = style.getPropertyValue(name).trim();
    const v = Number(raw);
    if (!raw || !Number.isFinite(v) || v <= 0) throw new Error(`tokens.css: ${name} should be a positive number, found "${raw}"`);
    return v;
  };
  return { distance: num("--litt-dismiss-distance"), velocity: num("--litt-dismiss-velocity") };
}
