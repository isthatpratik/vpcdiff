// One copy control for the whole viewer. The icon crossfades to a tick (opacity, scale,
// and a 2px blur, 200ms ease-out), a "Copied" label fades in beside it, and a polite live
// region tells screen readers. Clipboard failures say so instead of failing silently.
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/litt/icons";

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const HOLD = 1600;

let announceTo: ((message: string) => void) | undefined;

/** Writes to the page's live region, so screen readers hear "Copied" or a failure. */
export function announce(message: string) {
  announceTo?.(message);
}

/** The page's one polite live region. Render it once, near the root. */
export function Announcer() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let t = 0;
    announceTo = (m) => {
      // Clear first so the same message twice is still announced.
      setMessage("");
      window.clearTimeout(t);
      t = window.setTimeout(() => setMessage(m), 30);
    };
    return () => {
      announceTo = undefined;
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}

type Status = "idle" | "copied" | "failed";

function useCopy(text: () => string, what: string) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    let next: Status;
    try {
      await navigator.clipboard.writeText(text());
      next = "copied";
    } catch {
      next = "failed";
    }
    setStatus(next);
    announce(next === "copied" ? `Copied ${what}` : `Could not copy ${what}. Select the text and copy it by hand.`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), HOLD);
  };
  return [status, copy] as const;
}

function Icons({ status, className }: { status: Status; className: string }) {
  const icon = `absolute inset-0 m-auto transition-[opacity,transform,filter] duration-200 ${EASE} motion-reduce:transition-none`;
  const on = "scale-100 opacity-100 blur-0";
  const off = "scale-50 opacity-0 blur-[2px]";
  return (
    <span aria-hidden="true" className={`relative inline-block shrink-0 ${className}`}>
      <CopyIcon className={`${icon} size-full ${status === "idle" ? on : off}`} />
      <CheckIcon className={`${icon} size-full ${status === "copied" ? on : off}`} />
      <span className={`${icon} grid size-full place-items-center text-[11px] leading-none font-semibold text-litt-danger ${status === "failed" ? on : off}`}>!</span>
    </span>
  );
}

/**
 * A copy button. `variant="icon"` is a 28px square whose "Copied" label appears beside it;
 * `variant="text"` keeps its label and swaps it for "Copied" in place, without a width jump.
 */
export function CopyButton({ text, what, label, variant = "icon", side = "right", className = "" }: { text: string | (() => string); what: string; label?: string; variant?: "icon" | "text"; side?: "left" | "right"; className?: string }) {
  const [status, copy] = useCopy(typeof text === "function" ? text : () => text, what);
  const done = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "";
  const fade = `transition-[opacity,transform] duration-200 ${EASE} motion-reduce:transition-none`;
  if (variant === "icon") {
    return (
      <span className={`relative inline-flex shrink-0 items-center ${className}`}>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={label ?? `Copy ${what}`}
          className="grid size-7 place-items-center rounded-[6px] text-litt-fg-subtle transition-[background-color,color,transform] duration-150 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-fg active:scale-[0.94]"
        >
          <Icons status={status} className="size-3.5" />
        </button>
        <span aria-hidden="true" className={`pointer-events-none absolute ${side === "right" ? "left-full ml-1" : "right-full mr-1"} text-litt-caption whitespace-nowrap ${status === "failed" ? "text-litt-danger" : "text-litt-fg-muted"} ${fade} ${done ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"}`}>
          {done || "Copied"}
        </span>
      </span>
    );
  }
  const name = label ?? `Copy ${what}`;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-litt-caption text-litt-fg-muted shadow-[inset_0_0_0_1px_var(--litt-line)] transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-litt-surface-2 hover:text-litt-fg hover:shadow-[inset_0_0_0_1px_var(--litt-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-fg active:scale-[0.97] ${className}`}
    >
      <Icons status={status} className="size-3.5" />
      {/* Both labels share one grid cell, so the button keeps the wider width. */}
      <span className="grid justify-items-start text-left">
        <span className={`[grid-area:1/1] ${fade} ${done ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100"}`}>{name}</span>
        <span aria-hidden="true" className={`[grid-area:1/1] ${fade} ${status === "failed" ? "text-litt-danger" : ""} ${done ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
          {done || "Copied"}
        </span>
      </span>
    </button>
  );
}
