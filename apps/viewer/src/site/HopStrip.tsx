// Four cells, one per thing the engine reads, each with a small line drawing of how AWS
// decides it (after the feature strip on unkey.com). Static drawings in ink: the one
// thing that decides the answer is filled, the rest is outline. Labels are drawn at 18
// units so they render at about 12px in a 270px column.
import type { ReactNode } from "react";

const MONO = "var(--litt-font-mono)";
const INK = "var(--litt-fg)";
const SUB = "var(--litt-fg-subtle)";
const CANVAS = "var(--litt-canvas)";

const FS = 18; // label size in drawing units; the drawings render at ~0.68x, so about 12px

function Box({ x, y, label, solid = false, dim = false }: { x: number; y: number; label: string; solid?: boolean; dim?: boolean }) {
  const w = label.length * 10.8 + 22;
  return (
    <g opacity={dim ? 0.55 : 1}>
      <rect x={x} y={y - 17} width={w} height={34} fill={solid ? INK : CANVAS} stroke={INK} strokeOpacity={solid ? 1 : 0.45} />
      <text x={x + 11} y={y + 6} fontFamily={MONO} fontSize={FS} fill={solid ? CANVAS : INK}>
        {label}
      </text>
    </g>
  );
}

/** Route tables: the packet takes the most specific route that matches it. */
function Routes() {
  return (
    <svg viewBox="0 0 400 230" className="w-full" aria-hidden="true">
      <g fill="none" stroke={INK} strokeOpacity={0.3}>
        <path d="M134 115 H150 Q162 115 162 103 V47 Q162 35 174 35 H190" />
        <path d="M134 115 H190" />
      </g>
      <path d="M134 115 H150 Q162 115 162 127 V183 Q162 195 174 195 H190" fill="none" stroke={INK} strokeWidth={2} />
      {/* Traffic flows along the route that won. */}
      <path d="M134 115 H150 Q162 115 162 127 V183 Q162 195 174 195 H190" fill="none" stroke={CANVAS} strokeWidth={2} strokeDasharray="4 10" className="motion-safe:animate-[route-flow_1.2s_linear_infinite] motion-reduce:hidden" />
      <Box x={4} y={115} label="52.14.9.20" solid />
      <Box x={190} y={35} label="10.0.0.0/16" dim />
      <Box x={190} y={115} label="10.0.1.0/24" dim />
      <Box x={190} y={195} label="0.0.0.0/0 igw" solid />
      <g fontFamily={MONO} fontSize={16} fill={SUB}>
        <text x={190} y={72}>no match</text>
        <text x={190} y={152}>no match</text>
      </g>
    </svg>
  );
}

/** Security groups: every rule of every group on the resource, joined. */
function Groups() {
  const rows = [
    ["443", "0.0.0.0/0", "allow"],
    ["22", "10.0.0.0/16", "allow"],
    ["5432", "0.0.0.0/0", "new"],
    ["5432", "10.0.0.0/16", "allow"],
  ];
  const X = [10, 92, 316];
  return (
    <svg viewBox="0 0 400 230" className="w-full" aria-hidden="true">
      <defs>
        <linearGradient id="sg-shine" x1="0" x2="1">
          <stop offset="0" stopColor={CANVAS} stopOpacity={0} />
          <stop offset="0.5" stopColor={CANVAS} stopOpacity={0.18} />
          <stop offset="1" stopColor={CANVAS} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g fontFamily={MONO} fontSize={16} fill={SUB}>
        {["port", "from", "rule"].map((h, j) => (
          <text key={h} x={X[j]} y={22}>
            {h}
          </text>
        ))}
      </g>
      <line x1={0} x2={400} y1={36} y2={36} stroke={INK} strokeOpacity={0.2} />
      {rows.map((r, i) => {
        const y = 76 + i * 44;
        const hi = r[2] === "new";
        return (
          <g key={i}>
            {hi && <rect x={0} y={y - 27} width={400} height={40} fill={INK} />}
            {hi && (
              <g clipPath="url(#sg-row)">
                <clipPath id="sg-row">
                  <rect x={0} y={y - 27} width={400} height={40} />
                </clipPath>
                <rect x={-120} y={y - 27} width={120} height={40} fill="url(#sg-shine)" className="motion-safe:animate-[row-shine_3.6s_cubic-bezier(0.65,0,0.35,1)_infinite] motion-reduce:hidden" />
              </g>
            )}
            {r.map((c, j) => (
              <text key={j} x={X[j]} y={y} fontFamily={MONO} fontSize={FS} fill={hi ? CANVAS : INK} opacity={hi ? 1 : 0.6}>
                {c}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Network ACLs: rules in number order; the first one that matches decides. */
function Acls() {
  const rules = [
    ["100", "allow 5432", true],
    ["200", "deny all", false],
    ["*", "deny all", false],
  ] as const;
  return (
    <svg viewBox="0 0 400 230" className="w-full" aria-hidden="true">
      {rules.map(([n, what, hit], i) => {
        const y = 40 + i * 70;
        return (
          <g key={n}>
            <rect x={4} y={y - 22} width={392} height={44} fill={hit ? INK : CANVAS} stroke={INK} strokeOpacity={hit ? 1 : 0.3} />
            <text x={20} y={y + 6} fontFamily={MONO} fontSize={FS} fill={hit ? CANVAS : INK} opacity={hit ? 1 : 0.55}>
              {n.padEnd(5, " ")}
              {what}
            </text>
            <text x={380} y={y + 6} textAnchor="end" fontFamily={MONO} fontSize={16} fill={hit ? CANVAS : SUB}>
              {hit ? "first match" : "not read"}
            </text>
          </g>
        );
      })}
      {/* The first match sends out a soft ring: this rule decided. */}
      <rect x={4} y={18} width={392} height={44} fill="none" stroke={INK} className="origin-center [transform-box:fill-box] opacity-0 motion-safe:animate-[rule-ring_2.8s_cubic-bezier(0.22,1,0.36,1)_infinite] motion-reduce:hidden" />
      <path d="M200 62 V88 M200 132 V158" stroke={INK} strokeOpacity={0.25} strokeDasharray="3 4" />
    </svg>
  );
}

/** Before and after: the same path, hop by hop, on each side of the plan. */
function BeforeAfter() {
  const hops = ["ip", "igw", "nacl", "sg", "out", "rtb"];
  const before = [true, true, true, false, null, null]; // null: not reached
  const x = (i: number) => 92 + i * 52;
  const lane = (y: number, cells: (boolean | null)[]) =>
    cells.map((c, i) => (
      <rect key={i} x={x(i) - 9} y={y - 9} width={18} height={18} fill={c ? INK : CANVAS} stroke={INK} strokeOpacity={c === null ? 0.25 : 1} strokeDasharray={c === null ? "3 3" : undefined} />
    ));
  return (
    <svg viewBox="0 0 400 230" className="w-full" aria-hidden="true">
      <rect x={x(3) - 22} y={18} width={44} height={150} fill={INK} opacity={0.08} className="motion-safe:animate-[band-breathe_3.2s_ease-in-out_infinite]" />
      <g fontFamily={MONO} fontSize={16} fill={SUB}>
        <text x={4} y={66}>before</text>
        <text x={4} y={136}>after</text>
      </g>
      <line x1={x(0)} x2={x(5)} y1={61} y2={61} stroke={INK} strokeOpacity={0.25} />
      <line x1={x(0)} x2={x(5)} y1={131} y2={131} stroke={INK} strokeOpacity={0.6} />
      {lane(61, before)}
      {lane(131, [true, true, true, true, true, true])}
      {/* A packet makes it all the way through on the after side. */}
      <g className="motion-safe:animate-[lane-packet_3.2s_cubic-bezier(0.65,0,0.35,1)_infinite] motion-reduce:hidden" style={{ ["--lane" as string]: `${x(5) - x(0)}px` }}>
        <circle cx={x(0)} cy={131} r={4} fill={CANVAS} stroke={INK} strokeWidth={1.5} />
      </g>
      <g fontFamily={MONO} fontSize={16} textAnchor="middle">
        {hops.map((h, i) => (
          <text key={h} x={x(i)} y={196} fill={i === 3 ? INK : SUB}>
            {h}
          </text>
        ))}
      </g>
      <text x={x(3)} y={222} textAnchor="middle" fontFamily={MONO} fontSize={16} fill={INK}>
        changed
      </text>
    </svg>
  );
}

const CELLS: { label: string; lead: string; body: string; art: () => ReactNode }[] = [
  { label: "Route tables", lead: "The most specific route wins.", body: "vpcdiff follows the route the cloud would pick.", art: Routes },
  { label: "Security groups", lead: "Every rule counts.", body: "All groups on the resource are checked together, as the cloud does.", art: Groups },
  { label: "Network ACLs", lead: "The first match decides.", body: "Rules run in order, in and out. Azure and Google Cloud run them by priority.", art: Acls },
  { label: "Before and after", lead: "Both sides of the plan.", body: "Each path is checked twice, and the hop that changed is shown.", art: BeforeAfter },
];

export function HopStrip() {
  return (
    <div className="grid gap-px border-t border-litt-line bg-litt-line sm:grid-cols-2 lg:grid-cols-4">
      {CELLS.map((c) => (
        <article key={c.label} className="grid content-start gap-8 bg-litt-canvas px-6 py-8 md:px-8 md:py-10">
          <div className="grid gap-6">
            <h3 className="font-litt-mono text-litt-caption text-litt-fg-subtle">{c.label}</h3>
            <c.art />
          </div>
          <p className="text-base leading-relaxed text-litt-fg-muted text-pretty">
            <span className="text-litt-fg">{c.lead}</span> {c.body}
          </p>
        </article>
      ))}
    </div>
  );
}
