"use client";
// @litt/kbd 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * Kbd: the key cap for a real shortcut (⌘K, ↵, esc). Never decoration.
 *
 * - One cap everywhere: a 20px box at rounded-litt-control, Geist at weight 400 in
 *   fg-subtle. A <kbd> is mono by default, so the cap sets font-sans. The
 *   tooltip, the command menu footer, the button hint and the tabs legend all
 *   render this component and nothing else.
 * - Material (R3, material.md 6): a key cap is the smallest raised block
 *   (--litt-block, --litt-key-lift: the block's lift with a darker lower edge), so it
 *   reads as a key and not a tag. That edge is a shade, never light, so it
 *   stays dark in both themes (R2). It keeps a border in forced colors.
 * - The size is the caption step (12px), on the type scale like every other label.
 * - shrink-0 so it never squashes in a flex row; min-w-5 keeps a lone glyph square.
 * - Static: no motion and no states. It is a real <kbd>, so whether a hint is
 *   hidden from screen readers is the caller's call.
 */
import type { ReactNode } from "react";

const chip =
  "inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-litt-control bg-litt-block px-1 " +
  "font-litt-sans font-normal text-litt-caption text-litt-fg-subtle shadow-(--litt-key-lift) forced-colors:border";

/** One key cap, or one chord written in glyphs, such as ⇧⌘C. Keys pressed one after another each get their own Kbd, 4px apart. */
export function Kbd({
  children,
}: {
  /** The key as people read it: a glyph (⌘, ↵, ⌫, ←), a chord of glyphs (⇧⌘C) or a short word (esc, tab). */
  children: ReactNode;
}) {
  return <kbd className={chip}>{children}</kbd>;
}
