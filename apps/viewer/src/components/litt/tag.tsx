"use client";
// @litt/tag 2026.11.05. What changed: https://littmd.vercel.app/changelog.md

/**
 * Tag: a small label that names something (Framer, Site), files it under a category (Finance),
 * or reports its status (Live, Review).
 *
 * - The look is a flat chip (components.md, Tag; R3's flat step): 24px tall at the control radius,
 *   a surface-1 fill with an inset line hairline and the top highlight, and the sans at the
 *   caption size and the label weight (R8, v0.12), in sentence case. A plain tag is fg-muted.
 * - A status tag colors its text with the status color, never the fill, and there is no dot.
 *   The label says the status in words, so color never carries it alone.
 * - The status set is the tokens' own: success, warning and danger, plus neutral (fg-subtle).
 *   There is no accent status: the accent is chosen per project, and it does not promise
 *   4.5:1 for caption text.
 * - A hue tag (R7, v0.11) files the thing under a category, so its color carries data: the
 *   hue's tint as the fill, its -text tone for the label (4.5:1 on the tint, checked by
 *   check.mjs), and a hairline of the hue under the top highlight. One hue means one category
 *   in a view. A hue is never a status: a tag that says how something stands takes `status`.
 * - Raised (R3): a value you can lift out of a field (Token input's tokens, Combobox's picks) is
 *   the press material's block, --litt-block with --litt-block-lift, in --litt-fg like the text typed beside it.
 *   It sits inside the field's control radius, so its corners are that radius less 2px. Forced
 *   colors drops the lift, so it keeps a 1px border. A hue tag files a category and never rises.
 * - Static: no motion and no states. A tag is a label, not a control, so it never takes
 *   focus. If you need something to press, use Button or a chip.
 */
import type { HTMLAttributes, ReactNode } from "react";

export type TagStatus = "success" | "warning" | "danger" | "neutral";

/** The five data hues, in their fixed order (R7). */
export type TagHue = "blue" | "amber" | "teal" | "violet" | "rose";

const STATUS: Record<TagStatus, string> = {
  success: "text-litt-success",
  warning: "text-litt-warning",
  danger: "text-litt-danger",
  neutral: "text-litt-fg-subtle",
};

const HUE: Record<TagHue, string> = {
  blue: "bg-litt-data-blue-tint text-litt-data-blue-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-blue)_24%,transparent),var(--litt-highlight)]",
  amber: "bg-litt-data-amber-tint text-litt-data-amber-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-amber)_24%,transparent),var(--litt-highlight)]",
  teal: "bg-litt-data-teal-tint text-litt-data-teal-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-teal)_24%,transparent),var(--litt-highlight)]",
  violet: "bg-litt-data-violet-tint text-litt-data-violet-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-violet)_24%,transparent),var(--litt-highlight)]",
  rose: "bg-litt-data-rose-tint text-litt-data-rose-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-rose)_24%,transparent),var(--litt-highlight)]",
};

const PLAIN = "rounded-litt-control bg-litt-surface-1 shadow-[inset_0_0_0_1px_var(--litt-line),var(--litt-highlight)] ";
/* In a field, 4px in: the field's radius less the inset, never under 2px (foundations.md, Concentric). */
const RAISED = "rounded-[max(calc(var(--litt-radius-control)-4px),min(calc(var(--litt-radius-control)-2px),2px))] bg-litt-block shadow-(--litt-block-lift) forced-colors:border ";

export type TagProps = HTMLAttributes<HTMLSpanElement> & {
  /** Leave it out for a plain label. Set it for a status: the text takes that color, and the fill never does. */
  status?: TagStatus;
  /** Files the thing under a category with one of the five data hues: a tinted fill and the hue's text tone. Use one hue per category in a view, and never for a status. */
  hue?: TagHue;
  /** Draws a plain tag as a raised block, for a tag you can lift out of a field: Token input and Combobox use it for their values. Ignored with a hue. */
  raised?: boolean;
  /** The label. Keep it to a word or two, because a tag never wraps. */
  children: ReactNode;
  /** Extra classes for the tag. */
  className?: string;
};

/** A 24px label at the control radius, in the sans at the label weight. Add `status` to color its text, `hue` to file it under a category, or `raised` for a value in a field. */
export function Tag({ status, hue, raised = false, children, className = "", ...rest }: TagProps) {
  const ink = status ? STATUS[status] : raised ? "text-litt-fg" : "text-litt-fg-muted";
  return (
    <span
      className={
        "inline-flex h-6 max-w-full shrink-0 items-center whitespace-nowrap px-2 text-litt-caption " +
        (hue ? "rounded-litt-control " + HUE[hue] : (raised ? RAISED : PLAIN) + ink) +
        " " +
        className
      }
      {...rest}
    >
      {typeof children === "string" || typeof children === "number" ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}
