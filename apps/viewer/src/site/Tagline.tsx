// The tagline section. Each word moves from a muted tone to full ink as it crosses a
// trigger line on scroll. On wide screens, four chips from a real plan sit around the
// text, each tied to a word by a thin leader, after primora.xyz's framework page. A chip
// and its leader appear when their word lights up, so every motion has a cause.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EASE } from "./rails.tsx";

const LINES = ["A diff shows which rules changed.", "vpcdiff shows what they open."];

type Chip = { word: number; at: string; side: "top" | "bottom"; body: ReactNode };

const mono = "font-litt-mono text-[12px] leading-5";

const CHIPS: Chip[] = [
  {
    word: 1, // diff
    at: "left-[4%] top-8",
    side: "top",
    body: (
      <span className={`grid ${mono}`}>
        <span className="text-litt-fg-subtle">
          <span className="text-litt-danger">−</span> cidr_blocks = [&quot;10.0.0.0/16&quot;]
        </span>
        <span className="text-litt-fg-muted">
          <span className="text-litt-success">+</span> cidr_blocks = [&quot;0.0.0.0/0&quot;]
        </span>
      </span>
    ),
  },
  {
    word: 3, // which
    at: "right-[5%] top-14",
    side: "top",
    body: (
      <span className={`grid ${mono}`}>
        <span className="text-litt-fg">aws_security_group.db</span>
        <span className="text-litt-fg-subtle">ingress tcp/5432</span>
      </span>
    ),
  },
  {
    word: 6, // vpcdiff
    at: "left-[7%] bottom-10",
    side: "bottom",
    body: (
      <span className={`flex items-center gap-2 ${mono}`}>
        <span className="text-litt-fg-muted">Security groups</span>
        <span className="text-litt-fg-subtle">denies</span>
        <span className="text-litt-fg-subtle">→</span>
        <span className="text-litt-fg">allows</span>
      </span>
    ),
  },
  {
    word: 10, // open.
    at: "right-[4%] bottom-14",
    side: "bottom",
    body: (
      <span className="grid gap-0.5">
        <span className="flex items-center gap-2 text-[13px] leading-5 font-medium text-litt-fg">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-litt-danger shadow-[0_0_0_3px_color-mix(in_oklab,var(--litt-danger)_18%,transparent)]" />
          Opened to the internet
        </span>
        <span className={`${mono} text-litt-fg-subtle`}>aws_instance.db · tcp/5432</span>
      </span>
    ),
  },
];

type Leader = { d: string; x: number; y: number };

export function Tagline() {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const chips = useRef<(HTMLDivElement | null)[]>([]);
  const words = LINES.flatMap((line, li) => {
    const parts = line.split(" ");
    return parts.map((w, wi) => ({ w, key: `${li}-${wi}`, lineEnd: wi === parts.length - 1 && li < LINES.length - 1 }));
  });
  const [lit, setLit] = useState(0);
  const [leaders, setLeaders] = useState<(Leader | null)[]>([]);

  // Light each word as it crosses 62% of the viewport height. Never unlight.
  useEffect(() => {
    const el = text.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setLit(words.length);
    let frame = 0;
    const update = () => {
      frame = 0;
      const trigger = window.innerHeight * 0.62;
      let n = 0;
      el.querySelectorAll<HTMLSpanElement>("[data-word]").forEach((s) => {
        if (s.getBoundingClientRect().top < trigger) n++;
      });
      setLit((prev) => Math.max(prev, n));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [words.length]);

  // Measure each leader: from the chip's near edge to its word, as an elbow.
  useLayoutEffect(() => {
    const root = box.current;
    const p = text.current;
    if (!root || !p) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      const spans = p.querySelectorAll<HTMLSpanElement>("[data-word]");
      setLeaders(
        CHIPS.map((c, i) => {
          const chip = chips.current[i];
          const word = spans[c.word];
          if (!chip || !word || chip.offsetParent === null) return null;
          const a = chip.getBoundingClientRect();
          const b = word.getBoundingClientRect();
          const top = c.side === "top";
          const x1 = Math.round(a.left + a.width / 2 - r.left) + 0.5;
          const y1 = Math.round((top ? a.bottom : a.top) - r.top);
          const x2 = Math.round(b.left + b.width / 2 - r.left) + 0.5;
          const y2 = Math.round((top ? b.top + 6 : b.bottom - 4) - r.top);
          const mid = Math.round((y1 + y2) / 2);
          return { d: `M${x1} ${y1} V${mid} H${x2} V${y2}`, x: x2, y: y2 };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="relative isolate px-6 py-32 sm:py-44 lg:py-52">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_22%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_60%_55%_at_50%_50%,black,transparent_80%)] opacity-60"
      />
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 hidden size-full overflow-visible lg:block">
        {leaders.map((l, i) => {
          const c = CHIPS[i];
          if (!l || !c) return null;
          const on = lit > c.word;
          return (
            <g key={c.word}>
              <path
                d={l.d}
                pathLength={1}
                fill="none"
                stroke="var(--litt-line-strong)"
                strokeWidth={1}
                strokeDasharray="1 1"
                strokeDashoffset={on ? 0 : 1}
                style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)" }}
              />
              <circle cx={l.x} cy={l.y} r={2} fill="var(--litt-fg-subtle)" style={{ opacity: on ? 1 : 0, transition: "opacity 300ms 500ms" }} />
            </g>
          );
        })}
      </svg>
      {CHIPS.map((c, i) => {
        const on = lit > c.word;
        return (
          <div
            key={c.word}
            ref={(el) => {
              chips.current[i] = el;
            }}
            aria-hidden="true"
            className={`absolute ${c.at} hidden rounded-lg bg-litt-surface-1 px-3 py-2 shadow-[0_0_0_1px_var(--litt-line),inset_0_1px_0_color-mix(in_oklab,var(--litt-fg)_6%,transparent),0_12px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,transform,filter] duration-500 lg:block ${EASE} ${on ? "translate-y-0 opacity-100 blur-0 delay-300" : `${c.side === "top" ? "-translate-y-1.5" : "translate-y-1.5"} opacity-0 blur-[3px]`}`}
          >
            {c.body}
          </div>
        );
      })}
      <p ref={text} className="relative mx-auto max-w-[820px] text-center font-display text-4xl leading-[1.1] font-normal tracking-[-0.035em] text-balance sm:text-6xl sm:leading-[1.04]">
        <span className="sr-only">{LINES.join(" ")}</span>
        {words.map((x, i) => (
          <span key={x.key} aria-hidden="true">
            <span data-word className={`transition-colors duration-500 ${EASE} ${i < lit ? "text-litt-fg" : "text-litt-fg/20"}`}>
              {x.w}
            </span>
            {x.lineEnd ? <br /> : " "}
          </span>
        ))}
      </p>
    </div>
  );
}
