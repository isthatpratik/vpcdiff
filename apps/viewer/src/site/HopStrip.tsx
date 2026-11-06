// Four cells, one per thing the engine reads, each with a small line drawing of how AWS
// decides it (after the feature strip on unkey.com). Static drawings in ink: the one
// thing that decides the answer is filled, the rest is outline or hatch.
import type { ReactNode } from "react";

const MONO = "var(--litt-font-mono)";
const INK = "var(--litt-fg)";
const SUB = "var(--litt-fg-subtle)";
const CANVAS = "var(--litt-canvas)";

function Lines() {
  return (
    <g stroke={INK} strokeOpacity={0.08}>
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={0} x2={400} y1={20 + i * 26} y2={20 + i * 26} />
      ))}
    </g>
  );
}

function Box({ x, y, label, solid = false }: { x: number; y: number; label: string; solid?: boolean }) {
  const w = label.length * 8 + 20;
  return (
    <g>
      <rect x={x} y={y - 13} width={w} height={26} fill={solid ? INK : CANVAS} stroke={INK} strokeOpacity={solid ? 1 : 0.4} />
      <text x={x + 10} y={y + 5} fontFamily={MONO} fontSize={13} fill={solid ? CANVAS : INK}>
        {label}
      </text>
    </g>
  );
}

/** Route tables: the most specific route wins. */
function Routes() {
  return (
    <svg viewBox="0 0 400 240" className="w-full" aria-hidden="true">
      <Lines />
      <g fill="none" stroke={INK} strokeOpacity={0.45}>
        <path d="M110 124 H150 Q160 124 160 114 V70 Q160 60 170 60 H200" />
        <path d="M110 124 H200" />
        <path d="M110 124 H150 Q160 124 160 134 V178 Q160 188 170 188 H200" />
      </g>
      <path d="M110 124 H150 Q160 124 160 134 V178 Q160 188 170 188 H200" fill="none" stroke={INK} strokeWidth={1.5} />
      <Box x={14} y={124} label="dst" solid />
      {[
        [160, 60],
        [110, 124],
        [160, 188],
      ].map(([x = 0, y = 0], i) => (
        <rect key={i} x={x - 3} y={y - 3} width={6} height={6} fill={INK} opacity={i === 2 ? 1 : 0.5} />
      ))}
      <Box x={200} y={60} label="10.0.0.0/16 local" />
      <Box x={200} y={124} label="10.0.1.0/24 nat" />
      <Box x={200} y={188} label="0.0.0.0/0 igw" solid />
      <text x={14} y={226} fontFamily={MONO} fontSize={12} fill={SUB}>
        dst 52.14.9.20 → longest match
      </text>
    </svg>
  );
}

/** Security groups: every rule of every group on the resource, joined. */
function Groups() {
  const rows = [
    ["tcp", "443", "0.0.0.0/0", "allow"],
    ["tcp", "22", "10.0.0.0/16", "allow"],
    ["tcp", "5432", "0.0.0.0/0", "new"],
    ["tcp", "5432", "10.0.0.0/16", "allow"],
    ["udp", "53", "10.0.0.0/16", "allow"],
  ];
  return (
    <svg viewBox="0 0 400 240" className="w-full" aria-hidden="true">
      <line x1={0} x2={400} y1={22} y2={22} stroke={INK} strokeOpacity={0.2} />
      {rows.map((r, i) => {
        const y = 52 + i * 38;
        const hi = r[3] === "new";
        return (
          <g key={i}>
            {hi && <rect x={0} y={y - 22} width={400} height={34} fill={INK} />}
            {r.map((c, j) => (
              <text key={j} x={[12, 70, 140, 330][j]} y={y} fontFamily={MONO} fontSize={14} fill={hi ? CANVAS : INK} opacity={hi ? 1 : 0.55}>
                {c}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Network ACLs: rules in number order, first match decides, both directions. */
function Acls() {
  return (
    <svg viewBox="0 0 400 240" className="w-full" aria-hidden="true">
      <rect x={70} y={20} width={260} height={200} fill="none" stroke={INK} strokeOpacity={0.15} />
      <rect x={110} y={50} width={180} height={140} fill="none" stroke={INK} strokeOpacity={0.3} />
      <rect x={150} y={80} width={100} height={80} fill="none" stroke={INK} strokeOpacity={0.55} />
      <rect x={183} y={103} width={34} height={34} fill={INK} />
      {[
        [70, 20],
        [330, 220],
      ].map(([x = 0, y = 0], i) => (
        <rect key={i} x={x - 7} y={y - 7} width={14} height={14} fill={CANVAS} stroke={INK} strokeOpacity={0.6} />
      ))}
      <g fontFamily={MONO} fontSize={12} fill={SUB}>
        <text x={78} y={40}>
          * deny
        </text>
        <text x={118} y={70}>
          200 deny
        </text>
        <text x={158} y={98} fill={INK}>
          100 allow
        </text>
      </g>
    </svg>
  );
}

/** Before and after: one bar per path, the new one drawn solid. */
function BeforeAfter() {
  const bars = [0.42, 0.66, 0.54, 1, 0.62, 0.34];
  return (
    <svg viewBox="0 0 400 240" className="w-full" aria-hidden="true">
      <defs>
        <pattern id="hop-hatch" width={6} height={4} patternUnits="userSpaceOnUse">
          <line x1={0} x2={6} y1={0.5} y2={0.5} stroke={INK} strokeOpacity={0.45} />
        </pattern>
      </defs>
      {bars.map((h, i) => {
        const x = 30 + i * 60;
        const hh = h * 170;
        return <rect key={i} x={x} y={200 - hh} width={34} height={hh} fill={i === 3 ? INK : "url(#hop-hatch)"} />;
      })}
      <polyline points={bars.map((h, i) => `${47 + i * 60},${200 - h * 120}`).join(" ")} fill="none" stroke={INK} strokeOpacity={0.6} />
      {bars.map((h, i) => (
        <rect key={i} x={44 + i * 60} y={197 - h * 120} width={6} height={6} fill={i === 3 ? CANVAS : INK} stroke={INK} />
      ))}
      <line x1={0} x2={400} y1={200} y2={200} stroke={INK} strokeOpacity={0.2} />
      <g fontFamily={MONO} fontSize={12} fill={SUB}>
        {["igw", "nacl", "sg", "new", "out", "rtb"].map((t, i) => (
          <text key={t} x={47 + i * 60} y={224} textAnchor="middle" fill={i === 3 ? INK : SUB}>
            {t}
          </text>
        ))}
      </g>
    </svg>
  );
}

const CELLS: { label: string; lead: string; body: string; art: () => ReactNode }[] = [
  { label: "Route tables", lead: "Longest prefix wins.", body: "Each table is read the way AWS reads it: the most specific route decides where traffic goes.", art: Routes },
  { label: "Security groups", lead: "Every rule, every group.", body: "All groups on a resource are joined before a path is judged, as AWS does.", art: Groups },
  { label: "Network ACLs", lead: "First match decides.", body: "Rules run in number order, inbound and again for the reply on ephemeral ports.", art: Acls },
  { label: "Before and after", lead: "One answer per path.", body: "Reachable, blocked, or unknown, on both sides of the plan, with the hop that changed.", art: BeforeAfter },
];

export function HopStrip() {
  return (
    <div className="grid gap-px border-t border-litt-line bg-litt-line sm:grid-cols-2 lg:grid-cols-4">
      {CELLS.map((c) => (
        <article key={c.label} className="grid content-between gap-8 bg-litt-canvas px-6 py-8 md:px-8 md:py-10">
          <div className="grid gap-6">
            <h3 className="font-litt-mono text-litt-caption text-litt-fg-subtle">{c.label}</h3>
            <c.art />
          </div>
          <p className="text-base leading-relaxed text-litt-fg-muted">
            <span className="text-litt-fg">{c.lead}</span> {c.body}
          </p>
        </article>
      ))}
    </div>
  );
}
