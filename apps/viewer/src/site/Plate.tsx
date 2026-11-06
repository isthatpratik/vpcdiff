// A plate: the ground a product panel sits on, after unkey.com's gateway section. A
// surface step with a faint dot grid that fades toward the panel. The panel inside is
// offset from the top left and runs off the right and bottom edges, so it reads as a
// crop of a real screen.
import type { ReactNode } from "react";

export function Plate({ children, className = "", inset = "pt-12 pl-12 sm:pt-16 sm:pl-16" }: { children: ReactNode; className?: string; inset?: string }) {
  return (
    <div className={`relative isolate overflow-hidden bg-litt-surface-1 ${className}`}>
      <div aria-hidden="true" className="absolute inset-0 -z-10 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_26%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:linear-gradient(135deg,black,transparent_75%)]" />
      <div className={inset}>{children}</div>
    </div>
  );
}

/** A plain window for panels on a plate: a title bar with three quiet dots, then content. */
export function PanelWindow({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`border-t border-l border-litt-line-strong bg-litt-surface-1 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] ${className}`}>
      <div className="flex h-10 items-center gap-3 border-b border-litt-line px-4">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-litt-line-strong" />
          <span className="size-2.5 rounded-full bg-litt-line-strong" />
          <span className="size-2.5 rounded-full bg-litt-line-strong" />
        </span>
        <span className="font-litt-mono text-litt-caption text-litt-fg-subtle">{title}</span>
      </div>
      {children}
    </div>
  );
}
