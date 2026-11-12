// The viewer (DESIGN.md): open a plan, read every path (from the internet, or inside the VPC) before and after
// it, hop by hop. One review column (ADR 0010): the plan verdict on top, then one card per
// path. An open card holds a path strip that shows the difference at a glance, and one
// hop table where the hops that changed are open and the rest fold to a line. Nothing
// leaves the tab.
import { ENGINE_VERSION, type Path, type Result } from "@vpcdiff/engine";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { Button } from "@/components/litt/button";
import { Tour, VIEWER_TOUR } from "./tour.tsx";
import { ArrowRightIcon, HelpIcon, ArrowUpRightIcon, AtSignIcon, BoxIcon, CloudIcon, DatabaseIcon, FileIcon, FilterIcon, GitBranchIcon, GlobeIcon, LayersIcon, LockIcon, MinusIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/litt/icons";
import { Segmented } from "@/components/litt/segmented";
import { Loading, Skeleton } from "@/components/litt/states";
import { Tooltip, TooltipProvider } from "@/components/litt/tooltip";
import { analyzeInWorker } from "../engine.ts";
import { EXAMPLES } from "../examples.ts";
import { CHANGE_HELP, changeWords, HOP_HELP, hopHelp, pathMarkdown, planMarkdown, planVerdict, portLabel, SCOPE, serviceOf, severityOf, verdictOf, type Tone } from "@vpcdiff/engine/explain";
import { announce, Announcer, CopyButton } from "./copy.tsx";
import { clearPlace, keptFile, placeExample, placeFile, placePath, readPlace } from "./place.ts";
import { isInternet, lanesOf, rowsDiffer, type Cell, type CellState, type Column, type ColumnKey } from "@vpcdiff/engine/lanes";
import { Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeToggle } from "../shared/theme.tsx";
import { CHANGE_TEXT, ChangeTag, DecisionTag } from "./status.tsx";

type State = { kind: "empty"; error?: string } | { kind: "loading"; name: string } | { kind: "ready"; name: string; result: Result; sha256?: string; path?: string };
type Source = { example: string } | { file: true };

/** SHA-256 of the plan text, computed in the tab, so a PR comment can name the exact plan. */
async function sha256(text: string): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}
type Filter = "changes" | "all" | "added" | "removed" | "changed" | "risk" | "unknown";

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const LABEL = "font-litt-mono text-xs tracking-[0.12em] text-litt-fg-subtle uppercase";

export function App() {
  const [state, setState] = useState<State>({ kind: "empty" });
  const [dragging, setDragging] = useState(false);
  // The tour shows the parts of an open plan; from the start screen it opens an example first.
  const [touring, setTouring] = useState<"off" | "waiting" | "on">("off");
  const depth = useRef(0);

  const open = useCallback(async (name: string, text: Promise<string>, source: Source, path?: string) => {
    setState({ kind: "loading", name });
    try {
      const plan = await text;
      const [result, hash] = await Promise.all([analyzeInWorker(plan), sha256(plan)]);
      // Remember where we are, so a reload comes back here (src/app/place.ts).
      if ("example" in source) placeExample(source.example);
      else placeFile(name, plan);
      setState({ kind: "ready", name, result, ...(hash ? { sha256: hash } : {}), ...(path ? { path } : {}) });
    } catch (e) {
      clearPlace();
      setState({ kind: "empty", error: (e as Error).message });
    }
  }, []);
  const openFile = useCallback(
    (file: File | undefined) => {
      if (file) void open(file.name, file.text(), { file: true });
    },
    [open],
  );
  const openExample = useCallback(
    (id: string, path?: string) => {
      const ex = EXAMPLES.find((x) => x.id === id);
      if (ex) void open(`${ex.id}/plan.json`, ex.load(), { example: ex.id }, path);
      else clearPlace();
    },
    [open],
  );

  // On load, and when the address changes (a pasted link, the back button), reopen what
  // the URL or this tab remembers. The viewer's own replaceState does not fire hashchange.
  useEffect(() => {
    const restore = () => {
      const place = readPlace();
      if (place.kind === "example") openExample(place.id, place.path);
      else if (place.kind === "file") {
        const kept = keptFile();
        if (kept) void open(kept.name, Promise.resolve(kept.text), { file: true }, place.path);
        else {
          clearPlace();
          setState({ kind: "empty" });
        }
      } else setState({ kind: "empty" });
    };
    if (readPlace().kind !== "none") restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [open, openExample]);

  useEffect(() => {
    if (touring !== "waiting" || state.kind !== "ready") return;
    // Let the first card open and settle before the spotlight measures it.
    const t = window.setTimeout(() => setTouring("on"), 350);
    return () => window.clearTimeout(t);
  }, [touring, state.kind]);

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
      <Announcer />
      <div className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-litt-canvas" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={(e) => hasFiles(e) && e.preventDefault()} onDrop={onDrop}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[6px] focus:bg-litt-canvas focus:px-3 focus:py-2 focus:text-litt-small focus:text-litt-fg focus:shadow-[inset_0_0_0_1px_var(--litt-line-strong)]">
          Skip to content
        </a>
        <TopBar onTour={() => {
            if (state.kind === "ready") setTouring("on");
            else {
              setTouring("waiting");
              openExample("sg-5432-opened");
            }
          }} name={state.kind === "ready" || state.kind === "loading" ? state.name : undefined} onNew={
            state.kind === "ready"
              ? () => {
                  clearPlace();
                  setState({ kind: "empty" });
                }
              : undefined
          }
        />
        <main id="main" className="min-h-0">
          {state.kind === "empty" && (
            <Start
              error={state.error}
              onFile={openFile}
              onExample={(id) => openExample(id)}
            />
          )}
          {state.kind === "loading" && <Busy />}
          {state.kind === "ready" && <Workspace key={state.name} name={state.name} result={state.result} sha256={state.sha256} initialPath={state.path} />}
        </main>
        {touring === "on" && state.kind === "ready" && <Tour steps={VIEWER_TOUR} onClose={() => setTouring("off")} />}
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

function TopBar({ name, onNew, onTour }: { name?: string | undefined; onNew?: (() => void) | undefined; onTour: () => void }) {
  return (
    <header className="flex h-14 min-w-0 items-center gap-4 border-b border-litt-line px-4 sm:px-5">
      <a href="../" aria-label="vpcdiff home" className="flex shrink-0 items-center rounded-litt-control focus-visible:outline-2 focus-visible:outline-litt-focus">
        <Wordmark size={17} />
      </a>
      {/* The breadcrumb sits 1px lower so its baseline matches the larger wordmark's. */}
      <span aria-hidden="true" className="hidden translate-y-px text-litt-line-strong sm:inline">
        /
      </span>
      {name && (
        <span className="min-w-0 translate-y-px truncate font-litt-mono text-litt-caption text-litt-fg-muted sm:hidden" title={name}>
          {name}
        </span>
      )}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 translate-y-px items-center gap-2 text-litt-small sm:flex">
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
        <Button size="sm" variant="ghost" icon={<HelpIcon />} onClick={onTour} aria-label="Take a tour of the viewer" className="shadow-[inset_0_0_0_1px_var(--litt-line-strong)] hover:bg-litt-surface-2 active:scale-[0.97] motion-reduce:active:scale-100">
          <span className="hidden sm:inline">Tour</span>
        </Button>
        <span data-tour="local" className="hidden h-8 items-center gap-2 rounded-[6px] border border-litt-line px-3 text-litt-caption text-litt-fg-subtle md:inline-flex" title="The plan is read in this tab. It is never uploaded.">
          <LockIcon aria-hidden="true" className="size-3.5" />
          Local only
        </span>
        {onNew && (
          <Button size="sm" variant="ghost" icon={<PlusIcon />} onClick={onNew} className="shadow-[inset_0_0_0_1px_var(--litt-line-strong)] hover:bg-litt-surface-2 transition-[background-color,color,translate,scale,box-shadow] duration-150 active:scale-[0.97] motion-reduce:active:scale-100">
            <span className="sm:hidden">Open</span>
            <span className="hidden sm:inline">Open plan</span>
          </Button>
        )}
        <span className="hidden sm:inline-flex">
          <ThemeToggle className="text-litt-fg-muted hover:bg-litt-surface-2 hover:text-litt-fg" />
        </span>
        <span className="hidden sm:inline-flex">
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
  "sg-ref-opened": "Opened inside the VPC",
  "sg-ref-cut": "Cut inside the VPC",
};
const EXAMPLE_TONE: Record<string, string> = {
  "sg-5432-opened": "border-litt-danger/40 text-litt-danger",
  "sg-replaced": "border-litt-warning/40 text-litt-warning",
  "sg-ref-cut": "border-litt-warning/40 text-litt-warning",
};

function Start({ error, onFile, onExample }: { error?: string | undefined; onFile: (f: File | undefined) => void; onExample: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const steps = ["terraform plan -out=tfplan", "terraform show -json tfplan > plan.json"];
  const choose = useRef<HTMLButtonElement>(null);
  // After a failed open, put focus back on the button, next to the message.
  useEffect(() => {
    if (error) choose.current?.focus();
  }, [error]);
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-[1120px] gap-14 px-5 py-14 sm:px-8 lg:py-20 [&>*]:min-w-0">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [&>*]:min-w-0">
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
              vpcdiff compares what the internet, and resources inside the VPC, can reach before and after a Terraform plan, and names the rule that decides each hop.
            </p>
            <p className="flex items-center gap-2 text-litt-small text-litt-fg-subtle">
              <LockIcon aria-hidden="true" className="size-4" />
              The file is read in this tab. It is never uploaded.
            </p>
          </div>

          <div className="relative grid gap-4">
            <div
              className={`relative grid min-h-[220px] place-items-center overflow-hidden rounded-xl border border-dashed px-6 py-10 sm:min-h-[300px] sm:py-12 text-center transition-colors duration-200 ${over ? "border-litt-fg bg-litt-surface-2" : error ? "border-litt-danger/60 bg-litt-surface-1" : "border-litt-line-strong bg-litt-surface-1"}`}
              onDragEnter={() => setOver(true)}
              onDragLeave={() => setOver(false)}
              onDrop={() => setOver(false)}
            >
              <div aria-hidden="true" className="absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_22%,transparent)_1px,transparent_1.5px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
              <div className="relative grid justify-items-center gap-5">
                <span className="grid size-12 place-items-center rounded-lg border border-litt-line-strong bg-litt-canvas text-litt-fg">
                  <FileIcon aria-hidden="true" />
                </span>
                <div className="grid gap-1.5">
                  <p className="font-display text-xl font-normal tracking-[-0.02em] text-litt-fg">Drop plan.json here</p>
                  <p className="text-litt-small text-litt-fg-subtle">The output of terraform show -json</p>
                </div>
                <Button ref={choose} variant="primary" onClick={() => input.current?.click()} className="transition-[background-color,color,translate,scale,box-shadow] duration-150 active:scale-[0.97] motion-reduce:active:scale-100">
                  Choose a file
                </Button>
                {error && (
                  <p role="alert" className="max-w-[44ch] text-litt-small leading-relaxed text-litt-danger">
                    That file could not be read. {error}
                  </p>
                )}
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
            <div className="grid gap-2 px-1">
              <p className={LABEL}>Make the file</p>
              <ol className="grid gap-1">
                {steps.map((c, i) => (
                  <li key={c} className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full border border-litt-line-strong font-litt-mono text-[11px] text-litt-fg-subtle">
                      {i + 1}
                    </span>
                    <code className="min-w-0 flex-1 font-litt-mono text-litt-caption [overflow-wrap:anywhere] text-litt-fg">{c}</code>
                    <CopyButton text={c} what={`step ${i + 1}`} label={`Copy step ${i + 1}`} side="left" />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <section className="grid gap-5" aria-labelledby="examples">
          <h2 id="examples" className={LABEL}>
            Or open an example plan
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <li key={ex.id} className="rounded-xl border border-litt-line bg-litt-canvas transition-colors duration-200 hover:border-litt-line-strong">
                <button
                  type="button"
                  onClick={() => onExample(ex.id)}
                  className={`group grid h-full w-full content-start gap-8 rounded-xl p-5 text-left transition-[background-color,scale] duration-300 ${EASE} hover:bg-litt-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus active:scale-[0.99] active:bg-litt-surface-2 motion-reduce:active:scale-100`}
                >
                  <span className={`justify-self-start rounded-[4px] border px-2 py-0.5 text-litt-caption ${EXAMPLE_TONE[ex.id] ?? "border-litt-line text-litt-fg-muted"}`}>{EXAMPLE_TAG[ex.id]}</span>
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
    <Loading label="Analyzing the plan" className="h-full overflow-hidden">
      <div className="mx-auto grid max-w-[1040px] content-start gap-6 px-4 py-6 sm:px-8 sm:py-10">
        <div className="grid gap-2">
          <Skeleton text="h2" className="w-64" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-full" radius="surface" />
        <Skeleton className="h-[480px] w-full" radius="surface" />
        <Skeleton className="h-14 w-full" radius="surface" />
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
  const Icon = type === "aws_db_instance" || type === "aws_rds_cluster_instance" ? DatabaseIcon : type === "aws_lb" || type === "aws_elb" ? LayersIcon : BoxIcon;
  return <Icon aria-hidden="true" className={`shrink-0 text-litt-fg-subtle ${className}`} />;
}
const TYPE_NAME: Record<string, string> = { aws_instance: "EC2 instance", aws_db_instance: "RDS database", aws_lb: "Load balancer", aws_rds_cluster_instance: "Aurora instance", aws_ecs_service: "ECS service", aws_elb: "Classic Load Balancer" };

/** A word with a dotted underline that explains itself on hover or focus. */
function Term({ children, help }: { children: ReactNode; help: string }) {
  return (
    <Tooltip content={help}>
      <span tabIndex={0} className="cursor-help underline decoration-transparent decoration-dotted underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-litt-fg-subtle focus-visible:decoration-litt-fg-subtle focus-visible:outline-2 focus-visible:outline-litt-focus">
        {children}
      </span>
    </Tooltip>
  );
}

function sourcesOf(path: Path): string[] {
  return path.after.verdict === "allowed" ? path.after.sources : path.before.verdict === "allowed" ? path.before.sources : [];
}

function Workspace({ name, result, sha256: hash, initialPath }: { name: string; result: Result; sha256?: string | undefined; initialPath?: string | undefined }) {
  const remembered = initialPath ? result.paths.find((p) => p.id === initialPath) : undefined;
  // A remembered path that the Changes view hides opens with All, so it stays open.
  const [filter, setFilter] = useState<Filter>(remembered && remembered.change === "unchanged" && !remembered.outageRisk?.length ? "all" : "changes");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.paths
      .filter((p) => (filter === "all" ? true : filter === "changes" ? p.change !== "unchanged" || p.outageRisk : filter === "risk" ? p.outageRisk?.length : p.change === filter))
      .filter((p) => !q || [p.from, p.to, p.toType, `${p.protocol}/${p.ports}`, serviceOf(p.ports) ?? "", ...sourcesOf(p)].some((s) => s.toLowerCase().includes(q)))
      .toSorted((a, b) => severityOf(a) - severityOf(b) || (a.id < b.id ? -1 : 1));
  }, [result, filter, query]);
  // Paths are cards in one column. The most serious one starts open; more can be open at
  // once. The URL remembers the card opened last (src/app/place.ts).
  const first = remembered?.id ?? visible[0]?.id;
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(first ? [first] : []));
  const [lastOpened, setLastOpened] = useState<string | undefined>(first);
  // Also after a new result: opening a plan rewrites the hash without the path.
  useEffect(() => placePath(lastOpened), [lastOpened, result]);
  // When a filter or search changes the list and no shown card is open, open the first one,
  // so a counter click always lands on a detail. Closing the last card yourself does not
  // reopen it: this runs only when the list changes.
  const shown = useRef(visible);
  useEffect(() => {
    if (shown.current === visible) return;
    shown.current = visible;
    const top = visible[0];
    if (top && !visible.some((p) => openIds.has(p.id))) {
      setOpenIds((s) => new Set(s).add(top.id));
      setLastOpened(top.id);
    }
  }, [visible, openIds]);
  const toggle = (id: string) => {
    const opening = !openIds.has(id);
    setOpenIds((s) => {
      const n = new Set(s);
      if (opening) n.add(id);
      else n.delete(id);
      return n;
    });
    if (opening) setLastOpened(id);
    else if (lastOpened === id) setLastOpened([...openIds].find((x) => x !== id));
  };
  const unchanged = result.paths.filter((p) => p.change === "unchanged" && !p.outageRisk).length;
  const risky = result.paths.filter((p) => p.outageRisk?.length).length;
  const list = useRef<HTMLUListElement>(null);
  const [notesOpen, setNotesOpen] = useState("");
  // After a plan opens, move focus to the plan verdict and say what it found.
  useEffect(() => {
    document.getElementById("plan-title")?.focus({ preventScroll: true });
    const pv0 = planVerdict(result);
    announce(`Plan opened. ${result.paths.length} ${result.paths.length === 1 ? "path" : "paths"} checked. ${pv0.title}: ${pv0.detail}.`);
  }, [result]);
  const notesRef = useRef<HTMLDivElement>(null);
  // A remembered path further down the list comes into view after a reload.
  const rememberedId = remembered?.id;
  useEffect(() => {
    if (rememberedId) list.current?.querySelector(`[data-id="${CSS.escape(rememberedId)}"]`)?.scrollIntoView({ block: "start" });
  }, [rememberedId]);

  // Up, Down, Home, and End move between the card headers.
  const onKey = (e: KeyboardEvent) => {
    const heads = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button[data-id]") ?? []);
    const i = heads.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? heads.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    heads[Math.min(heads.length - 1, Math.max(0, to))]?.focus();
  };

  const counters: { key: Filter; label: string; value: number; tone: string; help: string }[] = [
    { key: "added", label: "Opened", value: result.summary.added, tone: CHANGE_TEXT.added, help: CHANGE_HELP.added },
    { key: "removed", label: "Closed", value: result.summary.removed, tone: CHANGE_TEXT.removed, help: CHANGE_HELP.removed },
    { key: "changed", label: "Changed", value: result.summary.changed, tone: CHANGE_TEXT.changed, help: CHANGE_HELP.changed },
    { key: "risk", label: "Outage risk", value: risky, tone: "text-litt-warning", help: CHANGE_HELP.outage },
    { key: "unknown", label: "Unknown", value: result.summary.unknown, tone: CHANGE_TEXT.unknown, help: CHANGE_HELP.unknown },
  ];
  const pv = planVerdict(result);
  const only = counters.find((c) => c.key === filter);

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="mx-auto grid max-w-[1040px] gap-6 px-4 py-6 sm:px-8 sm:py-10 [&>*]:min-w-0">
        {/* The plan: what to do with the pull request, then the counts as filters. */}
        <header className="grid gap-5" aria-labelledby="plan-title">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div data-tour="plan" className="grid min-w-0 gap-1.5">
              <h1 id="plan-title" tabIndex={-1} className="flex items-center gap-2.5 font-display text-2xl leading-tight font-normal tracking-[-0.02em] text-litt-fg outline-none">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${TONE_BAR[pv.tone]}`} />
                {pv.title}
              </h1>
              <p className="flex flex-wrap items-center gap-x-1.5 pl-5 text-litt-small text-litt-fg-muted">
                <span>{pv.detail}.</span>
                <span className="text-litt-fg-subtle">Checks {SCOPE} only.</span>
                {result.notes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setNotesOpen("notes");
                      window.setTimeout(() => notesRef.current?.scrollIntoView({ block: "nearest" }), 0);
                    }}
                    className="text-litt-warning underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-litt-focus"
                  >
                    {result.notes.length} {result.notes.length === 1 ? "resource" : "resources"} not modeled
                  </button>
                )}
              </p>
            </div>
            <span data-tour="copy-all"><CopyButton variant="text" label="Copy all for PR" what="the plan summary for the pull request" text={() => planMarkdown(name, result, { version: ENGINE_VERSION, ...(hash ? { sha256: hash } : {}) })} /></span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div data-tour="counts" role="group" aria-label="Counts. Choose one to show only those paths." className="flex flex-wrap gap-1.5">
              {counters.map((c) => {
                const on = filter === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    disabled={!c.value}
                    aria-pressed={on}
                    onClick={() => setFilter(on ? "changes" : c.key)}
                    title={c.help}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-litt-caption transition-[background-color,box-shadow,scale] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-litt-fg enabled:hover:bg-litt-surface-2 enabled:active:scale-[0.97] disabled:cursor-default ${on ? "bg-litt-surface-2 shadow-[inset_0_0_0_1px_var(--litt-fg-subtle)]" : "shadow-[inset_0_0_0_1px_var(--litt-line)]"}`}
                  >
                    <span className={`font-medium tabular-nums ${c.value ? c.tone : "text-litt-fg-subtle"}`}>{c.value}</span>
                    <span className={c.value ? "text-litt-fg-muted" : "text-litt-fg-subtle"}>{c.label}</span>
                  </button>
                );
              })}
            </div>
            <div data-tour="view" className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <p id="filter-help" className="sr-only">
                Changes lists only paths the plan opens, closes, or puts at risk. All paths lists every path the engine checked.
              </p>
              <Tooltip content="Changes: only paths the plan opens, closes, or puts at risk. All paths: every path the engine checked.">
                <div className="shrink-0">
                  <Segmented<Filter>
                    legend="Show"
                    size="sm"
                    value={filter === "all" ? "all" : "changes"}
                    onValueChange={setFilter}
                    options={[
                      { value: "changes", label: "Changes" },
                      { value: "all", label: `All · ${result.paths.length}` },
                    ]}
                  />
                </div>
              </Tooltip>
              {result.paths.length > 0 && (
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-litt-line-strong px-2.5 focus-within:border-litt-fg-subtle focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-litt-fg sm:w-56 sm:flex-none">
                  <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-litt-fg-subtle" />
                  <span className="sr-only">Filter paths by resource, port, or CIDR</span>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by resource, port, CIDR" className="h-full min-w-0 flex-1 bg-transparent text-litt-small text-litt-fg outline-none placeholder:text-litt-fg-subtle" />
                </label>
              )}
            </div>
          </div>
          {only && (
            <p className="flex items-center gap-2 text-litt-caption text-litt-fg-muted">
              <span>
                Showing <span className="text-litt-fg">{only.label.toLowerCase()}</span> only
              </span>
              <button type="button" onClick={() => setFilter("changes")} className="rounded-[6px] px-1.5 py-0.5 text-litt-fg-subtle underline underline-offset-4 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-fg">
                Show all changes
              </button>
            </p>
          )}
        </header>

        {/* The paths, most serious first, then what the list leaves out, then the notes. */}
        <section aria-label="Paths" className="grid gap-3">
          {visible.length ? (
            <>
              {visible.length > 1 && (
                <div className="flex items-center justify-between gap-3 px-1">
                  <h2 className="text-litt-caption text-litt-fg-subtle">
                    {visible.length} paths, most serious first
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      const all = visible.every((p) => openIds.has(p.id));
                      setOpenIds(all ? new Set() : new Set(visible.map((p) => p.id)));
                      setLastOpened(all ? undefined : visible[0]?.id);
                    }}
                    className="rounded-[6px] px-1.5 py-0.5 text-litt-caption text-litt-fg-muted underline decoration-litt-line-strong underline-offset-4 transition-colors duration-200 hover:text-litt-fg hover:decoration-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus"
                  >
                    {visible.every((p) => openIds.has(p.id)) ? "Close all" : "Open all"}
                  </button>
                </div>
              )}
              <ul ref={list} onKeyDown={onKey} className="grid gap-3">
                {visible.map((p, n) => (
                  <li key={p.id} {...(n === 0 ? { "data-tour": "card" } : {})}>
                    <PathCard path={p} open={openIds.has(p.id)} onToggle={() => toggle(p.id)} />
                  </li>
                ))}
              </ul>
              <p className="px-1 text-litt-caption leading-relaxed text-litt-fg-subtle">
                {visible.length} of {result.paths.length} {result.paths.length === 1 ? "path" : "paths"} shown.
                {filter !== "all" && unchanged > 0 && ` All also lists the ${unchanged} that ${unchanged === 1 ? "does" : "do"} not change.`}
              </p>
            </>
          ) : (
            <div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-litt-line-strong p-6">
              <span aria-hidden="true" className="mb-1 grid size-10 place-items-center rounded-lg border border-litt-line-strong text-litt-fg-subtle">
                <ShieldIcon className="size-5" />
              </span>
              <p className="text-litt-small font-medium text-litt-fg">{query ? "No path matches" : result.paths.length ? "No path changes" : "No path to check"}</p>
              <p className="max-w-[68ch] text-litt-small leading-relaxed text-litt-fg-muted">
                {query
                  ? "Try a resource name, a port such as 5432, or a CIDR."
                  : result.paths.length
                    ? `This plan does not change any path. All shows the ${unchanged} the engine checked.`
                    : "No security group in this plan opens a port to a public address or to another group in the plan, so there is no path to check."}
                {!query && result.notes.length > 0 && ` ${result.notes.length} ${result.notes.length === 1 ? "resource is" : "resources are"} not modeled yet, so check ${result.notes.length === 1 ? "it" : "them"} by hand.`}
              </p>
              {!query && result.paths.length > 0 && filter !== "all" && (
                <Button size="sm" variant="ghost" onClick={() => setFilter("all")} className="mt-1 shadow-[inset_0_0_0_1px_var(--litt-line-strong)] hover:bg-litt-surface-2 active:scale-[0.97] motion-reduce:active:scale-100">
                  Show all {result.paths.length} paths
                </Button>
              )}
            </div>
          )}
        </section>
        {result.notes.length > 0 && (
          <div ref={notesRef} className="rounded-xl border border-litt-line px-5">
            <Accordion type="single" collapsible headingLevel={2} value={notesOpen} onValueChange={setNotesOpen}>
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
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One path: a header row that says what changes, and, when open, the verdict and the
 * evidence. The header of an open card stays at the top while its detail scrolls by.
 */
function PathCard({ path, open, onToggle }: { path: Path; open: boolean; onToggle: () => void }) {
  const v = verdictOf(path);
  const src = sourcesOf(path);
  const body = `path-${path.id}`;
  const inside = !isInternet(path);
  const label = path.change === "unchanged" ? (path.outageRisk?.length ? "Outage risk" : "No change") : ((inside && INSIDE_WORD[path.change]) || CHANGE_WORD[path.change]);
  return (
    <article className={`rounded-xl border transition-colors duration-200 ${open ? "border-litt-line-strong" : "border-litt-line hover:border-litt-line-strong"}`} aria-labelledby={`${body}-title`}>
      <h2 id={`${body}-title`} className={`sticky top-0 z-20 rounded-t-xl bg-litt-canvas ${open ? "border-b border-litt-line" : "rounded-b-xl"}`}>
        <button
          type="button"
          data-id={path.id}
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
          className={`group flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-litt-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus sm:px-5 ${open ? "rounded-t-xl" : "rounded-xl"}`}
        >
          <ArrowRightIcon aria-hidden="true" className={`size-3.5 shrink-0 text-litt-fg-subtle transition-transform duration-300 ${EASE} group-hover:text-litt-fg motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          <span className="grid min-w-0 flex-1 gap-0.5 sm:flex sm:items-center sm:gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <TargetIcon type={path.toType} className="size-4" />
              {!inside && <span className="sr-only">internet to </span>}
              <span className="truncate font-litt-mono text-litt-small text-litt-fg">{inside ? <>{path.from} <span aria-hidden="true" className="text-litt-fg-subtle">→</span><span className="sr-only">to</span> {path.to}</> : path.to}</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 pl-6 font-litt-mono text-litt-caption text-litt-fg-muted sm:pl-0">
              <span>{portLabel(path)}</span>
              {path.family === "ipv6" && <span className="rounded-[4px] border border-litt-line px-1.5 font-sans text-litt-fg-muted">IPv6</span>}
              {inside ? <span className="font-sans text-litt-fg-subtle">inside the VPC</span> : src.length > 0 && <span className="text-litt-fg-subtle">from {src.includes("internet") ? (path.family === "ipv6" ? "::/0" : "0.0.0.0/0") : src.join(", ")}</span>}
            </span>
          </span>
          <span className="hidden shrink-0 text-litt-caption text-litt-fg-subtle md:inline">{changeWords(path)}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-litt-caption text-litt-fg">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_BAR[v.tone]}`} />
            {label}
          </span>
        </button>
      </h2>
      {/* Mounted only while open, so a long plan stays light; the detail settles in. */}
      <div id={body} hidden={!open}>
        {open && <PathBody path={path} />}
      </div>
    </article>
  );
}

const CHANGE_WORD: Partial<Record<Path["change"], string>> = { added: "Opened", removed: "Closed", changed: "Sources changed", unknown: "Unknown" };
/** Inside the VPC a closed path is usually traffic the application needs, so it reads "Cut". */
const INSIDE_WORD: Partial<Record<Path["change"], string>> = { removed: "Cut" };

/* --------------------------------------------------------------- detail */

/**
 * One shape per state, so the strip reads without color: filled lets through, a slash
 * blocks, half filled is some sources, dashed amber is unknown, a hollow box was not
 * checked, and a dotted box is not in the plan on that side.
 */
const SQUARE: Record<CellState, string> = {
  allow: "bg-litt-fg border-litt-fg",
  partial: "border-litt-fg bg-[linear-gradient(to_right,var(--litt-fg)_50%,var(--litt-canvas)_50%)]",
  deny: "border-litt-fg bg-litt-canvas bg-[linear-gradient(to_top_right,transparent_calc(50%-0.75px),var(--litt-fg)_calc(50%-0.75px),var(--litt-fg)_calc(50%+0.75px),transparent_calc(50%+0.75px))]",
  unknown: "border-dashed border-litt-warning bg-litt-canvas",
  "not-reached": "border-litt-fg-subtle bg-litt-canvas",
  absent: "border-dotted border-litt-fg-subtle bg-litt-canvas",
};

const HOP_ICON: Partial<Record<ColumnKey, typeof GlobeIcon>> = {
  source: GlobeIcon,
  "public-ip": AtSignIcon,
  "internet-gateway": CloudIcon,
  "nacl-inbound": FilterIcon,
  "security-group": ShieldIcon,
  "nacl-outbound": FilterIcon,
  route: GitBranchIcon,
  "source-security-group": ShieldIcon,
  "source-route": GitBranchIcon,
  "source-nacl-outbound": FilterIcon,
  "target-nacl-inbound": FilterIcon,
  "target-nacl-outbound": FilterIcon,
  "source-nacl-inbound": FilterIcon,
  "target-route": GitBranchIcon,
  firewall: ShieldIcon,
};

function HopName({ col, type, fromType, help, className = "" }: { col: Column; type: string; fromType?: string | undefined; help: string; className?: string }) {
  const Icon = HOP_ICON[col.key];
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {col.key === "target" ? <TargetIcon type={type} className="size-4" /> : col.key === "source" && fromType ? <TargetIcon type={fromType} className="size-4" /> : Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-litt-fg-subtle" /> : null}
      <Term help={help}>{col.label}</Term>
    </span>
  );
}

function Legend({ risk }: { risk: boolean }) {
  const items: [CellState, string][] = [
    ["allow", "Lets through"],
    ["deny", "Blocks"],
    ["partial", "Some sources"],
    ["unknown", "Unknown"],
    ["not-reached", "Not checked"],
    ["absent", "Not in plan"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-litt-caption text-litt-fg-subtle" aria-label="Legend">
      {items.map(([s, l]) => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-3 border ${SQUARE[s]}`} />
          {l}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-litt-fg/10" />
        Changed
      </li>
      {risk && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-litt-warning/20" />
          Outage risk
        </li>
      )}
    </ul>
  );
}

/** Before and after, one square per hop, so the change reads at once. Rows on wide
 *  screens; one line per hop on small screens, so every hop stays visible. */
function PathStrip({ path, columns, before, after, differs, risk, selected, onSelect }: { path: Path; columns: Column[]; before: Cell[]; after: Cell[]; differs: boolean[]; risk: number; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="grid gap-5">
      <p className="text-litt-caption text-litt-fg-subtle">Traffic goes left to right. Every hop must let it through.</p>
      <div className="hidden sm:block" role="group" aria-label="Path at a glance, before and after">
        <div className="grid items-center gap-y-3" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))` }}>
          <span />
          {columns.map((c, i) => (
            <button key={c.key} type="button" title={c.label} onClick={() => onSelect(i)} className={`px-1 text-center text-litt-caption leading-tight text-balance transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus ${i === selected ? "text-litt-fg" : "text-litt-fg-subtle hover:text-litt-fg"}`}>
              {c.label}
            </button>
          ))}
          {(["before", "after"] as const).map((side) => (
            <Fragment key={side}>
              <span className="text-litt-caption text-litt-fg-subtle">{side === "before" ? "Before" : "After"}</span>
              {(side === "before" ? before : after).map((cell, i) => (
                <span key={i} className="relative flex h-5 items-center justify-center">
                  {(differs[i] || i === risk) && <span aria-hidden="true" className={`absolute inset-x-[18%] -inset-y-1.5 ${side === "before" ? "rounded-t-[4px]" : "rounded-b-[4px]"} ${i === risk ? "bg-litt-warning/15" : "bg-litt-fg/[0.08]"}`} />}
                  {i > 0 && <span aria-hidden="true" className={`absolute right-1/2 left-[-50%] h-px ${cell.state === "not-reached" || cell.state === "absent" ? "bg-litt-line" : "bg-litt-line-strong"}`} />}
                  <span aria-hidden="true" className={`relative z-10 size-3.5 border transition-colors duration-300 ${SQUARE[cell.state]}`} />
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
        {columns.map((c, i) => (
          <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_48px_48px] items-center">
            <HopName col={c} type={path.toType} fromType={path.fromType} help={hopHelp(path, c.key)} className="text-litt-small text-litt-fg" />
            {[before[i], after[i]].map((cell, j) => (
              <span key={j} className="flex justify-center">
                <span aria-hidden="true" className={`size-3 border ${cell ? SQUARE[cell.state] : ""} ${j === 1 && differs[i] ? "outline outline-1 outline-offset-2 outline-litt-fg-muted" : ""}`} />
              </span>
            ))}
          </li>
        ))}
      </ol>
      <Legend risk={risk >= 0} />
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
  return (
    <section data-tour="verdict" aria-label="Verdict" className="grid gap-4 rounded-xl border border-litt-line bg-litt-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <p className="font-display text-xl font-normal tracking-[-0.01em] text-litt-fg">{v.title}</p>
          <p className="max-w-[68ch] text-base leading-relaxed text-litt-fg">{v.body}</p>
          {v.doubt && (
            <p className="max-w-[68ch] text-litt-small leading-relaxed text-litt-fg-muted">
              <span className="font-medium text-litt-warning">Partly undecided · </span>
              {v.doubt}. vpcdiff does not count these sources as allowed or blocked.
            </p>
          )}
        </div>
        <CopyButton variant="text" label="Copy for PR" what="this path for the pull request" text={() => pathMarkdown(path)} />
      </div>
      {v.cause && v.cause.rule && (
        <div className="grid gap-1.5 border-t border-litt-line pt-4">
          <p className="text-litt-caption text-litt-fg-subtle">
            Decided at the <Term help={HOP_HELP[lanesOf(path).columns.find((c) => c.label === v.cause?.hop)?.key ?? "target"]}>{v.cause.hop}</Term> hop
          </p>
          <p className="flex min-w-0 items-start gap-2 font-litt-mono text-litt-small text-litt-fg">
            <span className="min-w-0 break-words">{v.cause.rule}</span>
            <CopyButton text={v.cause.rule} what="the rule" />
          </p>
        </div>
      )}
      {v.action && (
        <div className="grid gap-2 border-t border-litt-line pt-4">
          <p className="text-litt-caption text-litt-fg-subtle">What to do</p>
          <p className="max-w-[72ch] text-litt-small leading-relaxed text-litt-fg">{v.action}</p>
          {v.snippet && (
            <div className="flex items-start gap-2 justify-self-start">
              <pre className="rounded-md border border-litt-line bg-litt-canvas px-3 py-2 font-litt-mono text-litt-caption text-litt-fg">{v.snippet}</pre>
              <CopyButton text={v.snippet} what="the fix" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PathBody({ path }: { path: Path }) {
  const lanes = useMemo(() => lanesOf(path), [path]);
  const oneSideAbsent = path.before.verdict === "absent" || path.after.verdict === "absent";
  // A row differs when its two cells differ; when the resource exists on one side only,
  // every hop is new, so rows show the side that exists instead of marking each one.
  const cols = lanes.columns;
  const differs = oneSideAbsent ? cols.map(() => false) : rowsDiffer(lanes);
  const changedCount = differs.filter(Boolean).length;
  // Hops whose rule or decision changed, as opposed to hops that are simply checked now
  // because an earlier hop stopped blocking (or not checked because one started to).
  const reachedBoth = (i: number) => lanes.before.cells[i]?.state !== "not-reached" && lanes.after.cells[i]?.state !== "not-reached";
  const ruleChanges = differs.filter((d, i) => d && reachedBoth(i)).length;
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
    window.setTimeout(() => {
      const row = rows.current[i];
      row?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // Move focus with the view, so keyboard users land on the hop they chose.
      row?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    }, 0);
  };
  const toggle = (i: number) =>
    setOpenRows((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const sideShown = path.before.verdict === "absent" ? "after" : "before";
  const sameRows = cols.map((_, i) => i).filter((i) => !differs[i]);
  const hideSame = changedCount > 0 && !showSame;

  return (
    <div className="grid animate-[detail-in_260ms_cubic-bezier(0.22,1,0.36,1)] gap-5 p-4 motion-reduce:animate-none sm:p-5 [&>*]:min-w-0">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-litt-caption text-litt-fg-subtle">
          <span className="flex items-center gap-2">
            <TargetIcon type={path.toType} className="size-4" />
            {TYPE_NAME[path.toType] ?? path.toType}
          </span>
          {path.change !== "unchanged" && isInternet(path) ? <ChangeTag change={path.change} /> : <span className={`rounded-[4px] border border-litt-line px-2 py-0.5 ${TONE_TEXT[verdictOf(path).tone]}`}>{path.change === "unchanged" ? "Outage risk" : verdictOf(path).title}</span>}
          <span className="text-litt-small md:hidden">{changeWords(path)}</span>
        </p>
        <VerdictPanel path={path} />

        {/* One evidence panel: the strip at a glance, then the hops in full. */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-litt-line" aria-labelledby="hops-title">
          <div data-tour="strip" className="p-5">
            <PathStrip path={path} columns={cols} before={lanes.before.cells} after={lanes.after.cells} differs={differs} risk={risk} selected={selected} onSelect={select} />
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-litt-line bg-litt-surface-1 px-5 py-3">
            <h3 id="hops-title" className="text-litt-small font-medium text-litt-fg">
              Hops
            </h3>
            <p className="text-litt-caption text-litt-fg-subtle">
              {oneSideAbsent
                ? path.before.verdict === "absent"
                  ? "The plan creates this resource: every hop is new."
                  : "The plan destroys this resource: every hop goes away."
                : changedCount
                  ? `${ruleChanges} ${ruleChanges === 1 ? "hop changed" : "hops changed"}${changedCount > ruleChanges ? ` · ${changedCount - ruleChanges} more ${changedCount - ruleChanges === 1 ? "is" : "are"} now checked or skipped` : ""}`
                  : risk >= 0
                    ? `No hop changes. The ${cols[risk]?.label ?? ""} hop is replaced delete-first.`
                    : "No hop differs"}
            </p>
          </div>
          <ol data-tour="hops" className="divide-y divide-litt-line border-t border-litt-line">
            <li aria-hidden="true" className="hidden grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] gap-4 px-5 py-2 text-litt-caption text-litt-fg-subtle sm:grid">
              <span>Hop</span>
              <span>Before</span>
              <span>After</span>
              <span />
            </li>
            {cols.map((c, i) => {
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
                  className={`relative transition-colors duration-200 ${i === risk ? "bg-litt-warning/[0.06]" : row ? "bg-litt-fg/[0.03]" : ""}`}
                >
                  {/* The whole row opens and closes on click. The arrow button stays the keyboard and
                      screen reader control, so the row itself is not a second tab stop. */}
                  <div
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button")) return;
                      if (window.getSelection()?.toString()) return;
                      setSelected(i);
                      toggle(i);
                    }}
                    className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_32px] items-center gap-4 px-5 transition-colors duration-150 hover:bg-litt-fg/[0.03] sm:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] ${row ? "py-3.5" : "py-2.5"}`}
                  >
                    <span className="grid min-w-0 gap-1">
                      <HopName col={c} type={path.toType} fromType={path.fromType} help={hopHelp(path, c.key)} className="text-litt-small text-litt-fg" />
                      {(row || i === risk) && (
                        <span className="ml-6 justify-self-start">
                          <span className={`rounded-[4px] border px-1.5 py-px text-litt-caption ${i === risk ? "border-litt-warning/40 text-litt-warning" : "border-litt-line-strong text-litt-fg-muted"}`}>{i === risk ? "Replaced delete-first" : "Changed"}</span>
                        </span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-2 pl-6 sm:hidden">
                        {only ? (
                          <DecisionTag state={only.state} />
                        ) : (
                          <>
                            <DecisionTag state={b.state} />
                            <ArrowRightIcon aria-hidden="true" className="size-3 text-litt-fg-subtle" />
                            <span className="sr-only">to</span>
                            <DecisionTag state={a.state} />
                          </>
                        )}
                      </span>
                    </span>
                    {only ? (
                      <>
                        <span className="hidden sm:block">
                          <span className="sr-only">Before: </span>
                          {sideShown === "after" ? <DecisionTag state="absent" /> : <CellView cell={only} />}
                        </span>
                        <span className="hidden sm:block">
                          <span className="sr-only">After: </span>
                          {sideShown === "after" ? <CellView cell={only} /> : <DecisionTag state="absent" />}
                        </span>
                      </>
                    ) : row ? (
                      <>
                        <span className="hidden sm:block">
                          <span className="sr-only">Before: </span>
                          <CellView cell={b} />
                        </span>
                        <span className="hidden sm:block">
                          <span className="sr-only">After: </span>
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
                      aria-controls={`hop-rule-${i}`}
                      aria-label={`${isOpen ? "Hide" : "Show"} the rule for ${c.label}`}
                      onClick={() => {
                        setSelected(i);
                        toggle(i);
                      }}
                      className={`grid size-8 place-items-center justify-self-end rounded-litt-control text-litt-fg-subtle transition-[transform,color,background-color] duration-300 ${EASE} hover:bg-litt-surface-2 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                    >
                      <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                  {/* Closed rows are inert, so keyboard focus never lands on a hidden link. */}
                  <div id={`hop-rule-${i}`} inert={!isOpen} className={`grid transition-[grid-template-rows] duration-300 ${EASE} motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="grid gap-5 border-t border-dashed border-litt-line px-5 py-4 sm:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_32px] sm:gap-4">
                        <span className="hidden text-litt-caption leading-relaxed text-litt-fg-subtle sm:block">{hopHelp(path, c.key)}</span>
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
                <button type="button" aria-expanded={showSame} onClick={() => setShowSame((v) => !v)} className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-litt-caption text-litt-fg-muted transition-colors duration-200 hover:bg-litt-surface-1 hover:text-litt-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus">
                  {showSame ? <MinusIcon aria-hidden="true" className="size-3.5" /> : <PlusIcon aria-hidden="true" className="size-3.5" />}
                  {showSame ? "Hide the hops that are the same" : `Show ${sameRows.length} hops that are the same before and after`}
                </button>
              </li>
            )}
          </ol>
        </section>
    </div>
  );
}
