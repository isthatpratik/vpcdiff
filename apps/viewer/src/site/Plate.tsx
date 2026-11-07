// A plate: the ground a product panel sits on, after unkey.com's gateway section. A
// surface step with a faint dot grid that fades toward the panel. The panel inside is
// offset from the top left and runs off the right and bottom edges, so it reads as a
// crop of a real screen.
import type { ReactNode } from "react";

export function Plate({ children, className = "", inset = "pt-12 pl-12 sm:pt-16 sm:pl-16" }: { children: ReactNode; className?: string; inset?: string }) {
  return (
    <div className={`relative isolate overflow-hidden bg-litt-surface-1 ${className}`}>
      <div aria-hidden="true" className="absolute inset-0 -z-10 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_26%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_35%,black,transparent_85%)]" />
      <div className={inset}>{children}</div>
    </div>
  );
}

/**
 * The one window style for panels on a plate (the "How it works" panels and the CLI
 * terminal): a rounded top-left corner (the other corners run off the plate), a soft
 * outline with a lit top edge, a deep shadow, quiet window dots, and a mono title.
 */
export const WINDOW = "rounded-tl-[10px] bg-litt-canvas shadow-(--mock-shadow-window)";

export function WindowBar({ title }: { title: string }) {
  return (
    <div className="flex h-9 items-center gap-1.5 border-b border-litt-line px-4">
      <span aria-hidden="true" className="size-2.5 rounded-full bg-litt-fg/15" />
      <span aria-hidden="true" className="size-2.5 rounded-full bg-litt-fg/15" />
      <span aria-hidden="true" className="size-2.5 rounded-full bg-litt-fg/15" />
      <span className="ml-3 font-litt-mono text-litt-caption text-litt-fg-subtle">{title}</span>
    </div>
  );
}

export function PanelWindow({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`${WINDOW} ${className}`}>
      <WindowBar title={title} />
      {children}
    </div>
  );
}
