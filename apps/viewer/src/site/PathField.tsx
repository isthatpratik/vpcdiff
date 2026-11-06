// The hero visual: a field of square dots, one per address, densest where the network
// is. A plan widens one rule (the caption at the top is the cause); one path then draws
// from the internet, hop by hop, to the database.
//
// The camera follows the story on a critically damped spring, so every move eases in
// and settles slowly: it starts close on the internet, follows each hop as it lights,
// and pulls back to the whole path. Then it whip-pans right: a slow start that speeds
// up (ease-in) carries the path off the left edge; the view continues on a whole number
// of grid cells, so the dots line up, and the start frame slides in from the right and
// lands on the internet (ease-out). The path resets while it is off screen, so the loop
// has no seam and no line is seen to retract.
//
// On the left, any public address keeps arriving: each spoke snaps its far end to a
// block next to it, one cell at a time, and only the blocks a spoke lands on are lit.
//
// Camera and spokes run in one animation frame loop that writes SVG attributes directly
// (no React render per frame). Off screen, nothing runs. Under reduced motion, one still
// frame with the path drawn is shown.
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
/** Where the spokes start; each then wanders to neighboring cells in this box. */
const SOURCES: [number, number][] = [
  [2, 1],
  [4, 1],
  [1, 3],
  [3, 4],
  [1, 6],
  [3, 7],
];
const SPOKE_BOX = { c0: 0, c1: 4, r0: 0, r1: 8 };
const FOCUS = { x: 700, y: 230 };
/** Fast start, long smooth landing (path segments, nodes, labels). */
const EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * step: 0 close on the internet, rule narrow (the pan lands here); 1 rule widened;
 * 2..6 hops lit (2 = internet); 7 the whole path; 8 the pan away to the right.
 */
const TIMES = [2600, 1100, 950, 950, 950, 1100, 950, 2800, 1000];
/** The whip pan: a whole number of grid cells, so the dots line up across the jump. */
const PAN = STEP * 19;
const PAN_OUT = 1.0; // seconds, ease-in
const PAN_IN = 1.4; // seconds, ease-out

const C = { x: 600, y: 250 };
type Shot = { x: number; y: number; k: number };

function shotFor(step: number, pts: { x: number; y: number }[]): Shot {
  const p0 = pts[0] ?? C;
  if (step === 0) return { x: p0.x + 60, y: p0.y + 10, k: 1.3 };
  if (step === 1) return { x: p0.x + 140, y: p0.y, k: 1.18 };
  if (step >= 2 && step <= 6) {
    const p = pts[step - 2] ?? C;
    return { x: C.x + (p.x - C.x) * 0.55, y: C.y + (p.y - C.y) * 0.55, k: 1.12 };
  }
  return { x: 650, y: 240, k: 1.03 };
}

export function PathField({ className = "" }: { className?: string }) {
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const [step, setStep] = useState(reduced ? 7 : 0);
  const ref = useRef<SVGSVGElement>(null);
  const camRef = useRef<SVGGElement>(null);
  const fieldRef = useRef<SVGGElement>(null);
  const spokeRefs = useRef<(SVGLineElement | null)[]>([]);
  const tipRefs = useRef<(SVGRectElement | null)[]>([]);
  const stepRef = useRef(step);
  stepRef.current = step;

  const pts = useMemo(() => HOPS.map((h) => at(h.c, h.r)), []);
  const origin = pts[0] ?? C;

  // The story clock: one step at a time, paused off screen.
  useEffect(() => {
    if (reduced) return;
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
  }, [reduced]);

  // The camera spring and the wandering spokes, in one frame loop.
  useEffect(() => {
    const apply = (cam: Shot) => {
      camRef.current?.setAttribute("transform", `translate(${C.x - cam.x * cam.k} ${C.y - cam.y * cam.k}) scale(${cam.k})`);
    };
    if (reduced) {
      apply(shotFor(7, pts));
      return;
    }
    const cam = { ...shotFor(0, pts), vx: 0, vy: 0, vk: 0 };
    const omega = 2.1; // rad/s: critically damped, settles in about 2 s
    const spokes = SOURCES.map(([c, r]) => {
      const p = at(c, r);
      return { c, r, from: p, to: p, t0: 0 };
    });
    const MOVE = 0.28; // seconds per snap
    const snap = (t: number) => 1 - Math.pow(1 - t, 4); // a hard ease-out
    const easeIn = (t: number) => t * t * t;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    // A running pan, if any: from and to camera values, the curve, start time, length.
    let pan: { from: Shot; to: Shot; ease: (t: number) => number; t0: number; len: number; yk: (t: number) => number } | null = null;
    let lastStep = stepRef.current;
    let nextHop = 0;
    let last = performance.now();
    let frame = 0;
    let visible = true;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tnow = now / 1000;
      const st = stepRef.current;
      if (st !== lastStep) {
        const start = shotFor(0, pts);
        if (st === 8) {
          // Pan out: slow start, speeding up, to the right; frame the start's height and zoom.
          pan = { from: { x: cam.x, y: cam.y, k: cam.k }, to: { x: start.x + PAN, y: start.y, k: start.k }, ease: easeIn, yk: inOut, t0: tnow, len: PAN_OUT };
        } else if (st === 0 && lastStep === 8) {
          // Continue the same way: jump back by the pan (the grid lines up), then land.
          pan = { from: { x: start.x - PAN, y: start.y, k: start.k }, to: start, ease: easeOut, yk: easeOut, t0: tnow, len: PAN_IN };
        }
        lastStep = st;
      }
      if (pan) {
        const u = Math.min(1, (tnow - pan.t0) / pan.len);
        const e = pan.ease(u);
        const g = pan.yk(u);
        cam.x = pan.from.x + (pan.to.x - pan.from.x) * e;
        cam.y = pan.from.y + (pan.to.y - pan.from.y) * g;
        cam.k = pan.from.k + (pan.to.k - pan.from.k) * g;
        cam.vx = cam.vy = cam.vk = 0;
        // The field dims at the fastest part of the whip, where the jump happens.
        fieldRef.current?.setAttribute("opacity", `${st === 8 ? 1 - 0.85 * e : 0.15 + 0.85 * e}`);
        if (u >= 1 && st !== 8) pan = null;
      } else {
        const target = shotFor(st, pts);
        // x'' = ω²(target − x) − 2ω x'  (critical damping: no overshoot, soft start and end)
        cam.vx += (omega * omega * (target.x - cam.x) - 2 * omega * cam.vx) * dt;
        cam.vy += (omega * omega * (target.y - cam.y) - 2 * omega * cam.vy) * dt;
        cam.vk += (omega * omega * (target.k - cam.k) - 2 * omega * cam.vk) * dt;
        cam.x += cam.vx * dt;
        cam.y += cam.vy * dt;
        cam.k += cam.vk * dt;
      }
      apply(cam);

      // Every so often one spoke steps to a neighboring block.
      const t = now / 1000;
      if (t > nextHop) {
        nextHop = t + 0.22 + Math.random() * 0.22;
        const i = Math.floor(Math.random() * spokes.length);
        const sp = spokes[i];
        if (sp && t - sp.t0 > MOVE) {
          const moves: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          const options = moves
            .map(([dc, dr]) => [sp.c + dc, sp.r + dr] as [number, number])
            .filter(([c, r]) => c >= SPOKE_BOX.c0 && c <= SPOKE_BOX.c1 && r >= SPOKE_BOX.r0 && r <= SPOKE_BOX.r1 && !spokes.some((o) => o !== sp && o.c === c && o.r === r));
          const pick = options[Math.floor(Math.random() * options.length)];
          if (pick) {
            const cur = sp.to;
            sp.c = pick[0];
            sp.r = pick[1];
            sp.from = cur;
            sp.to = at(pick[0], pick[1]);
            sp.t0 = t;
          }
        }
      }
      spokes.forEach((sp, i) => {
        const e = snap(Math.min(1, (t - sp.t0) / MOVE));
        const x = sp.from.x + (sp.to.x - sp.from.x) * e;
        const y = sp.from.y + (sp.to.y - sp.from.y) * e;
        spokeRefs.current[i]?.setAttribute("x1", `${x}`);
        spokeRefs.current[i]?.setAttribute("y1", `${y}`);
        tipRefs.current[i]?.setAttribute("x", `${x - 3.5}`);
        tipRefs.current[i]?.setAttribute("y", `${y - 3.5}`);
      });
      if (visible) frame = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) {
        last = performance.now();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(loop);
      }
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduced, pts]);

  // The field reaches past the frame on every side, so the camera can pan without
  // showing an edge. Far from the network the dots shrink to a faint floor.
  const dots = useMemo(() => {
    const out: { x: number; y: number; s: number; o: number }[] = [];
    for (let c = -24; c < W / STEP + 21; c++) {
      for (let r = -3; r < H / STEP + 4; r++) {
        const { x, y } = at(c, r);
        const d = Math.hypot(x - FOCUS.x, (y - FOCUS.y) * 1.3);
        const s = Math.max(1.6, Math.min(7, 9 - d / 70));
        out.push({ x, y, s, o: Math.max(0.12, 1 - d / 640) });
      }
    }
    return out;
  }, []);

  const lit = (i: number) => step >= i + 2 && step <= 8;
  const widened = step >= 1 && step <= 7;
  // The path resets while the field is away; it is never seen to retract.
  const resetting = step === 0;

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMin slice" className={`block h-full w-full ${className}`} aria-hidden="true">
      <style>{`@media (max-width: 640px) { .pf-text { display: none } }`}</style>
      <g ref={fieldRef}>
        <g ref={camRef}>
          {dots.map((d) => (
            <rect key={`${d.x}-${d.y}`} x={d.x - d.s / 2} y={d.y - d.s / 2} width={d.s} height={d.s} fill="var(--litt-fg)" opacity={d.o * 0.42} />
          ))}

          {/* Any public address: spokes into the internet node, their far ends wandering
              one block at a time; only the blocks they land on are lit. */}
          {SOURCES.map(([c, r], i) => {
            const a = at(c, r);
            return (
              <g key={`${c}-${r}`}>
                <line
                  ref={(el) => {
                    spokeRefs.current[i] = el;
                  }}
                  x1={a.x}
                  y1={a.y}
                  x2={origin.x}
                  y2={origin.y}
                  stroke="var(--litt-fg)"
                  strokeOpacity={0.24}
                  strokeWidth={1}
                />
                <rect
                  ref={(el) => {
                    tipRefs.current[i] = el;
                  }}
                  x={a.x - 3.5}
                  y={a.y - 3.5}
                  width={7}
                  height={7}
                  fill="var(--litt-fg)"
                  opacity={0.7}
                />
              </g>
            );
          })}

          {/* The path, one segment per hop. */}
          {pts.slice(1).map((b, i) => {
            const a = pts[i] ?? b;
            const on = lit(i + 1);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={on ? 0 : 1}
                stroke="var(--litt-fg)"
                strokeWidth={1.5}
                style={{ transition: resetting ? "none" : `stroke-dashoffset 700ms ${EXPO}` }}
              />
            );
          })}

          {HOPS.map((h, i) => {
            const p = pts[i] ?? origin;
            const on = lit(i);
            const last = i === HOPS.length - 1;
            const size = last ? 22 : 14;
            const instant = resetting ? "none" : undefined;
            return (
              <g key={h.label}>
                {last && <rect x={p.x - 22} y={p.y - 22} width={44} height={44} fill="none" stroke="var(--litt-fg)" strokeWidth={1} opacity={step === 7 ? 0.35 : 0} style={{ transition: instant ?? `opacity 800ms ${EXPO}` }} />}
                <rect
                  x={p.x - size / 2}
                  y={p.y - size / 2}
                  width={size}
                  height={size}
                  fill={on ? "var(--litt-fg)" : "var(--litt-canvas)"}
                  stroke="var(--litt-fg)"
                  strokeOpacity={on ? 1 : 0.45}
                  style={{ transition: instant ?? `fill 500ms ${EXPO}, transform 900ms ${EXPO}`, transformBox: "fill-box", transformOrigin: "center", transform: on ? "scale(1)" : "scale(0.85)" }}
                />
                <g className="pf-text" fillOpacity={on ? 1 : 0.32} style={{ transition: instant ?? `fill-opacity 600ms ${EXPO}` }}>
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
        </g>
      </g>

      {/* The cause: the plan's one-line change, at the top right. It stays still while
          the camera moves, like a caption on the frame. */}
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
