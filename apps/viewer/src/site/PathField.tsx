// The hero visual: a field of square dots, one per address, densest where the network
// is. A plan widens one rule (the caption at the top is the cause); one path then draws
// from the internet, hop by hop, to the database. The rule goes back and the path
// retracts, so the loop ends on its first frame. Monochrome: ink on the canvas.
import { useEffect, useMemo, useRef, useState } from "react";

const W = 1200;
const H = 560;
const STEP = 48;
const at = (c: number, r: number) => ({ x: 24 + STEP * c, y: 24 + STEP * r });

type Hop = { c: number; r: number; label: string; detail: string; below?: boolean };
const HOPS: Hop[] = [
  { c: 6, r: 3, label: "internet", detail: "any public address", below: true },
  { c: 9, r: 2, label: "internet gateway", detail: "igw.main" },
  { c: 12, r: 4, label: "network ACL", detail: "allows 5432", below: true },
  { c: 15, r: 3, label: "security group", detail: "0.0.0.0/0 on 5432" },
  { c: 18, r: 5, label: "aws_instance.db", detail: "reachable · tcp/5432" },
];
const SOURCES: [number, number][] = [
  [2, 1],
  [4, 1],
  [1, 3],
  [3, 4],
  [1, 6],
  [3, 7],
];
const FOCUS = { x: 700, y: 230 };

/** step: 0 rule narrow, 1 rule widened, 2..6 hops lit (2 = internet), 7 settled. */
const TIMES = [1600, 900, 520, 520, 520, 700, 520, 3600];

export function PathField({ className = "" }: { className?: string }) {
  const [step, setStep] = useState(0);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStep(7);
    let timer = 0;
    let visible = false;
    let s = 0;
    const tick = () => {
      if (!visible) return;
      s = (s + 1) % TIMES.length;
      setStep(s);
      timer = window.setTimeout(tick, TIMES[s]);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      window.clearTimeout(timer);
      if (visible) timer = window.setTimeout(tick, TIMES[s]);
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const dots = useMemo(() => {
    const out: { x: number; y: number; s: number; o: number }[] = [];
    for (let c = 0; c < W / STEP; c++) {
      for (let r = 0; r < H / STEP; r++) {
        const { x, y } = at(c, r);
        const d = Math.hypot(x - FOCUS.x, (y - FOCUS.y) * 1.3);
        const s = Math.min(7, 9 - d / 70);
        if (s < 1.2) continue;
        out.push({ x, y, s, o: Math.max(0.1, 1 - d / 640) });
      }
    }
    return out;
  }, []);

  const lit = (i: number) => step >= i + 2;
  const widened = step >= 1;
  const pts = HOPS.map((h) => at(h.c, h.r));
  const origin = at(HOPS[0]?.c ?? 0, HOPS[0]?.r ?? 0);

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMin slice" className={`block h-full w-full ${className}`} aria-hidden="true">
      <style>{`@media (max-width: 640px) { .pf-text { display: none } }`}</style>
      {dots.map((d) => (
        <rect key={`${d.x}-${d.y}`} x={d.x - d.s / 2} y={d.y - d.s / 2} width={d.s} height={d.s} fill="var(--litt-fg)" opacity={d.o * 0.42} />
      ))}

      {/* Any public address: faint spokes into the internet node. */}
      {SOURCES.map(([c, r]) => {
        const a = at(c, r);
        return (
          <g key={`${c}-${r}`} opacity={0.22}>
            <line x1={a.x} y1={a.y} x2={origin.x} y2={origin.y} stroke="var(--litt-fg)" strokeWidth={1} />
            <rect x={a.x - 3} y={a.y - 3} width={6} height={6} fill="var(--litt-fg)" />
          </g>
        );
      })}

      {/* The path, one segment per hop. */}
      {pts.slice(1).map((b, i) => {
        const a = pts[i] ?? b;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={lit(i + 1) ? 0 : 1}
            stroke="var(--litt-fg)"
            strokeWidth={1.5}
            style={{ transition: `stroke-dashoffset ${lit(i + 1) ? 480 : 600}ms cubic-bezier(0.22,1,0.36,1)` }}
          />
        );
      })}

      {HOPS.map((h, i) => {
        const p = pts[i] ?? origin;
        const on = lit(i);
        const last = i === HOPS.length - 1;
        const size = last ? 22 : 14;
        return (
          <g key={h.label}>
            {last && <rect x={p.x - 22} y={p.y - 22} width={44} height={44} fill="none" stroke="var(--litt-fg)" strokeWidth={1} opacity={step === 7 ? 0.35 : 0} style={{ transition: "opacity 600ms" }} />}
            <rect
              x={p.x - size / 2}
              y={p.y - size / 2}
              width={size}
              height={size}
              fill={on ? "var(--litt-fg)" : "var(--litt-canvas)"}
              stroke="var(--litt-fg)"
              strokeOpacity={on ? 1 : 0.45}
              style={{ transition: "fill 300ms" }}
            />
            <g className="pf-text" fillOpacity={on ? 1 : 0.32} style={{ transition: "fill-opacity 400ms" }}>
              <text x={p.x + (last ? 34 : 18)} y={h.below ? p.y + 30 : p.y - 14} fill="var(--litt-fg)" fontFamily="var(--litt-font-mono)" fontSize={last ? 17 : 14} stroke="var(--litt-canvas)" strokeWidth={8} paintOrder="stroke">
                {h.label}
              </text>
              <text x={p.x + (last ? 34 : 18)} y={h.below ? p.y + 50 : p.y + 6} fill="var(--litt-fg-subtle)" fontFamily="var(--litt-font-mono)" fontSize={12.5} stroke="var(--litt-canvas)" strokeWidth={8} paintOrder="stroke">
                {h.detail}
              </text>
            </g>
          </g>
        );
      })}

      {/* The cause: the plan's one-line change, at the top right. */}
      <g className="pf-text">
      <rect x={W - 460} y={28} width={440} height={64} fill="var(--litt-canvas)" />
      <g transform={`translate(${W - 40} 52)`} fontFamily="var(--litt-font-mono)" textAnchor="end">
        <text fontSize={13} fill="var(--litt-fg-subtle)">
          plan · aws_security_group.db · ingress 5432
        </text>
        <text y={26} fontSize={15} fill="var(--litt-fg)">
          cidr_blocks = [
          <tspan fill={widened ? "var(--litt-fg)" : "var(--litt-fg-muted)"} fontWeight={widened ? 600 : 400}>
            &quot;{widened ? "0.0.0.0/0" : "10.0.0.0/16"}&quot;
          </tspan>
          ]
        </text>
      </g>
      </g>
      <rect x={0} y={0} width={W} height={H} fill="url(#pf-fade)" />
      <defs>
        <linearGradient id="pf-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.62" stopColor="var(--litt-canvas)" stopOpacity={0} />
          <stop offset="1" stopColor="var(--litt-canvas)" stopOpacity={1} />
        </linearGradient>
      </defs>
    </svg>
  );
}
