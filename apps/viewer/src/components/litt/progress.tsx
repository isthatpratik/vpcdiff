"use client";
// @litt/progress 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * Progress: how far along something is that is happening now, such as an upload, an import or a build
 * (components.md, "Progress"). A Meter shows a quantity against a limit and stands still; Progress moves while the
 * work goes on, then ends done or failed.
 *
 * - Anatomy: the Meter's lockup. The label at the small size in --litt-fg, the reading at the end in tabular figures at the caption
 *   size in --litt-fg-subtle ("3.2 of 8 MB", or the percent), and under them a slot cut into the page (R3, material.md 6: a
 *   slot is what fills), 8px tall at the control radius: the floor --litt-slot, the done part in it in --litt-fg. The walls
 *   (--litt-slot-shade: the top one's shade, the lit lower one) are drawn on a layer above the fill, so the fill sits down in
 *   the channel instead of covering its walls. Never the accent and never a data hue: it is one quantity.
 * - Ending: done fills the slot and the reading says "Done"; failed keeps the fill where it stopped, in --litt-danger (a status
 *   mark, which R7 allows), and the reading says "Failed". A message under the slot says the rest (what failed and what
 *   to do, or the time left).
 * - Not known yet: with no value the slot stays empty and the reading says so in words ("Waiting"). Nothing moves on its
 *   own: no stripes, no shimmer, no sweep. A wait that has no end in sight is a spinner in a button, not a slot.
 * - Motion: the done part is a full-width band scaled from the left, so only a transform changes, on the instant tier,
 *   which keeps up with a value that updates often. Its end is square: a radius would squash with the scale. Under
 *   reduced motion it jumps.
 * - Forced colors drops the walls and the floor, so the slot gets a real border and the fill takes CanvasText.
 * - Accessibility: role="progressbar", named by the label, with aria-valuenow while the value is known and the reading
 *   as aria-valuetext. Ending done or failed is said once in a polite status, so a long wait need not be watched.
 */
import { useId, type ReactNode } from "react";

export type ProgressStatus = "active" | "done" | "failed";

export type ProgressProps = {
  /** What is in progress: "Uploading brief.pdf", "Importing 1,204 pages". */
  label: ReactNode;
  /** How far along it is, from 0 to max. Leave it out while that is not known yet: the slot stays empty and nothing moves. */
  value?: number;
  /** The value that means finished. */
  max?: number;
  /** The reading at the end of the label row, and what a screen reader hears: "3.2 of 8 MB". Default: the percent. */
  valueText?: string;
  /** active while it runs; done fills the slot and says Done; failed keeps the fill where it stopped and says Failed. */
  status?: ProgressStatus;
  /** A line under the slot: the time left, or what failed and what to do about it. */
  message?: ReactNode;
  /** Hides the label row but keeps it as the name, for a row that already shows the name, such as a file in a list. */
  hideLabel?: boolean;
  className?: string;
};

/** A slot for work that is happening now: it fills as the value grows, then ends done or failed, said in words. */
export function Progress({ label, value, max = 100, valueText, status = "active", message, hideLabel = false, className = "" }: ProgressProps) {
  const labelId = useId();
  const messageId = useId();
  const known = value !== undefined || status === "done";
  const share = status === "done" ? 1 : max > 0 && value !== undefined ? Math.max(0, Math.min(1, value / max)) : 0;
  const reading =
    status === "done" ? "Done" : status === "failed" ? "Failed" : value === undefined ? (valueText ?? "Waiting") : (valueText ?? `${Math.round(share * 100)}%`);
  const tone = status === "failed" ? "text-litt-danger" : "text-litt-fg-subtle";

  return (
    <div className={"grid min-w-0 gap-2 " + className}>
      <div className={hideLabel ? "sr-only" : "flex items-baseline justify-between gap-4"}>
        <span id={labelId} className="min-w-0 truncate text-litt-small text-litt-fg">
          {label}
        </span>
        <span className={"shrink-0 text-litt-caption font-normal tabular-nums " + tone}>{reading}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-describedby={message ? messageId : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={known ? Math.round(share * max) : undefined}
        aria-valuetext={reading}
        className="relative h-2 overflow-hidden rounded-litt-control bg-litt-slot forced-colors:border"
      >
        {/* A full-width band scaled from the left: only a transform changes as the value grows. */}
        <div
          className={
            "h-full w-full origin-left transition-transform duration-(--litt-dur-instant) ease-litt forced-colors:bg-[CanvasText] " +
            (status === "failed" ? "bg-litt-danger" : "bg-litt-fg")
          }
          style={{ transform: `scaleX(${share})` }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-litt-control shadow-(--litt-slot-shade)" />
      </div>
      {message && (
        <p id={messageId} className={"text-litt-small " + (status === "failed" ? "text-litt-danger" : "text-litt-fg-subtle")}>
          {message}
        </p>
      )}
      {/* The end is said once, so nobody has to watch the slot. Kept mounted, so the change is announced. */}
      <span role="status" className="sr-only">
        {status === "active" ? "" : `${typeof label === "string" ? `${label}: ` : ""}${status === "done" ? "done" : "failed"}.`}
      </span>
    </div>
  );
}
