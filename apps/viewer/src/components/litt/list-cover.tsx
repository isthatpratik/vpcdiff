"use client";
// @litt/list-cover 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * Project covers: simple abstract compositions of rectangles and hairlines.
 *
 * Token colors only, no gradients: the page already has its one light source
 * (R2), so a cover is drawn, not lit. The artwork is static. The cover's own
 * fill (surface-2, stepping to surface-3 on hover) is set by the card.
 *
 * The viewBox is 320 x 200 and the card's cover is 8:5, so nothing crops.
 * Strokes use non-scaling-stroke so every hairline stays 1px at any size.
 */
import type { ReactNode } from "react";

export type CoverName =
  | "dashboard"
  | "identity"
  | "landing"
  | "template"
  | "type"
  | "motion"
  | "refresh"
  | "system"
  | "blank";

const tone = {
  panel: "fill-litt-surface-1 stroke-litt-line-strong",
  bar: "fill-litt-line-strong",
  soft: "fill-litt-line",
  ink: "fill-litt-fg-subtle",
} as const;
type Tone = keyof typeof tone;

function R({ x, y, w, h, t = "panel" }: { x: number; y: number; w: number; h: number; t?: Tone }) {
  return <rect x={x} y={y} width={w} height={h} className={tone[t]} vectorEffect="non-scaling-stroke" />;
}

function L({ x1, y1, x2, y2, dash }: { x1: number; y1: number; x2: number; y2: number; dash?: string }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className="stroke-litt-line-strong"
      strokeDasharray={dash}
      vectorEffect="non-scaling-stroke"
    />
  );
}

const art: Record<CoverName, ReactNode> = {
  /* A fintech dashboard: sidebar, KPI panels, five bars. */
  dashboard: (
    <>
      <R x={24} y={24} w={272} h={152} />
      <L x1={24} y1={48} x2={296} y2={48} />
      <L x1={88} y1={48} x2={88} y2={176} />
      <R x={36} y={32} w={8} h={8} t="ink" />
      <R x={36} y={64} w={40} h={6} t="bar" />
      <R x={36} y={80} w={28} h={6} t="bar" />
      <R x={36} y={96} w={36} h={6} t="bar" />
      <R x={104} y={60} w={56} h={24} />
      <R x={168} y={60} w={56} h={24} />
      <R x={232} y={60} w={48} h={24} />
      <L x1={104} y1={160} x2={280} y2={160} />
      <R x={112} y={132} w={16} h={28} t="bar" />
      <R x={144} y={116} w={16} h={44} t="bar" />
      <R x={176} y={104} w={16} h={56} t="ink" />
      <R x={208} y={124} w={16} h={36} t="bar" />
      <R x={240} y={112} w={16} h={48} t="bar" />
    </>
  ),
  /* A brand identity: a mark, a tall sheet and two small sheets. */
  identity: (
    <>
      <R x={24} y={24} w={128} h={152} />
      <R x={72} y={72} w={32} h={32} t="ink" />
      <L x1={24} y1={132} x2={152} y2={132} />
      <R x={40} y={144} w={48} h={6} t="bar" />
      <R x={40} y={158} w={28} h={6} t="soft" />
      <R x={168} y={24} w={56} h={152} />
      <R x={176} y={32} w={40} h={6} t="bar" />
      <R x={176} y={44} w={24} h={6} t="soft" />
      <L x1={168} y1={100} x2={224} y2={100} />
      <R x={240} y={24} w={56} h={72} />
      <R x={240} y={104} w={56} h={72} />
    </>
  ),
  /* A landing page: nav, headline, button and an image placeholder. */
  landing: (
    <>
      <R x={24} y={24} w={272} h={152} />
      <L x1={24} y1={48} x2={296} y2={48} />
      <R x={36} y={32} w={8} h={8} t="ink" />
      <R x={232} y={34} w={12} h={4} t="bar" />
      <R x={252} y={34} w={12} h={4} t="bar" />
      <R x={272} y={34} w={12} h={4} t="bar" />
      <R x={48} y={72} w={128} h={12} t="bar" />
      <R x={48} y={92} w={96} h={12} t="bar" />
      <R x={48} y={120} w={80} h={6} t="soft" />
      <R x={48} y={132} w={64} h={6} t="soft" />
      <R x={48} y={148} w={40} h={16} />
      <R x={200} y={64} w={80} h={96} />
      <L x1={200} y1={64} x2={280} y2={160} />
      <L x1={280} y1={64} x2={200} y2={160} />
    </>
  ),
  /* A template: a grid of six page thumbnails. */
  template: (
    <>
      {[24, 116, 208].flatMap((x, col) =>
        [24, 104].map((y, row) => (
          <g key={`${col}-${row}`}>
            <R x={x} y={y} w={88} h={72} />
            <R x={x + 8} y={y + 8} w={40} h={6} t="bar" />
            <R x={x + 8} y={y + 20} w={24} h={6} t="soft" />
            <R x={x + 8} y={y + 40} w={72} h={24} t={col === 1 && row === 0 ? "ink" : "soft"} />
          </g>
        )),
      )}
    </>
  ),
  /* A type specimen: guides, three letterforms, four lines of text. */
  type: (
    <>
      <R x={24} y={24} w={272} h={152} />
      <L x1={24} y1={52} x2={296} y2={52} />
      <L x1={24} y1={84} x2={296} y2={84} />
      <R x={48} y={52} w={20} h={32} t="ink" />
      <R x={80} y={52} w={20} h={32} t="bar" />
      <R x={112} y={52} w={20} h={32} t="bar" />
      <R x={48} y={108} w={224} h={6} t="bar" />
      <R x={48} y={124} w={208} h={6} t="bar" />
      <R x={48} y={140} w={216} h={6} t="bar" />
      <R x={48} y={156} w={120} h={6} t="bar" />
    </>
  ),
  /* A motion study: four panels stepping up a dotted path. */
  motion: (
    <>
      <L x1={32} y1={168} x2={288} y2={32} dash="2 4" />
      <R x={32} y={128} w={64} h={40} t="soft" />
      <R x={96} y={96} w={64} h={40} />
      <R x={160} y={64} w={64} h={40} />
      <R x={224} y={32} w={64} h={40} t="bar" />
    </>
  ),
  /* A refresh: a sparse before beside a structured after. */
  refresh: (
    <>
      <R x={24} y={24} w={128} h={152} />
      <R x={40} y={40} w={72} h={8} t="soft" />
      <R x={40} y={60} w={96} h={8} t="soft" />
      <R x={40} y={80} w={40} h={8} t="soft" />
      <R x={40} y={128} w={56} h={20} t="soft" />
      <R x={168} y={24} w={128} h={152} />
      <R x={184} y={40} w={24} h={24} t="ink" />
      <R x={216} y={40} w={64} h={6} t="bar" />
      <R x={216} y={52} w={40} h={6} t="soft" />
      <R x={184} y={80} w={96} h={40} t="soft" />
      <R x={184} y={132} w={44} h={28} t="bar" />
      <R x={236} y={132} w={44} h={28} t="bar" />
      <L x1={160} y1={16} x2={160} y2={184} />
    </>
  ),
  /* A layout system: four columns with a few filled blocks. */
  system: (
    <>
      <R x={24} y={24} w={272} h={152} />
      <L x1={92} y1={24} x2={92} y2={176} />
      <L x1={160} y1={24} x2={160} y2={176} />
      <L x1={228} y1={24} x2={228} y2={176} />
      <R x={32} y={32} w={52} h={60} t="soft" />
      <R x={100} y={32} w={52} h={28} t="bar" />
      <R x={168} y={68} w={52} h={100} t="soft" />
      <R x={236} y={32} w={52} h={44} t="soft" />
      <R x={236} y={140} w={12} h={12} t="ink" />
    </>
  ),
  /* A new project: an empty dashed frame with a plus. */
  blank: (
    <>
      <rect x={24} y={24} width={272} height={152} className="fill-none stroke-litt-line-strong" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <L x1={152} y1={100} x2={168} y2={100} />
      <L x1={160} y1={92} x2={160} y2={108} />
    </>
  ),
};

/** A drawn cover that fills its parent, which should be relative and 8:5. Decorative, so screen readers skip it. */
export function ProjectCover({
  name,
  className = "",
}: {
  /** Which cover to draw: dashboard, identity, landing, template, type, motion, refresh, system or blank. */
  name: CoverName;
  /** Extra classes for the SVG. */
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      className={"absolute inset-0 size-full " + className}
      aria-hidden="true"
      focusable="false"
    >
      {art[name]}
    </svg>
  );
}
