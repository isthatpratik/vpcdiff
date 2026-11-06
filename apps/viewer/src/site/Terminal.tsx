// The CLI section: a faux terminal replays the guided mode (`vpcdiff` with no arguments),
// beside the commands to run it. The loop's reset has a visible cause: the user types
// `clear`. Under reduced motion the terminal shows its final frame and does not loop.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "@/components/litt/icons";
import { WINDOW, WindowBar } from "./Plate.tsx";
import { EASE, useInViewOnce } from "./rails.tsx";

const RUN = ["git clone https://github.com/isthatpratik/vpcdiff", "cd vpcdiff && pnpm install && pnpm build", "node packages/cli/dist/vpcdiff.mjs"];

/** Steps of the replay, with how long each holds (ms). */
const HOLD = [700, 0, 1300, 700, 1500, 900, 900, 700, 3600, 0];
const LAST = HOLD.length - 1;

function useReplay(on: boolean) {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (!on) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(LAST - 1);
      setTyped(7);
      return;
    }
    let alive = true;
    const timers: number[] = [];
    const later = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    const type = async (word: string) => {
      for (let i = 1; i <= word.length; i++) {
        if (!alive) return;
        setTyped(i);
        await later(70 + ((i * 37) % 50));
      }
    };
    void (async () => {
      for (;;) {
        setStep(0);
        setTyped(0);
        await later(HOLD[0] ?? 0);
        setStep(1);
        await type("vpcdiff");
        await later(350);
        for (let s = 2; s < LAST && alive; s++) {
          setStep(s);
          await later(HOLD[s] ?? 0);
        }
        if (!alive) return;
        setStep(LAST);
        setTyped(0);
        await type("clear");
        await later(400);
        if (!alive) return;
      }
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [on]);
  return { step, typed };
}

const dim = "text-litt-fg-subtle";
const rail = <span className={dim}>│</span>;

function Line({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <div className="animate-[term-in_240ms_cubic-bezier(0.22,1,0.36,1)] whitespace-pre">{children}</div>;
}

function Options({ items, at }: { items: string[]; at: number }) {
  return (
    <>
      {items.map((t, i) => (
        <div key={t} className="whitespace-pre">
          {rail}
          {"  "}
          {i === at ? (
            <>
              <span className="text-litt-success">●</span> <span className="text-litt-fg">{t}</span>
            </>
          ) : (
            <span className={dim}>○ {t}</span>
          )}
        </div>
      ))}
    </>
  );
}

function Screen({ step, typed }: { step: number; typed: number }) {
  if (step === LAST) {
    return (
      <div className="whitespace-pre">
        <span className={dim}>$ </span>
        {"clear".slice(0, typed)}
        <Caret />
      </div>
    );
  }
  const picked = step >= 3;
  const done = step >= 7;
  return (
    <>
      <div className="whitespace-pre">
        <span className={dim}>$ </span>
        {"vpcdiff".slice(0, typed)}
        {step <= 1 && <Caret />}
      </div>
      <Line show={step >= 2}>
        <span className={dim}>┌</span> <span className="bg-litt-fg px-1 text-litt-canvas">vpcdiff</span> <span className={dim}>see what a Terraform plan opens to the internet</span>
      </Line>
      <Line show={step >= 2}>{rail}</Line>
      <Line show={step >= 2}>
        <span className={picked ? "text-litt-success" : "text-litt-fg"}>{picked ? "◇" : "◆"}</span> Which plan should vpcdiff read?
      </Line>
      {step === 2 && <Options items={["plan.json", "tfplan", "Enter a path…"]} at={0} />}
      <Line show={picked}>
        {rail} <span className={dim}>plan.json</span>
      </Line>
      <Line show={step >= 4}> </Line>
      <Line show={step >= 4}>
        <span className="text-litt-danger">●</span> <span className="text-litt-danger">Opened to the internet</span>
      </Line>
      <Line show={step >= 4}>
        {"  "}
        <span className="font-semibold text-litt-fg">aws_instance.db</span> <span className={dim}>tcp/5432 (PostgreSQL)  Blocked →</span> Reachable
      </Line>
      <Line show={step >= 4}>
        {"  "}
        <span className={dim}>Decided at the Security groups hop:</span>
      </Line>
      <Line show={step >= 4}>
        {"    "}
        <span className="text-litt-fg">aws_security_group.db ingress tcp 5432 from 0.0.0.0/0</span>
      </Line>
      <Line show={step >= 4}> </Line>
      <Line show={step >= 4}>
        {"  "}
        <span className={dim}>Hop              Before       After</span>
      </Line>
      <Line show={step >= 4}>
        {"  "}Security groups  <span className="text-litt-data-rose-text">denies</span>
        {"       "}allows
      </Line>
      <Line show={step >= 4}>
        {"  "}
        <span className={dim}>4 other hops are the same before and after.</span>
      </Line>
      <Line show={step >= 5}> </Line>
      <Line show={step >= 5}>
        <span className={done ? "text-litt-success" : "text-litt-fg"}>{done ? "◇" : "◆"}</span> What next?
      </Line>
      {(step === 5 || step === 6) && <Options items={["Show one path in full", "Save a Markdown summary", "Done"]} at={step === 5 ? 0 : 2} />}
      <Line show={done}>
        {rail} <span className={dim}>Done</span>
      </Line>
      <Line show={done}>
        <span className={dim}>└</span> <span className="text-litt-danger">Exit 1: this plan has paths that fail --fail-on added.</span>
      </Line>
      <Line show={step >= 8}>
        <span className={dim}>$ </span>
        <Caret />
      </Line>
    </>
  );
}

function Caret() {
  return <span aria-hidden="true" className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-[caret_1s_steps(1)_infinite] bg-litt-fg/80" />;
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(RUN.join("\n"));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const icon = `absolute inset-0 m-auto size-4 transition-[opacity,transform,filter] duration-200 ${EASE}`;
  return (
    <div className="relative rounded-[8px] bg-litt-surface-1 shadow-[0_0_0_1px_var(--litt-line),inset_0_1px_0_color-mix(in_oklab,var(--litt-fg)_5%,transparent)]">
      <div className="flex h-10 items-center justify-between border-b border-litt-line pr-1.5 pl-4">
        <span className="font-litt-mono text-litt-caption text-litt-fg-subtle">Run it locally</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy the commands"}
          className="relative grid size-8 place-items-center rounded-[6px] text-litt-fg-muted transition-colors duration-200 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-fg active:scale-[0.96]"
        >
          <CopyIcon className={`${icon} ${copied ? "scale-50 opacity-0 blur-[2px]" : "scale-100 opacity-100 blur-0"}`} />
          <CheckIcon className={`${icon} ${copied ? "scale-100 opacity-100 blur-0" : "scale-50 opacity-0 blur-[2px]"}`} />
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Copied to the clipboard" : ""}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-litt-mono text-[13px] leading-6 text-litt-fg">
        {RUN.map((l) => (
          <div key={l}>
            <span className="text-litt-fg-subtle select-none">$ </span>
            {l}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function CliSection() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>("0px 0px -25% 0px");
  const { step, typed } = useReplay(seen);
  return (
    <div className="grid grid-cols-1 border-t border-litt-line lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] [&>*]:min-w-0">
      <div className="grid grid-cols-1 content-start gap-8 px-6 py-12 md:px-16 md:py-16">
        <ul className="grid gap-5 text-base text-litt-fg-muted">
          <li>
            <span className="text-litt-fg">Run it with no arguments.</span> It finds the plan in your folder, or makes one with Terraform after you say yes.
          </li>
          <li>
            <span className="text-litt-fg">A binary plan is fine.</span> It converts <code className="font-litt-mono text-[0.9em] text-litt-fg">tfplan</code> for you.
          </li>
          <li>
            <span className="text-litt-fg">The same report as the viewer.</span> In CI and pipes, plain text and the same exit code.
          </li>
        </ul>
        <CopyCommand />
      </div>
      <div ref={ref} className="relative isolate overflow-hidden border-t border-litt-line bg-litt-surface-1 lg:border-t-0 lg:border-l">
        <div aria-hidden="true" className="absolute inset-0 -z-10 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_22%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_35%,black,transparent_85%)]" />
        <div role="img" aria-label="Terminal: vpcdiff asks which plan to read, then shows that the plan opens aws_instance.db on tcp/5432 to the internet, decided by a security group rule." className="pt-8 pl-6 sm:pt-12 sm:pl-12">
          <div aria-hidden="true" className={WINDOW}>
            <WindowBar title="~/infra" />
            <div className="h-[460px] overflow-hidden px-5 py-4 font-litt-mono text-[12.5px] leading-[20px] text-litt-fg-muted sm:text-[13px]">
              <Screen step={step} typed={typed} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
