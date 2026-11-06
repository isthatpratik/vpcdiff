// The viewer (DESIGN.md): open a plan, read every path from the internet before and after
// it, hop by hop. The layout gives the most room to the change itself: a path strip that
// shows the difference at a glance, and one hop table where the hops that changed are
// open and the rest fold to a line. Nothing leaves the tab.
import type { Path, Result } from "@vpcdiff/engine";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { Button } from "@/components/litt/button";
import { Callout } from "@/components/litt/callout";
import { ArrowRightIcon, ArrowUpRightIcon, AtSignIcon, BoxIcon, CheckIcon, CloudIcon, CopyIcon, DatabaseIcon, FileIcon, FilterIcon, GitBranchIcon, GlobeIcon, LayersIcon, LockIcon, MinusIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/litt/icons";
import { Segmented } from "@/components/litt/segmented";
import { Loading, Skeleton } from "@/components/litt/states";
import { Tooltip, TooltipProvider } from "@/components/litt/tooltip";
import { analyzeInWorker } from "../engine.ts";
import { EXAMPLES } from "../examples.ts";
import { CHANGE_HELP, HOP_HELP, pathMarkdown, planMarkdown, portLabel, serviceOf, verdictOf, type Tone } from "@vpcdiff/engine/explain";
import { COLUMNS, lanesOf, rowsDiffer, type Cell, type CellState, type ColumnKey } from "@vpcdiff/engine/lanes";
import { Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeSwitch } from "../shared/theme.tsx";
import { CHANGE_ORDER, CHANGE_TEXT, ChangeTag, DecisionTag, VERDICT_LABEL } from "./status.tsx";

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
          {state.kind === "ready" && <Workspace key={state.name} name={state.name} result={state.result} />}
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

/** What each example shows, as the same status words the viewer uses. */
const EXAMPLE_TAG: Record<string, string> = {
  "sg-5432-opened": "New exposure",
  "nacl-denies-ssh": "Blocked by a network ACL",
  "rule-resources": "Some sources only",
  "sg-replaced": "Outage risk",
};
const EXAMPLE_TONE: Record<string, string> = {
  "sg-5432-opened": "border-litt-danger/40 text-litt-danger",
  "sg-replaced": "border-litt-warning/40 text-litt-warning",
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
              className={`relative grid min-h-[220px] place-items-center overflow-hidden border border-dashed px-6 py-10 sm:min-h-[300px] sm:py-12 text-center transition-colors duration-200 ${over ? "border-litt-fg bg-litt-surface-2" : "border-litt-line-strong"}`}
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
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-litt-mono text-litt-caption text-litt-fg-muted">{cmd}</code>
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
                  <span className={`justify-self-start rounded-full border px-2.5 py-0.5 text-litt-caption ${EXAMPLE_TONE[ex.id] ?? "border-litt-line text-litt-fg-muted"}`}>{EXAMPLE_TAG[ex.id]}</span>
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

const TONE_TEXT: Record<Tone, string> = { danger: "text-litt-danger", success: "text-litt-success", warning: "text-litt-warning", neutral: "text-litt-fg" };
const TONE_BAR: Record<Tone, string> = { danger: "bg-litt-danger", success: "bg-litt-success", warning: "bg-litt-warning", neutral: "bg-litt-line-strong" };

/**
 * A small line icon for the kind of target, from the same set as the hop icons. AWS's
 * own service logos are filled tiles that read as blocks at 16px and bring their brand
 * colors, so they are not used here (DESIGN.md, icons).
 */
function TargetIcon({ type, className = "" }: { type: string; className?: string }) {
  const Icon = type === "aws_db_instance" ? DatabaseIcon : type === "aws_lb" ? LayersIcon : BoxIcon;
  return <Icon aria-hidden="true" className={`shrink-0 text-litt-fg-subtle ${className}`} />;
}
const TYPE_NAME: Record<string, string> = { aws_instance: "EC2 instance", aws_db_instance: "RDS database", aws_lb: "Load balancer" };

/** A word with a dotted underline that explains itself on hover or focus. */
function Term({ children, help }: { children: ReactNode; help: string }) {
  return (
    <Tooltip content={help}>
      <span tabIndex={0} className="cursor-help underline decoration-litt-line-strong decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-litt-focus">
        {children}
      </span>
    </Tooltip>
  );
}

function sourcesOf(path: Path): string[] {
  return path.after.verdict === "allowed" ? path.after.sources : path.before.verdict === "allowed" ? path.before.sources : [];
}

function Workspace({ name, result }: { name: string; result: Result }) {
  const [filter, setFilter] = useState<Filter>("changes");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.paths
      .filter((p) => filter === "all" || p.change !== "unchanged" || p.outageRisk)
      .filter((p) => !q || [p.to, p.toType, `${p.protocol}/${p.ports}`, serviceOf(p.ports) ?? "", ...sourcesOf(p)].some((s) => s.toLowerCase().includes(q)))
      .toSorted((a, b) => CHANGE_ORDER.indexOf(a.change) - CHANGE_ORDER.indexOf(b.change) || (a.id < b.id ? -1 : 1));
  }, [result, filter, query]);
  const [selectedId, setSelectedId] = useState<string | undefined>(visible[0]?.id);
  useEffect(() => {
    if (!visible.some((p) => p.id === selectedId)) setSelectedId(visible[0]?.id);
  }, [visible, selectedId]);
  const selected = result.paths.find((p) => p.id === selectedId);
  const unchanged = result.paths.filter((p) => p.change === "unchanged" && !p.outageRisk).length;
  const risky = result.paths.filter((p) => p.outageRisk?.length).length;
  const list = useRef<HTMLUListElement>(null);
  const [copied, setCopied] = useState(false);

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

  const counters: { key: string; label: string; value: number; tone: string; help: string }[] = [
    { key: "added", label: "Opened", value: result.summary.added, tone: CHANGE_TEXT.added, help: CHANGE_HELP.added },
    { key: "removed", label: "Closed", value: result.summary.removed, tone: CHANGE_TEXT.removed, help: CHANGE_HELP.removed },
    { key: "changed", label: "Changed", value: result.summary.changed, tone: CHANGE_TEXT.changed, help: CHANGE_HELP.changed },
    { key: "risk", label: "At risk", value: risky, tone: "text-litt-warning", help: CHANGE_HELP.outage },
    { key: "unknown", label: "Unknown", value: result.summary.unknown, tone: CHANGE_TEXT.unknown, help: CHANGE_HELP.unknown },
  ];

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-auto md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden">
      <aside className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] border-b border-litt-line md:border-r md:border-b-0" aria-label="Paths">
        <dl className="grid grid-cols-5 gap-px border-b border-litt-line bg-litt-line">
          {counters.map((c) => (
            <div key={c.key} className="grid content-start gap-1.5 bg-litt-canvas px-3 py-4">
              <dd className={`font-display text-2xl leading-none font-normal tabular-nums ${c.value ? c.tone : "text-litt-fg-subtle"}`}>{c.value}</dd>
              <dt className="text-litt-caption text-litt-fg-subtle">
                <Term help={c.help}>{c.label}</Term>
              </dt>
            </div>
          ))}
        </dl>
        <div className="grid gap-2.5 border-b border-litt-line p-4">
          <Tooltip content="Changes: only paths the plan opens, closes, or puts at risk. All paths: every path from the internet the engine checked.">
            <div>
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
          </Tooltip>
          {result.paths.length > 5 && (
            <label className="flex items-center gap-2 rounded-litt-control border border-litt-line px-2.5 focus-within:border-litt-line-strong">
              <SearchIcon aria-hidden="true" className="size-4 text-litt-fg-subtle" />
              <span className="sr-only">Filter paths</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by resource, port, or CIDR" className="h-8 min-w-0 flex-1 bg-transparent text-litt-small text-litt-fg outline-none placeholder:text-litt-fg-subtle" />
            </label>
          )}
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
              <p className="text-litt-small font-medium text-litt-fg">{query ? "No path matches" : "No changes from the internet"}</p>
              <p className="text-litt-small leading-relaxed text-litt-fg-muted">
                {query
                  ? "Try a resource name, a port such as 5432, or a CIDR."
                  : result.paths.length
                    ? `This plan does not change any path from the internet. All paths shows the ${unchanged} the engine checked.`
                    : "No security group in this plan opens a port to a public address, so there is no path from the internet to check."}
              </p>
            </div>
          )}
        </div>
        <div className="grid gap-1 border-t border-litt-line px-4 py-3">
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(planMarkdown(name, result)).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              })
            }
            className="flex items-center gap-2 justify-self-start rounded-litt-control py-1 text-litt-small text-litt-fg-muted transition-colors duration-200 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-4"
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied the summary" : "Copy plan summary as Markdown"}
          </button>
          {result.notes.length > 0 && (
            <Accordion type="single" collapsible headingLevel={2}>
              <AccordionItem value="notes">
                <AccordionTrigger>Not modeled yet · {result.notes.length}</AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-2.5 pb-3">
                    {result.notes.map((n) => (
                      <li key={n.resource} className="grid gap-0.5">
                        <span className="font-litt-mono text-litt-caption text-litt-fg">{n.resource}</span>
                        <span className="text-litt-caption leading-relaxed text-litt-fg-muted">{n.message}</span>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </aside>
      {selected ? <PathDetail key={selected.id} path={selected} /> : <section aria-label="Path detail" />}
    </div>
  );
}

function PathRow({ path, current, onSelect }: { path: Path; current: boolean; onSelect: () => void }) {
  const v = verdictOf(path);
  const src = sourcesOf(path);
  return (
    <button
      type="button"
      data-id={path.id}
      aria-current={current}
      tabIndex={current ? 0 : -1}
      onClick={onSelect}
      className={`relative grid w-full gap-1.5 px-5 py-3.5 text-left transition-colors duration-200 hover:bg-litt-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus ${current ? "bg-litt-surface-1" : ""}`}
    >
      <span aria-hidden="true" className={`absolute top-0 bottom-0 left-0 w-0.5 transition-opacity duration-200 ${TONE_BAR[v.tone]} ${current ? "opacity-100" : "opacity-0"}`} />
      <span className="flex min-w-0 items-center gap-2.5">
        <TargetIcon type={path.toType} className="size-4" />
        <span className="truncate font-litt-mono text-litt-small text-litt-fg">{path.to}</span>
        <span className={`ml-auto shrink-0 text-litt-caption ${TONE_TEXT[v.tone]}`}>{v.title === "No change" ? "No change" : CHANGE_WORD[path.change] ?? v.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 pl-[26px] text-litt-caption text-litt-fg-subtle">
        <span className="font-litt-mono">{portLabel(path)}</span>
        {src.length > 0 && <span className="font-litt-mono">from {src.includes("internet") ? "0.0.0.0/0" : src.join(", ")}</span>}
      </span>
      {path.outageRisk && <span className="pl-[26px] text-litt-caption text-litt-warning">Outage risk during apply</span>}
    </button>
  );
}

const CHANGE_WORD: Partial<Record<Path["change"], string>> = { added: "Opened", removed: "Closed", changed: "Sources changed", unknown: "Unknown" };

/* --------------------------------------------------------------- detail */

const SQUARE: Record<CellState, string> = {
  allow: "bg-litt-fg border-litt-fg",
  partial: "bg-litt-warning border-litt-warning",
  deny: "bg-litt-data-rose border-litt-data-rose",
  unknown: "border-dashed border-litt-fg-subtle bg-litt-canvas",
  "not-reached": "border-litt-line-strong bg-litt-canvas",
  absent: "border-dashed border-litt-line-strong bg-litt-canvas",
};

const HOP_ICON: Partial<Record<ColumnKey, typeof GlobeIcon>> = {
  source: GlobeIcon,
  "public-ip": AtSignIcon,
  "internet-gateway": CloudIcon,
  "nacl-inbound": FilterIcon,
  "security-group": ShieldIcon,
  "nacl-outbound": FilterIcon,
  route: GitBranchIcon,
};

function HopName({ col, type, className = "" }: { col: (typeof COLUMNS)[number]; type: string; className?: string }) {
  const Icon = HOP_ICON[col.key];
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {col.key === "target" ? <TargetIcon type={type} className="size-4" /> : Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-litt-fg-subtle" /> : null}
      <Term help={HOP_HELP[col.key]}>{col.label}</Term>
    </span>
  );
}

function Legend() {
  const items: [CellState, string][] = [
    ["allow", "Lets through"],
    ["deny", "Blocks"],
    ["partial", "Some sources"],
    ["not-reached", "Not checked"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-litt-caption text-litt-fg-subtle" aria-label="Legend">
      {items.map(([s, l]) => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-2.5 border ${SQUARE[s]}`} />
          {l}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-0.5 w-2.5 bg-litt-fg-muted" />
        Differs
      </li>
    </ul>
  );
}

/** Before and after, one square per hop, so the change reads at once. Rows on wide
 *  screens; one line per hop on small screens, so every hop stays visible. */
function PathStrip({ before, after, differs, risk, selected, onSelect, type }: { before: Cell[]; after: Cell[]; differs: boolean[]; risk: number; selected: number; onSelect: (i: number) => void; type: string }) {
  return (
    <div className="grid gap-5">
      <div className="hidden sm:block" role="group" aria-label="Path at a glance, before and after">
        <div className="grid grid-cols-[64px_repeat(8,minmax(0,1fr))] items-center gap-y-3">
          <span />
          {COLUMNS.map((c, i) => (
            <button key={c.key} type="button" onClick={() => onSelect(i)} className={`truncate px-1 text-center text-litt-caption transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus ${i === selected ? "text-litt-fg" : "text-litt-fg-subtle hover:text-litt-fg"}`}>
              {c.label}
            </button>
          ))}
          {(["before", "after"] as const).map((side) => (
            <Fragment key={side}>
              <span className="text-litt-caption text-litt-fg-subtle">{side === "before" ? "Before" : "After"}</span>
              {(side === "before" ? before : after).map((cell, i) => (
                <span key={i} className="relative flex h-5 items-center justify-center">
                  {i > 0 && <span aria-hidden="true" className={`absolute right-1/2 left-[-50%] h-px ${cell.state === "not-reached" || cell.state === "absent" ? "bg-litt-line" : "bg-litt-line-strong"}`} />}
                  <span aria-hidden="true" className={`relative z-10 size-3 border transition-colors duration-300 ${SQUARE[cell.state]}`} />
                  {(differs[i] || i === risk) && side === "after" && <span aria-hidden="true" className={`absolute -bottom-2.5 h-0.5 w-3 ${i === risk ? "bg-litt-warning" : "bg-litt-fg-muted"}`} />}
                </span>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <ol className="grid gap-2 sm:hidden" aria-label="Path at a glance, before and after">
        <li aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_48px_48px] text-litt-caption text-litt-fg-subtle">
          <span />
          <span className="text-center">Before</span>
          <span className="text-center">After</span>
        </li>
        {COLUMNS.map((c, i) => (
          <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_48px_48px] items-center">
            <HopName col={c} type={type} className="text-litt-small text-litt-fg" />
            {[before[i], after[i]].map((cell, j) => (
              <span key={j} className="flex justify-center">
                <span aria-hidden="true" className={`size-3 border ${cell ? SQUARE[cell.state] : ""} ${j === 1 && differs[i] ? "outline outline-1 outline-offset-2 outline-litt-fg-muted" : ""}`} />
              </span>
            ))}
          </li>
        ))}
      </ol>
      <Legend />
    </div>
  );
}

function CellView({ cell, note }: { cell: Cell; note?: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="shrink-0">
        <DecisionTag state={cell.state} />
      </span>
      {cell.resource && <span className="truncate font-litt-mono text-litt-caption text-litt-fg-muted">{cell.resource}</span>}
      {note && <span className="shrink-0 text-litt-caption text-litt-fg-subtle">{note}</span>}
    </div>
  );
}

function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : (label ?? `Copy ${text}`)}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        })
      }
      className="grid size-6 shrink-0 place-items-center rounded-litt-control text-litt-fg-subtle transition-colors duration-200 hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-3.5"
    >
      {done ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </button>
  );
}

/** One side of an open hop: the rule that decided it, the resource, the AWS docs. */
function SideDetail({ title, cell }: { title: string; cell: Cell }) {
  return (
    <div className="grid content-start gap-2">
      <p className="text-litt-caption text-litt-fg-subtle">{title}</p>
      {cell.rule && <p className="text-litt-small leading-relaxed text-litt-fg">{cell.rule}</p>}
      {cell.doc && (
        <a href={cell.doc} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 justify-self-start text-litt-caption text-litt-fg-muted underline decoration-litt-line-strong underline-offset-4 transition-colors duration-200 hover:text-litt-fg hover:decoration-litt-fg">
          How AWS decides this hop <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </a>
      )}
    </div>
  );
}

/** The answer first: what happens, what caused it, what to do. */
function VerdictPanel({ path }: { path: Path }) {
  const v = verdictOf(path);
  const [copied, setCopied] = useState(false);
  return (
    <section aria-label="Verdict" className="relative grid gap-4 border border-litt-line bg-litt-surface-1 p-5 pl-6">
      <span aria-hidden="true" className={`absolute top-0 bottom-0 left-0 w-0.5 ${TONE_BAR[v.tone]}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <p className={`font-display text-xl font-normal tracking-[-0.01em] ${TONE_TEXT[v.tone]}`}>{v.title}</p>
          <p className="max-w-[68ch] text-base leading-relaxed text-litt-fg">{v.body}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(pathMarkdown(path)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            })
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-litt-control border border-litt-line px-2.5 py-1 text-litt-caption text-litt-fg-muted transition-colors duration-200 hover:border-litt-line-strong hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus [&_svg]:size-3.5"
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? "Copied" : "Copy for PR"}
        </button>
      </div>
      {v.cause && v.cause.rule && (
        <div className="grid gap-1.5 border-t border-litt-line pt-4">
          <p className="text-litt-caption text-litt-fg-subtle">
            Decided at the <Term help={HOP_HELP[COLUMNS.find((c) => c.label === v.cause?.hop)?.key ?? "target"]}>{v.cause.hop}</Term> hop
          </p>
          <p className="flex min-w-0 items-start gap-2 font-litt-mono text-litt-small text-litt-fg">
            <span className="min-w-0 break-words">{v.cause.rule}</span>
            <CopyText text={v.cause.rule} label="Copy the rule" />
          </p>
        </div>
      )}
      {v.action && (
        <div className="grid gap-2 border-t border-litt-line pt-4">
          <p className="text-litt-small leading-relaxed text-litt-fg-muted">
            <span className="text-litt-fg">What to do · </span>
            {v.action}
          </p>
          {v.snippet && <pre className="justify-self-start rounded-litt-control border border-litt-line bg-litt-canvas px-3 py-2 font-litt-mono text-litt-caption text-litt-fg">{v.snippet}</pre>}
        </div>
      )}
    </section>
  );
}

function PathDetail({ path }: { path: Path }) {
  const lanes = useMemo(() => lanesOf(path), [path]);
  const oneSideAbsent = path.before.verdict === "absent" || path.after.verdict === "absent";
  // A row differs when its two cells differ; when the resource exists on one side only,
  // every hop is new, so rows show the side that exists instead of marking each one.
  const differs = oneSideAbsent ? COLUMNS.map(() => false) : rowsDiffer(lanes);
  const changedCount = differs.filter(Boolean).length;
  // On a path with outage risk, the focus hop is the one the plan replaces delete-first.
  const risk = path.outageRisk?.length ? lanes.focus : -1;
  const [selected, setSelected] = useState(lanes.focus);
  const [openRows, setOpenRows] = useState<Set<number>>(() => new Set([lanes.focus]));
  const [showSame, setShowSame] = useState(false);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const select = (i: number) => {
    setSelected(i);
    if (!differs[i] && changedCount) setShowSame(true);
    setOpenRows((s) => new Set(s).add(i));
    window.setTimeout(() => rows.current[i]?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  };
  const toggle = (i: number) =>
    setOpenRows((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const sideShown = path.before.verdict === "absent" ? "after" : "before";
  const sameRows = COLUMNS.map((_, i) => i).filter((i) => !differs[i]);
  const hideSame = changedCount > 0 && !showSame;

  return (
    <section className="min-h-0 min-w-0 overflow-auto" aria-labelledby="detail-title">
      <div className="mx-auto grid max-w-[1040px] gap-8 px-5 py-8 sm:px-10 sm:py-10 [&>*]:min-w-0">
        <header className="grid gap-3">
          <p className="flex items-center gap-2 text-litt-caption text-litt-fg-subtle">
            <TargetIcon type={path.toType} className="size-4" />
            {TYPE_NAME[path.toType] ?? path.toType}
          </p>
          <h2 id="detail-title" className="font-display text-2xl leading-tight font-normal tracking-[-0.02em] text-litt-fg sm:text-3xl">
            <span className="text-litt-fg-subtle">internet → </span>
            <span className="font-litt-mono text-[0.85em] break-all">{path.to}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {path.change !== "unchanged" ? <ChangeTag change={path.change} /> : <span className={`rounded-full border border-litt-line px-2.5 py-0.5 text-litt-caption ${TONE_TEXT[verdictOf(path).tone]}`}>{verdictOf(path).title}</span>}
            <span className="rounded-full border border-litt-line px-2.5 py-0.5 font-litt-mono text-litt-caption text-litt-fg-muted">{portLabel(path)}</span>
            <span className="text-litt-small text-litt-fg-subtle">
              {VERDICT_LABEL[path.before.verdict]} → <span className="text-litt-fg">{VERDICT_LABEL[path.after.verdict]}</span>
            </span>
          </div>
        </header>

        <VerdictPanel path={path} />

        <div className="min-w-0 border border-litt-line p-5">
          <PathStrip before={lanes.before.cells} after={lanes.after.cells} differs={differs} risk={risk} selected={selected} onSelect={select} type={path.toType} />
        </div>

        <section className="grid gap-3" aria-labelledby="hops-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 id="hops-title" className="font-display text-lg font-normal text-litt-fg">
              Hops
            </h3>
            <p className="text-litt-caption text-litt-fg-subtle">
              {oneSideAbsent
                ? path.before.verdict === "absent"
                  ? "The plan creates this resource: every hop is new."
                  : "The plan destroys this resource: every hop goes away."
                : changedCount
                  ? `${changedCount} of ${COLUMNS.length} hops differ`
                  : "No hop differs"}
            </p>
          </div>
          <ol className="divide-y divide-litt-line border border-litt-line">
            <li aria-hidden="true" className="hidden grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] gap-4 bg-litt-surface-1 px-4 py-2 text-litt-caption text-litt-fg-subtle sm:grid">
              <span>Hop</span>
              <span>Before</span>
              <span>After</span>
              <span />
            </li>
            {COLUMNS.map((c, i) => {
              const b = lanes.before.cells[i];
              const a = lanes.after.cells[i];
              if (!b || !a) return null;
              if (hideSame && !differs[i] && i !== selected) return null;
              const isOpen = openRows.has(i);
              const row = differs[i];
              const only = oneSideAbsent ? (sideShown === "after" ? a : b) : undefined;
              return (
                <li
                  key={c.key}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  className={`relative transition-colors duration-200 ${i === selected ? "bg-litt-surface-1" : ""}`}
                >
                  {(row || i === risk) && <span aria-hidden="true" className={`absolute top-0 bottom-0 left-0 w-0.5 ${i === risk ? "bg-litt-warning" : "bg-litt-fg-muted"}`} />}
                  <div className={`grid grid-cols-[minmax(0,1fr)_32px] items-center gap-4 px-4 sm:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] ${row ? "py-3.5" : "py-2.5"}`}>
                    <span className="grid min-w-0 gap-1">
                      <HopName col={c} type={path.toType} className="text-litt-small text-litt-fg" />
                      {row && <span className="pl-6 text-litt-caption text-litt-fg-muted">Differs</span>}
                      {i === risk && <span className="pl-6 text-litt-caption text-litt-warning">Replaced delete-first</span>}
                      <span className="mt-1 flex flex-wrap items-center gap-2 pl-6 sm:hidden">
                        {only ? (
                          <DecisionTag state={only.state} />
                        ) : (
                          <>
                            <DecisionTag state={b.state} />
                            <ArrowRightIcon aria-label="to" className="size-3 text-litt-fg-subtle" />
                            <DecisionTag state={a.state} />
                          </>
                        )}
                      </span>
                    </span>
                    {only ? (
                      <>
                        <span className="hidden sm:block">{sideShown === "after" ? <DecisionTag state="absent" /> : <CellView cell={only} />}</span>
                        <span className="hidden sm:block">{sideShown === "after" ? <CellView cell={only} /> : <DecisionTag state="absent" />}</span>
                      </>
                    ) : row ? (
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
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} the rule for ${c.label}`}
                      onClick={() => {
                        setSelected(i);
                        toggle(i);
                      }}
                      className={`grid size-8 place-items-center justify-self-end rounded-litt-control text-litt-fg-subtle transition-[transform,color,background-color] duration-300 ${EASE} hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus ${isOpen ? "rotate-90" : ""}`}
                    >
                      <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                  <div className={`grid transition-[grid-template-rows] duration-300 ${EASE} ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="grid gap-5 border-t border-dashed border-litt-line px-4 py-4 sm:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] sm:gap-4">
                        <span className="hidden text-litt-caption leading-relaxed text-litt-fg-subtle sm:block">{HOP_HELP[c.key]}</span>
                        {only ? (
                          <span className="sm:col-span-2">
                            <SideDetail title={sideShown === "after" ? "After" : "Before"} cell={only} />
                          </span>
                        ) : (
                          <>
                            <SideDetail title="Before" cell={b} />
                            <SideDetail title="After" cell={a} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {changedCount > 0 && sameRows.length > 0 && (
              <li>
                <button type="button" onClick={() => setShowSame((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-litt-caption text-litt-fg-muted transition-colors duration-200 hover:bg-litt-surface-1 hover:text-litt-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus">
                  {showSame ? <MinusIcon aria-hidden="true" className="size-3.5" /> : <PlusIcon aria-hidden="true" className="size-3.5" />}
                  {showSame ? "Hide the hops that are the same" : `Show ${sameRows.length} hops that are the same before and after`}
                </button>
              </li>
            )}
          </ol>
        </section>
      </div>
    </section>
  );
}
