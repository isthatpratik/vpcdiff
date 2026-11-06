"use client";
// @litt/states 2026.11.05. What changed: https://littmd.vercel.app/changelog.md

/**
 * Empty, loading and error states (components.md, "Empty and loading states").
 *
 * - Empty: what will appear here, in one sentence, and one action to make it appear.
 *   Left-aligned in its container. No illustration.
 * - Skeleton: a surface-2 block at the real content's dimensions, so nothing jumps when
 *   the content arrives. Loading groups the blocks and says what is loading.
 * - ErrorState: what went wrong in plain words, then how to fix it or retry. The status
 *   color is on the icon only.
 * - Static. Nothing here moves, so there is no tier. The spec allows a skeleton to pulse in
 *   opacity for at most 240ms a pass, but no tier token gives a duration for a pulse (instant is the
 *   hover tween, the others run longer than 240ms) and a literal would break the rules, so the
 *   skeleton stays still. A state that swaps for the next one appears at once.
 * - Corners: the panel is rounded-litt-surface; skeleton blocks are rounded-litt-control (text, covers),
 *   rounded-litt-surface (a card) or rounded-litt-pill (an avatar), concentric as everywhere.
 */
import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { AlertIcon } from "./icons";

/** The panel Empty and ErrorState sit in: a surface-2 fill and a line hairline, no shadow. */
const PANEL = "rounded-litt-surface bg-litt-surface-2 p-8 shadow-[inset_0_0_0_1px_var(--litt-line)]";

/* -------------------------------------------------------------------------- */
/* Empty                                                                      */
/* -------------------------------------------------------------------------- */

export type EmptyProps = HTMLAttributes<HTMLDivElement> & {
  /** Optional short line that says what is empty, such as "No projects yet." Leave it out when the sentence says it all. */
  title?: ReactNode;
  /** The one sentence: what will appear here. */
  children: ReactNode;
  /** The one action that makes it appear, usually a Button. A ghost button needs -ml-litt-control-pad-sm so its label lines up with the text. */
  action?: ReactNode;
  /** Drops the fill, hairline and padding, for a container that already draws its own box. */
  bare?: boolean;
  /** Extra classes for the panel. */
  className?: string;
};

/**
 * What will appear here, and the one action that makes it appear. Left-aligned, no illustration.
 * Pass role="status" when it shows up in answer to something, such as a filter, so it is announced.
 */
export function Empty({ title, children, action, bare = false, className = "", ...rest }: EmptyProps) {
  return (
    <div className={"grid justify-items-start gap-6 " + (bare ? "" : PANEL + " ") + className} {...rest}>
      <div className="grid max-w-(--litt-measure) gap-1">
        {title && <p className="text-litt-body font-litt-title text-litt-fg-muted">{title}</p>}
        <p className={"text-pretty " + (title ? "text-litt-small text-litt-fg-subtle" : "text-litt-body text-litt-fg-muted")}>{children}</p>
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton and Loading                                                       */
/* -------------------------------------------------------------------------- */

export type SkeletonText = "caption" | "small" | "body" | "reading" | "h4" | "h3" | "h2" | "h1";
export type SkeletonRadius = "control" | "cover" | "surface" | "pill";

const TEXT: Record<SkeletonText, string> = {
  caption: "text-litt-caption",
  small: "text-litt-small",
  body: "text-litt-body",
  reading: "text-litt-reading",
  h4: "text-litt-h4",
  h3: "text-litt-h3",
  h2: "text-litt-h2",
  h1: "text-litt-h1",
};

const RADIUS: Record<SkeletonRadius, string> = {
  control: "rounded-litt-control",
  cover: "rounded-[calc(var(--litt-radius-surface)-4px)]",
  surface: "rounded-litt-surface",
  pill: "rounded-litt-pill",
};

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /** Sizes the block as one line of that text style: a bar about as tall as the letters, centred in the line's real height, so a row never changes height when the text arrives. Leave it out for a plain block sized by className. */
  text?: SkeletonText;
  /** The corners: control for text and tags, cover for a cover set 4px into a card (as Card's), surface for a card, pill for an avatar. */
  radius?: SkeletonRadius;
  /** Size it here, to the real content's: w-40, h-10, size-8 or aspect-[8/5]. With text set, it sets the width only. */
  className?: string;
};

/**
 * A placeholder at the real content's dimensions, filled with surface-2. Static, and hidden from
 * screen readers: wrap blocks in Loading to say what is loading.
 */
export function Skeleton({ text, radius = "control", className = "", ...rest }: SkeletonProps) {
  if (text) {
    return (
      <div aria-hidden="true" className={`flex h-lh items-center ${TEXT[text]} ${className}`} {...rest}>
        <div className={`h-[0.75em] w-full bg-litt-surface-2 ${RADIUS[radius]}`} />
      </div>
    );
  }
  return <div aria-hidden="true" className={`bg-litt-surface-2 ${RADIUS[radius]} ${className}`} {...rest} />;
}

export type LoadingProps = HTMLAttributes<HTMLDivElement> & {
  /** What is loading, read to screen readers: "Loading projects". The skeleton blocks stay silent. */
  label?: string;
  /** The Skeleton blocks, laid out as the real content will be. */
  children: ReactNode;
  /** Extra classes for the group, such as the list's box or the grid's columns. */
  className?: string;
};

/** Groups Skeleton blocks and announces its label once as a status. Swap it for the content when it arrives. */
export function Loading({ label = "Loading", children, className = "", ...rest }: LoadingProps) {
  /* The status mounts empty and takes its label a frame later: screen readers often stay silent for a live region
     that arrives with its words already in it. */
  const [said, setSaid] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSaid(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div role="status" className={className} {...rest}>
      <span className="sr-only">{said ? label : ""}</span>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

export type ErrorStateProps = HTMLAttributes<HTMLDivElement> & {
  /** What went wrong, in plain words: "The deploy to atelier-nord.com failed." */
  title: ReactNode;
  /** The cause and how to fix it, in a sentence or two. Give this or an action, so the reader is never left with only the bad news. */
  children?: ReactNode;
  /** The retry or the fix, usually a Button. */
  action?: ReactNode;
  /** Drops the fill, hairline and padding, for a container that already draws its own box. */
  bare?: boolean;
  /** Extra classes for the panel. */
  className?: string;
};

/**
 * What went wrong, then how to fix it or retry. The danger color is on the icon only, and the words
 * say it too. It is a role="alert", so it is announced when it appears; pass role="status" if it is not urgent.
 */
export function ErrorState({ title, children, action, bare = false, className = "", ...rest }: ErrorStateProps) {
  return (
    <div role="alert" className={"flex items-start gap-2 " + (bare ? "" : PANEL + " ") + className} {...rest}>
      {/* The wrapper takes the title's line height, so the 16px icon centres on the first line. */}
      <span className="grid h-lh shrink-0 place-items-center text-litt-body text-litt-danger">
        <AlertIcon />
      </span>
      <div className="grid min-w-0 max-w-(--litt-measure) justify-items-start gap-6">
        <div className="grid gap-1">
          <p className="text-litt-body font-litt-title text-litt-fg">{title}</p>
          {children && <p className="text-pretty text-litt-small text-litt-fg-subtle">{children}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
