// The viewer (DESIGN.md): open a plan, read every path from the internet before and after
// it, hop by hop. The layout gives the most room to the change itself: a path strip that
// shows the difference at a glance, and one hop table where the hops that changed are
// open and the rest fold to a line. Nothing leaves the tab.
import type { Path, Result } from "@vpcdiff/engine";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { Button } from "@/components/litt/button";
import { Callout } from "@/components/litt/callout";
import { ArrowRightIcon, CheckIcon, CopyIcon, FileIcon, LockIcon, PlusIcon } from "@/components/litt/icons";
import { Segmented } from "@/components/litt/segmented";
import { Loading, Skeleton } from "@/components/litt/states";
import { TooltipProvider } from "@/components/litt/tooltip";
import { analyzeInWorker } from "../engine.ts";
import { EXAMPLES } from "../examples.ts";
import { COLUMNS, lanesOf, rowsDiffer, type Cell, type CellState } from "../graph.ts";
import { Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeSwitch } from "../shared/theme.tsx";
import { CHANGE_ORDER, CHANGE_TEXT, ChangeTag, DecisionTag, STAT_LABEL, VERDICT_LABEL } from "./status.tsx";

type State = { kind: "empty"; error?: string } | { kind: "loading"; name: string } | { kind: "ready"; name: string; result: Result };
type Filter = "changes" | "all";

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const LABEL = "font-litt-mono text-[11px] tracking-[0.12em] text-litt-fg-subtle uppercase";

export function App() {
  const [state, setState] = useState<State>({ kind: "empty" });
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const open = useCallback(async (name: string, text: Promise<string>) => {
    setState({ kind: "loading", name });
    try {
      const result = await analyzeInWorker(await text);
      setState({ kind: "ready", name, result });
    } catch (e) {
      setState({ kind: "empty", error: (e as Error).message });
    }
  }, []);
  const openFile = useCallback(
    (file: File | undefined) => {
      if (file) void open(file.name, file.text());
    },
    [open],
  );

  // A plan can be dropped anywhere on the page, at any time.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    openFile(e.dataTransfer.files[0]);
  };

  return (
    <TooltipProvider>
      <div className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-litt-canvas" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={(e) => hasFiles(e) && e.preventDefault()} onDrop={onDrop}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50">
          Skip to content
        </a>
        <TopBar name={state.kind === "ready" || state.kind === "loading" ? state.name : undefined} onNew={state.kind === "ready" ? () => setState({ kind: "empty" }) : undefined} />
        <main id="main" className="min-h-0">
          {state.kind === "empty" && (
            <Start
              error={state.error}
              onFile={openFile}
              onExample={(id) => {
                const ex = EXAMPLES.find((x) => x.id === id);
                if (ex) void open(`${ex.id}/plan.json`, ex.load());
              }}
            />
          )}
          {state.kind === "loading" && <Busy />}
          {state.kind === "ready" && <Workspace key={state.name} result={state.result} />}
        </main>
        <div
          aria-hidden={!dragging}
          className={`pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-[14px] border border-dashed border-litt-fg/40 bg-litt-canvas/80 backdrop-blur-md transition-opacity duration-200 ${dragging ? "opacity-100" : "opacity-0"}`}
        >
          <p className="flex items-center gap-3 font-display text-2xl font-normal tracking-[-0.02em] text-litt-fg">
            <FileIcon aria-hidden="true" /> Drop the plan to open it
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}

function TopBar({ name, onNew }: { name?: string | undefined; onNew?: (() => void) | undefined }) {
  return (
    <header className="flex h-14 min-w-0 items-center gap-4 border-b border-litt-line px-4 sm:px-5">
      <a href="../" aria-label="vpcdiff home" className="shrink-0 rounded-litt-control focus-visible:outline-2 focus-visible:outline-litt-focus">
        <Wordmark size={17} />
      </a>
      <span aria-hidden="true" className="hidden text-litt-line-strong sm:inline">
        /
      </span>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-litt-small sm:flex">
        {name ? (
          <>
            <span className="text-litt-fg-subtle">Viewer</span>
            <span aria-hidden="true" className="text-litt-line-strong">
              /
            </span>
            <span className="truncate font-litt-mono text-litt-fg" aria-current="page" title={name}>
              {name}
            </span>
          </>
        ) : (
          <span className="text-litt-fg" aria-current="page">
            Viewer
          </span>
        )}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden items-center gap-2 rounded-full border border-litt-line px-3 py-1 text-litt-caption text-litt-fg-subtle md:inline-flex" title="The plan is read in this tab. It is never uploaded.">
          <LockIcon aria-hidden="true" className="size-3.5" />
          Local only
        </span>
        {onNew && (
          <Button size="sm" variant="secondary" icon={<PlusIcon />} onClick={onNew} aria-label="Open plan">
            <span className="hidden sm:inline">Open plan</span>
          </Button>
        )}
        <span className="hidden sm:inline">
          <ThemeSwitch />
        </span>
        <span className="hidden sm:inline">
          <GithubLink />
        </span>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- start */

/** A row of eight hop squares: a small picture of a path, used on the example cards. */
function MiniStrip({ pattern }: { pattern: string }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {pattern.split("").map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className={`size-2 ${c === "#" ? "bg-litt-fg" : c === "x" ? "bg-litt-data-rose" : c === "!" ? "bg-litt-warning" : "border border-litt-line-strong"}`} />
          {i < pattern.length - 1 && <span className="h-px w-2 bg-litt-line-strong" />}
        </span>
      ))}
    </span>
  );
}

const EXAMPLE_STRIP: Record<string, string> = {
  "sg-5432-opened": "########",
  "nacl-denies-ssh": "###x....",
  "rule-resources": "########",
  "sg-replaced": "####!###",
};

function Start({ error, onFile, onExample }: { error?: string | undefined; onFile: (f: File | undefined) => void; onExample: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = "terraform show -json tfplan > plan.json";
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-[1120px] gap-14 px-5 py-14 sm:px-8 lg:py-20 [&>*]:min-w-0">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [&>*]:min-w-0">
          <div className="grid content-start gap-6">
            <p className={`flex items-center gap-3 ${LABEL}`}>
              <span aria-hidden="true" className="size-2 bg-litt-fg" />
              Viewer
            </p>
            <h1 className="font-display text-4xl leading-[1.05] font-normal tracking-[-0.035em] text-litt-fg sm:text-5xl">
              Open a plan.
              <span className="block text-litt-fg-subtle">See what it opens.</span>
            </h1>
            <p className="max-w-[46ch] text-base leading-relaxed text-litt-fg-muted">
              vpcdiff compares what the internet can reach before and after a Terraform plan, and names the rule that decides each hop.
            </p>
            <p className="flex items-center gap-2 text-litt-small text-litt-fg-subtle">
              <LockIcon aria-hidden="true" className="size-4" />
              The file is read in this tab. It is never uploaded.
            </p>
          </div>

          <div className="relative border border-litt-line bg-litt-surface-1 p-2">
            <div
              className={`relative grid min-h-[300px] place-items-center overflow-hidden border border-dashed px-6 py-12 text-center transition-colors duration-200 ${over ? "border-litt-fg bg-litt-surface-2" : "border-litt-line-strong"}`}
              onDragEnter={() => setOver(true)}
              onDragLeave={() => setOver(false)}
              onDrop={() => setOver(false)}
            >
              <div aria-hidden="true" className="absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_22%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
              <div className="relative grid justify-items-center gap-5">
                <span className="grid size-12 place-items-center border border-litt-line-strong bg-litt-canvas text-litt-fg">
                  <FileIcon aria-hidden="true" />
                </span>
                <div className="grid gap-1.5">
                  <p className="font-display text-xl font-normal tracking-[-0.02em] text-litt-fg">Drop plan.json here</p>
                  <p className="text-litt-small text-litt-fg-subtle">The output of terraform show -json</p>
                </div>
                <Button variant="primary" onClick={() => input.current?.click()}>
                  Choose a file
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  aria-label="Plan JSON file"
                  tabIndex={-1}
                  onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-litt-line px-3 py-2.5">
              <span className={LABEL}>Make it</span>
              <code className="min-w-0 flex-1 truncate font-litt-mono text-litt-caption text-litt-fg-muted">{cmd}</code>
              <button
                type="button"
                aria-label={copied ? "Copied" : "Copy the command"}
                onClick={() => {
                  void navigator.clipboard?.writeText(`terraform plan -out=tfplan\n${cmd}`).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  });
                }}
                className="grid size-7 place-items-center rounded-litt-control text-litt-fg-subtle transition-colors duration-200 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-3.5"
              >
                {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>

        {error && <Callout tone="danger" title="That file could not be read" description={error} live />}

        <section className="grid gap-5" aria-labelledby="examples">
          <h2 id="examples" className={LABEL}>
            Or open an example plan
          </h2>
          <ul className="grid gap-px border border-litt-line bg-litt-line sm:grid-cols-2 lg:grid-cols-4">
            {EXAMPLES.map((ex) => (
              <li key={ex.id} className="bg-litt-canvas">
                <button
                  type="button"
                  onClick={() => onExample(ex.id)}
                  className={`group grid h-full w-full content-between gap-8 p-5 text-left transition-colors duration-300 ${EASE} hover:bg-litt-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus active:bg-litt-surface-2`}
                >
                  <MiniStrip pattern={EXAMPLE_STRIP[ex.id] ?? "........"} />
                  <span className="grid gap-1.5">
                    <span className="flex items-center justify-between gap-2 text-litt-small font-medium text-litt-fg">
                      {ex.title}
                      <ArrowRightIcon aria-hidden="true" className={`size-4 text-litt-fg-subtle transition-transform duration-300 ${EASE} group-hover:translate-x-0.5 group-hover:text-litt-fg`} />
                    </span>
                    <span className="text-litt-caption leading-relaxed text-litt-fg-subtle">{ex.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Busy() {
  return (
    <Loading label="Analyzing the plan" className="grid h-full grid-cols-1 md:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-3 border-b border-litt-line p-5 md:border-r md:border-b-0">
        <Skeleton className="h-16 w-full" radius="surface" />
        <Skeleton className="h-9 w-full" radius="surface" />
        <Skeleton className="h-14 w-full" radius="surface" />
        <Skeleton className="h-14 w-full" radius="surface" />
      </div>
      <div className="grid content-start gap-4 p-8">
        <Skeleton text="h2" className="w-1/2" />
        <Skeleton className="h-24 w-full" radius="surface" />
        <Skeleton className="h-72 w-full" radius="surface" />
      </div>
    </Loading>
  );
}

/* ------------------------------------------------------------ workspace */

function Workspace({ result }: { result: Result }) {
  const [filter, setFilter] = useState<Filter>("changes");
  const visible = useMemo(
    () =>
      result.paths
        .filter((p) => filter === "all" || p.change !== "unchanged" || p.outageRisk)
        .toSorted((a, b) => CHANGE_ORDER.indexOf(a.change) - CHANGE_ORDER.indexOf(b.change) || (a.id < b.id ? -1 : 1)),
    [result, filter],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(visible[0]?.id);
  useEffect(() => {
    if (!visible.some((p) => p.id === selectedId)) setSelectedId(visible[0]?.id);
  }, [visible, selectedId]);
  const selected = result.paths.find((p) => p.id === selectedId);
  const unchanged = result.paths.length - visible.length;
  const list = useRef<HTMLUListElement>(null);

  // Up and down move through the list, like a native list box.
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = visible.findIndex((p) => p.id === selectedId);
    const next = visible[Math.min(visible.length - 1, Math.max(0, i + d))];
    if (!next) return;
    setSelectedId(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-auto md:grid-cols-[320px_minmax(0,1fr)] md:overflow-hidden">
      <aside className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] border-b border-litt-line md:border-r md:border-b-0" aria-label="Paths">
        <dl className="grid grid-cols-4 gap-px border-b border-litt-line bg-litt-line">
          {CHANGE_ORDER.filter((c) => c !== "unchanged").map((c) => (
            <div key={c} className="grid gap-1 bg-litt-canvas px-3 py-4">
              <dd className={`font-display text-2xl leading-none font-normal tabular-nums ${result.summary[c] ? CHANGE_TEXT[c] : "text-litt-fg-subtle"}`}>{result.summary[c]}</dd>
              <dt className="text-litt-caption text-litt-fg-subtle">{STAT_LABEL[c]}</dt>
            </div>
          ))}
        </dl>
        <div className="border-b border-litt-line p-3">
          <Segmented<Filter>
            legend="Show"
            size="sm"
            block
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "changes", label: "Changes" },
              { value: "all", label: `All paths · ${result.paths.length}` },
            ]}
          />
        </div>
        <div className="min-h-0 overflow-auto">
          {visible.length ? (
            <ul ref={list} aria-label="Paths" onKeyDown={onKey} className="divide-y divide-litt-line border-b border-litt-line">
              {visible.map((p) => (
                <li key={p.id}>
                  <PathRow path={p} current={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-2 p-5">
              <p className="text-litt-small font-medium text-litt-fg">No changes from the internet</p>
              <p className="text-litt-small leading-relaxed text-litt-fg-subtle">
                {result.paths.length
                  ? `The plan does not change any path. All paths shows the ${unchanged} the engine checked.`
                  : "No security group in this plan opens a port to a public address, so there is no internet path to check."}
              </p>
            </div>
          )}
        </div>
        {result.notes.length > 0 && (
          <div className="border-t border-litt-line px-4">
            <Accordion type="single" collapsible headingLevel={2}>
              <AccordionItem value="notes">
                <AccordionTrigger>Not modeled yet · {result.notes.length}</AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-1 pb-3">
                    {result.notes.map((n) => (
                      <li key={n.resource} className="font-litt-mono text-litt-caption text-litt-fg-subtle">
                        {n.resource}
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </aside>
      {selected ? <PathDetail key={selected.id} path={selected} /> : <section aria-label="Path detail" />}
    </div>
  );
}

const CHANGE_BAR: Record<string, string> = { added: "bg-litt-danger", removed: "bg-litt-success", changed: "bg-litt-warning", unknown: "bg-litt-fg-subtle", unchanged: "bg-litt-line-strong" };

function PathRow({ path, current, onSelect }: { path: Path; current: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-id={path.id}
      aria-current={current}
      tabIndex={current ? 0 : -1}
      onClick={onSelect}
      className={`relative grid w-full gap-1.5 px-5 py-3.5 text-left transition-colors duration-200 hover:bg-litt-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus ${current ? "bg-litt-surface-1" : ""}`}
    >
      <span aria-hidden="true" className={`absolute top-0 bottom-0 left-0 w-0.5 transition-opacity duration-200 ${CHANGE_BAR[path.change]} ${current ? "opacity-100" : "opacity-0"}`} />
      <span className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-litt-mono text-litt-small text-litt-fg">{path.to}</span>
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${CHANGE_BAR[path.change]}`} />
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-litt-caption text-litt-fg-subtle">
        <span className="font-litt-mono">
          {path.protocol}/{path.ports}
        </span>
        <span>
          {VERDICT_LABEL[path.before.verdict]} → {VERDICT_LABEL[path.after.verdict]}
        </span>
      </span>
      <span className="sr-only">{path.change}</span>
      {path.outageRisk && <span className="text-litt-caption text-litt-warning">Outage risk during apply</span>}
    </button>
  );
}

function sourcesText(path: Path): string {
  const s = path.after.verdict === "allowed" ? path.after.sources : path.before.verdict === "allowed" ? path.before.sources : [];
  if (!s.length) return "Not reachable from the internet on either side of the plan.";
  const who = s.length === 1 && s[0] === "internet" ? "any public address" : s.join(", ");
  return `Reachable from ${who} ${path.after.verdict === "allowed" ? "after the plan" : "before the plan only"}.`;
}

/* --------------------------------------------------------------- detail */

const SQUARE: Record<CellState, string> = {
  allow: "bg-litt-fg border-litt-fg",
  partial: "bg-litt-warning border-litt-warning",
  deny: "bg-litt-data-rose border-litt-data-rose",
  unknown: "border-dashed border-litt-fg-subtle bg-litt-canvas",
  "not-reached": "border-litt-line-strong bg-litt-canvas",
  absent: "border-litt-line bg-litt-canvas",
};

/** Before and after as two rows of squares, one per hop, so the change reads at once. */
function PathStrip({ before, after, changed, risk, selected, onSelect }: { before: Cell[]; after: Cell[]; changed: boolean[]; risk: number; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="grid gap-3 overflow-x-auto" role="group" aria-label="Path at a glance, before and after">
      <div className="grid min-w-[560px] grid-cols-[64px_repeat(8,minmax(0,1fr))] items-center gap-y-3">
        <span />
        {COLUMNS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(i)}
            className={`truncate px-1 text-center text-[11px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus ${i === selected ? "text-litt-fg" : "text-litt-fg-subtle hover:text-litt-fg"}`}
          >
            {c.label}
          </button>
        ))}
        {(["before", "after"] as const).map((side) => (
          <Fragment key={side}>
            <span className={LABEL}>{side}</span>
            {(side === "before" ? before : after).map((cell, i) => (
              <span key={i} className="relative flex h-5 items-center justify-center">
                {i > 0 && <span aria-hidden="true" className={`absolute right-1/2 left-[-50%] h-px ${cell.state === "not-reached" || cell.state === "absent" ? "bg-litt-line" : "bg-litt-line-strong"}`} />}
                <span aria-hidden="true" className={`relative z-10 size-3 border transition-colors duration-300 ${SQUARE[cell.state]}`} />
                {(changed[i] || i === risk) && side === "after" && <span aria-hidden="true" className="absolute -bottom-2.5 h-0.5 w-3 bg-litt-warning" />}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function CellView({ cell, note }: { cell: Cell; note?: string }) {
  const faint = cell.state === "not-reached" || cell.state === "absent";
  return (
    <div className={`flex min-w-0 items-center gap-3 ${faint ? "opacity-60" : ""}`}>
      <span className="shrink-0">
        <DecisionTag state={cell.state} />
      </span>
      {cell.resource && <span className="truncate font-litt-mono text-litt-caption text-litt-fg-muted">{cell.resource}</span>}
      {note && <span className="shrink-0 text-litt-caption text-litt-fg-subtle">{note}</span>}
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : `Copy ${text}`}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        })
      }
      className="grid size-6 shrink-0 place-items-center rounded-litt-control text-litt-fg-subtle transition-colors duration-200 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-3"
    >
      {done ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </button>
  );
}

/** One side of an open hop: the rule that decided it, the resource to copy, the AWS docs. */
function SideDetail({ title, cell }: { title: string; cell: Cell }) {
  return (
    <div className="grid content-start gap-2.5">
      <p className={LABEL}>{title}</p>
      {cell.rule && <p className="text-litt-small leading-relaxed text-litt-fg">{cell.rule}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {cell.resource && (
          <span className="flex min-w-0 items-center gap-1 font-litt-mono text-litt-caption text-litt-fg-subtle">
            <span className="truncate">{cell.resource}</span>
            <CopyText text={cell.resource} />
          </span>
        )}
        {cell.doc && (
          <a href={cell.doc} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-litt-caption text-litt-fg-muted underline decoration-litt-line-strong underline-offset-4 transition-colors duration-200 hover:text-litt-fg hover:decoration-litt-fg">
            How AWS decides this hop <ArrowRightIcon aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function PathDetail({ path }: { path: Path }) {
  const lanes = useMemo(() => lanesOf(path), [path]);
  // Changed hops start open; the rest fold to a line until opened.
  const [openRows, setOpenRows] = useState<Set<number>>(() => new Set(lanes.changed.some(Boolean) ? lanes.changed.flatMap((c, i) => (c ? [i] : [])) : [lanes.focus]));
  const [selected, setSelected] = useState(lanes.focus);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const select = (i: number) => {
    setSelected(i);
    setOpenRows((s) => new Set(s).add(i));
    rows.current[i]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const toggle = (i: number) =>
    setOpenRows((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  // For the table, a row differs whenever its two cells differ, including when the
  // resource exists on one side only (lanes.changed leaves those unmarked on purpose).
  const rowDiffers = rowsDiffer(lanes);
  const changedCount = rowDiffers.filter(Boolean).length;
  // On a path with outage risk and no other change, the focus hop is the replaced one.
  const risk = path.outageRisk && !lanes.changed.some(Boolean) ? lanes.focus : -1;

  return (
    <section className="min-h-0 min-w-0 overflow-auto" aria-labelledby="detail-title">
      <div className="mx-auto grid max-w-[1040px] gap-8 px-5 py-8 sm:px-10 sm:py-10 [&>*]:min-w-0">
        <header className="grid gap-4">
          <p className={`flex items-center gap-3 ${LABEL}`}>
            <span aria-hidden="true" className={`size-2 ${CHANGE_BAR[path.change]}`} />
            Path
          </p>
          <h2 id="detail-title" className="font-display text-2xl leading-tight font-normal tracking-[-0.02em] text-litt-fg sm:text-3xl">
            <span className="text-litt-fg-subtle">internet → </span>
            <span className="font-litt-mono text-[0.85em] break-all">{path.to}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ChangeTag change={path.change} />
            <span className="rounded-full border border-litt-line px-2.5 py-0.5 font-litt-mono text-litt-caption text-litt-fg-muted">
              {path.protocol}/{path.ports}
            </span>
            <span className="text-litt-small text-litt-fg-muted">{sourcesText(path)}</span>
          </div>
          {path.outageRisk && (
            <Callout
              tone="warning"
              title="Outage risk during apply"
              description={`The plan replaces ${path.outageRisk.join(", ")} by deleting it before creating the new one. Traffic on this path can drop during the apply. create_before_destroy avoids the gap.`}
            />
          )}
        </header>

        <div className="min-w-0 border border-litt-line p-5">
          <PathStrip before={lanes.before.cells} after={lanes.after.cells} changed={lanes.changed} risk={risk} selected={selected} onSelect={select} />
        </div>

        <section className="grid gap-3" aria-labelledby="hops-title">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="hops-title" className={LABEL}>
              Hops
            </h3>
            <p className="text-litt-caption text-litt-fg-subtle">{changedCount ? `${changedCount} of ${COLUMNS.length} differ` : "No hop differs"}</p>
          </div>
          <ol className="divide-y divide-litt-line border border-litt-line">
            <li aria-hidden="true" className="hidden grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_32px] gap-4 bg-litt-surface-1 px-4 py-2 sm:grid">
              <span className={LABEL}>Hop</span>
              <span className={LABEL}>Before</span>
              <span className={LABEL}>After</span>
              <span />
            </li>
            {COLUMNS.map((c, i) => {
              const b = lanes.before.cells[i];
              const a = lanes.after.cells[i];
              if (!b || !a) return null;
              const isOpen = openRows.has(i);
              const differs = rowDiffers[i];
              return (
                <li
                  key={c.key}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  className={`relative transition-colors duration-200 ${i === selected ? "bg-litt-surface-1" : ""}`}
                >
                  {(differs || i === risk) && <span aria-hidden="true" className="absolute top-0 bottom-0 left-0 w-0.5 bg-litt-warning" />}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setSelected(i);
                      toggle(i);
                    }}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-4 px-4 text-left ${differs ? "py-4" : "py-2.5"} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_32px]`}
                  >
                    <span className="grid gap-0.5">
                      <span className="text-litt-small text-litt-fg">{c.label}</span>
                      {differs && <span className="text-litt-caption text-litt-warning">Differs</span>}
                      {i === risk && <span className="text-litt-caption text-litt-warning">Replaced delete-first</span>}
                      <span className="mt-1 flex items-center gap-2 sm:hidden">
                        <DecisionTag state={b.state} />
                        <ArrowRightIcon aria-label="to" className="size-3 text-litt-fg-subtle" />
                        <DecisionTag state={a.state} />
                      </span>
                    </span>
                    {differs ? (
                      <>
                        <span className="hidden sm:block">
                          <CellView cell={b} />
                        </span>
                        <span className="hidden sm:block">
                          <CellView cell={a} />
                        </span>
                      </>
                    ) : (
                      <span className="hidden sm:col-span-2 sm:block">
                        <CellView cell={a} note="same before and after" />
                      </span>
                    )}
                    <span aria-hidden="true" className={`grid size-6 place-items-center justify-self-end text-litt-fg-subtle transition-transform duration-300 ${EASE} ${isOpen ? "rotate-90" : ""}`}>
                      <ArrowRightIcon className="size-3.5" />
                    </span>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-300 ${EASE} ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="grid gap-6 border-t border-dashed border-litt-line px-4 py-4 sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_32px] sm:gap-4">
                        <span className="hidden sm:block" />
                        <SideDetail title="Before" cell={b} />
                        <SideDetail title="After" cell={a} />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </section>
  );
}
