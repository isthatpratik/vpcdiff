"use client";
// @litt/button 2026.11.02. What changed: https://littmd.vercel.app/changelog.md

/**
 * Button: the reference component. Read this before writing another one.
 *
 * - Slightly rounded, three sizes on the shared control scale (R9). Labels sit in
 *   .litt-trim, so side padding equals the visible air at sm and md. lg runs wider
 *   (--litt-button-pad-lg), so a short label never makes a square block.
 * - The label is at the title weight (R8, font-litt-title). State changes color and fill only; the
 *   box never moves or resizes (loading keeps the label mounted at opacity 0).
 * - Loading is busy, not disabled: the button keeps its variant's look and its focus (a disabled button drops focus
 *   to the page), and a click does nothing, a submit's included, until it ends. It does not sink while it waits.
 * - Material (R3): a secondary button is the press material's raised block (--litt-block, --litt-block-lift), and its cast
 *   tightens while it is pressed (--litt-block-press), at once, never faded (R2). The primary is the accent with its glow
 *   and a top highlight. Ghost lies flat, and so does a disabled button: nothing to push.
 * - Danger (R7): a destructive action is the same raised block with its words in --litt-danger. Inside a dialog's footer
 *   ([data-dialog-footer], matched structurally with Tailwind's in-* variant) it is the confirm of the dialog that
 *   asks, the one red fill: --litt-danger with --litt-danger-fg words and the primary's lit top edge, with no cast and no glow
 *   (the glow is the primary's, R6). Until the dialog's condition is met it is disabled, so it lies flat like any
 *   disabled button.
 * - Motion: the instant tier. Hover is a CSS transition on --litt-dur-instant, which tokens.css owns. A press sinks the
 *   block --litt-press-depth (half a pixel, R4) rather than shrinking it. Tailwind's active:translate-y-* sets the CSS
 *   `translate` property, not `transform`, so the transition names `translate`; naming `transform` instead would
 *   let the press snap.
 * - Touch: a pressed button also takes its hover fill, so a press still shows under reduced motion (which sets the
 *   depth to 0). The OS tap flash is turned off so the two do not double. Rows and segments fill (see Tabs, List).
 * - Children: one child is the label, trimmed to its cap height. An icon and a word
 *   (`<Button><PlusIcon /> New</Button>`, as shadcn writes it) sit side by side: each
 *   run of text is a trimmed label, and each element sits in the row. A child SVG is
 *   16px, like every button icon. The icon prop is still the documented way.
 * - Fun mode (motion/fun.tsx, a trial, off unless a <FunMode> is on): the press goes deeper (1px) and the sink moves
 *   on fun mode's press spring, as a CSS linear() easing, so the release springs back with a little life. Only the
 *   sink's timing changes; fills keep the instant tier. Still CSS, no script per press. Reduced motion turns it off.
 * - Disabled keeps a hairline, so the button keeps its shape on a surface-2 area.
 * - Corners: rounded-litt-control (4px in litt.md v0.5). Icon-only buttons are
 *   round (pill) and need an aria-label.
 */
import { Children, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { useFun } from "../../lib/litt/motion";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Primary is the one accent fill in a view. Secondary is the default. Ghost is for quiet actions like Cancel. Danger is a destructive action, a block with red words; in a dialog's footer it is the confirm, filled red once it is enabled. */
  variant?: ButtonVariant;
  /** Height on the shared control scale: sm is 32, md is 44, lg is 56. Use lg for hero actions only, md in a page form and a dialog. */
  size?: ButtonSize;
  /** Swaps the label for a spinner and keeps the width. The button stays focusable and keeps its look, sets aria-busy and aria-disabled, and ignores clicks (a submit's too) until loading ends. */
  loading?: boolean;
  /** 16px icon before the label. */
  icon?: ReactNode;
  /** 16px icon after the label. */
  iconRight?: ReactNode;
  /** Round icon-only button. Requires aria-label. */
  iconOnly?: boolean;
  /** Fills the width of its container. */
  block?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

const base =
  "relative inline-flex shrink-0 items-center justify-center gap-litt-control whitespace-nowrap select-none font-litt-title " +
  "cursor-pointer transition-[background-color,color,translate] duration-(--litt-dur-instant) ease-litt " +
  "[-webkit-tap-highlight-color:transparent] " +
  "active:translate-y-(--litt-press-depth) disabled:cursor-not-allowed disabled:active:translate-y-0 " +
  "data-loading:cursor-wait data-loading:active:translate-y-0 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus";

const sizes: Record<ButtonSize, string> = {
  sm: "h-litt-control-sm px-litt-control-pad-sm text-litt-small",
  md: "h-litt-control-md px-litt-control-pad-md text-litt-body",
  lg: "h-litt-control-lg px-litt-button-pad-lg text-(length:--litt-control-text-lg)",
};
const iconSizes: Record<ButtonSize, string> = { sm: "w-litt-control-sm", md: "w-litt-control-md", lg: "w-litt-control-lg" };

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-litt-accent text-litt-accent-fg hover:bg-litt-accent-hover enabled:pointer-coarse:active:bg-litt-accent-hover shadow-litt-glow " +
    "inset-shadow-[0_1px_0_color-mix(in_oklab,white_22%,transparent)] " +
    /* Flat has no light (R2): under data-material="flat" the fill catches no top highlight. */
    "in-[[data-material=flat]]:inset-shadow-none",
  secondary:
    "bg-litt-block text-litt-fg shadow-(--litt-block-lift) enabled:not-data-loading:active:shadow-(--litt-block-press) forced-colors:border " +
    "hover:bg-(--litt-block-hover) enabled:pointer-coarse:active:bg-(--litt-block-hover)",
  ghost:
    "bg-transparent text-litt-fg-muted hover:text-litt-fg hover:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)] " +
    "enabled:pointer-coarse:active:text-litt-fg enabled:pointer-coarse:active:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)]",
  danger:
    "bg-litt-block text-litt-danger shadow-(--litt-block-lift) enabled:not-data-loading:active:shadow-(--litt-block-press) forced-colors:border " +
    "hover:bg-(--litt-block-hover) enabled:pointer-coarse:active:bg-(--litt-block-hover) " +
    /* A dialog's confirm. These rules sort after the block's, so they win its ties (active, a finger's press). */
    "in-[[data-dialog-footer]]:enabled:bg-litt-danger in-[[data-dialog-footer]]:enabled:text-litt-danger-fg " +
    "in-[[data-dialog-footer]]:enabled:shadow-none in-[[data-dialog-footer]]:enabled:active:shadow-none " +
    "in-[[data-dialog-footer]]:enabled:inset-shadow-[0_1px_0_color-mix(in_oklab,white_22%,transparent)] " +
    "in-[[data-material=flat]]:in-[[data-dialog-footer]]:enabled:inset-shadow-none " +
    "in-[[data-dialog-footer]]:enabled:hover:bg-[color-mix(in_oklab,var(--litt-danger),var(--litt-fg)_10%)] " +
    "in-[[data-dialog-footer]]:enabled:pointer-coarse:active:bg-[color-mix(in_oklab,var(--litt-danger),var(--litt-fg)_10%)]",
};
const disabledLook =
  "disabled:bg-litt-surface-2 disabled:text-litt-fg-disabled disabled:shadow-[inset_0_0_0_1px_var(--litt-line)] disabled:inset-shadow-none";

/* One child is the label. Several (an icon and a word) sit in the row: text runs are trimmed labels, elements sit as they are. */
function label(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  if (parts.length < 2) return parts.length ? <span className="litt-trim">{children}</span> : null;
  const out: ReactNode[] = [];
  let text = "";
  const flush = () => {
    const t = text.trim();
    if (t) out.push(<span key={`label-${out.length}`} className="litt-trim">{t}</span>);
    text = "";
  };
  for (const part of parts) {
    if (typeof part === "string" || typeof part === "number") text += part;
    else { flush(); out.push(part); }
  }
  flush();
  return out;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  iconOnly = false,
  block = false,
  className = "",
  children,
  disabled,
  type = "button",
  style,
  onClick,
  ...rest
}: ButtonProps) {
  const fun = useFun();
  const shape = iconOnly ? `${iconSizes[size]} px-0 rounded-litt-pill` : "rounded-litt-control";
  /* Fun mode: the sink (the third transitioned property) takes the press spring and goes deeper; the fills keep the instant tier. */
  const press: CSSProperties | undefined = fun
    ? ({
        "--litt-press-depth": "1px",
        transitionDuration: `var(--litt-dur-instant), var(--litt-dur-instant), ${fun.press.duration}ms`,
        transitionTimingFunction: `var(--litt-ease-out), var(--litt-ease-out), ${fun.press.easing}`,
      } as CSSProperties)
    : undefined;
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading || undefined}
      className={[base, sizes[size], variants[variant], disabledLook, shape, block ? "w-full" : "", className].join(" ")}
      style={press ? { ...press, ...style } : style}
      {...rest}
      onClick={loading ? (e) => e.preventDefault() : onClick}
    >
      <span
        className={
          "inline-flex items-center gap-litt-control transition-opacity duration-(--litt-dur-instant) ease-litt " +
          "[&>svg]:size-4 [&>svg]:shrink-0 " +
          (loading ? "opacity-0" : "opacity-100")
        }
      >
        {icon}
        {!iconOnly && label(children)}
        {iconOnly && children}
        {iconRight}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
          <Spinner />
        </span>
      )}
    </button>
  );
}

/* vpcdiff patch: a link that looks like a Button, for calls to action that navigate.
   It reuses the same class maps so the two never drift apart. */
export type LinkButtonProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export function LinkButton({ variant = "secondary", size = "md", icon, iconRight, className = "", children, ...rest }: LinkButtonProps) {
  return (
    <a className={[base, sizes[size], variants[variant], "rounded-litt-control no-underline", className].join(" ")} {...rest}>
      <span className="inline-flex items-center gap-litt-control [&>svg]:size-4 [&>svg]:shrink-0">
        {icon}
        {label(children)}
        {iconRight}
      </span>
    </a>
  );
}

/** 16px spinner, 1.5px stroke, currentColor. The rotation is a loading signal, not decoration. */
export function Spinner({
  size = 16,
}: {
  /** Width and height in px. */
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="animate-spin" /* litt-allow: spinner */>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
