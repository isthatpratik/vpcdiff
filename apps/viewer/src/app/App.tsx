import type { Change, Path, Result } from "@vpcdiff/engine";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { Button } from "@/components/litt/button";
import { Callout } from "@/components/litt/callout";
import { CodeBlock } from "@/components/litt/code-block";
import { Details, DetailsItem, DetailsLink } from "@/components/litt/details";
import { FileDrop } from "@/components/litt/file-drop";
import { Header } from "@/components/litt/header";
import { ArrowRightIcon, LockIcon, PlusIcon } from "@/components/litt/icons";
import { ScrollArea } from "@/components/litt/scroll-area";
import { Segmented } from "@/components/litt/segmented";
import { Empty, Loading, Skeleton } from "@/components/litt/states";
import { TooltipProvider } from "@/components/litt/tooltip";
import { analyzeInWorker } from "../engine.ts";
import { EXAMPLES } from "../examples.ts";
import { COLUMNS, lanesOf } from "../graph.ts";
import { REPO, Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeSwitch } from "../shared/theme.tsx";
import { LaneGraph } from "./LaneGraph.tsx";
import { CHANGE_ORDER, CHANGE_TEXT, ChangeTag, DecisionTag, STAT_LABEL, VERDICT_LABEL } from "./status.tsx";

type State = { kind: "empty"; error?: string } | { kind: "loading"; name: string } | { kind: "ready"; name: string; result: Result };
type Filter = "changes" | "all";

export function App() {
  const [state, setState] = useState<State>({ kind: "empty" });

  const open = useCallback(async (name: string, text: Promise<string>) => {
    setState({ kind: "loading", name });
    try {
      const result = await analyzeInWorker(await text);
      setState({ kind: "ready", name, result });
    } catch (e) {
      setState({ kind: "empty", error: (e as Error).message });
    }
  }, []);
  const openFile = useCallback((file: File | undefined) => {
    if (file) void open(file.name, file.text());
  }, [open]);

  return (
    <TooltipProvider>
      <div className="grid h-dvh grid-rows-[auto_1fr]">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">
          Skip to content
        </a>
        <Header
          wordmark={<Wordmark size={18} />}
          links={[
            { label: "Overview", href: "../" },
            { label: "Viewer", href: "./", current: true },
            { label: "Source", href: REPO },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-litt-caption text-litt-fg-subtle md:flex" title="The plan is read in this tab and never uploaded">
                <LockIcon aria-hidden="true" />
                Stays on this device
              </span>
              {state.kind === "ready" && (
                <Button size="sm" variant="secondary" icon={<PlusIcon />} onClick={() => setState({ kind: "empty" })}>
                  Open plan
                </Button>
              )}
              <ThemeSwitch />
              <GithubLink />
            </div>
          }
        />
        <main id="main" className="min-h-0">
          {state.kind === "empty" && <Start error={state.error} onFile={openFile} onExample={(id) => {
            const ex = EXAMPLES.find((x) => x.id === id);
            if (ex) void open(`${ex.id}/plan.json`, ex.load());
          }} />}
          {state.kind === "loading" && <Busy />}
          {state.kind === "ready" && <Workspace key={state.name} name={state.name} result={state.result} />}
        </main>
      </div>
    </TooltipProvider>
  );
}

function Start({ error, onFile, onExample }: { error?: string | undefined; onFile: (f: File | undefined) => void; onExample: (id: string) => void }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-3xl gap-8 px-6 py-16">
        <div className="grid gap-3">
          <h1 className="font-display text-4xl font-medium tracking-[-0.03em] text-litt-fg">Open a Terraform plan</h1>
          <p className="max-w-[60ch] text-base text-litt-fg-muted">
            vpcdiff compares what the internet can reach before and after the plan, and names the rule that decides each hop. The file is read in this tab and is never uploaded.
          </p>
        </div>
        <FileDrop label="Plan JSON" accept={[".json", "application/json"]} multiple={false} onFiles={(files) => onFile(files[0])} hint="The output of terraform show -json. Drop it here, or choose a file." />
        {error && <Callout tone="danger" title="That file could not be read" description={error} live />}
        <CodeBlock lang="shell" filename="Make the file" code={"terraform plan -out=tfplan\nterraform show -json tfplan > plan.json"} />
        <section className="grid gap-3" aria-labelledby="examples">
          <h2 id="examples" className="text-litt-small font-medium text-litt-fg-muted">
            Or open an example plan
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => onExample(ex.id)}
                  className="group grid h-full w-full gap-1 rounded-litt-surface border border-litt-line bg-litt-surface-1 p-4 text-left transition-colors duration-200 hover:bg-litt-surface-2 focus-visible:outline-2 focus-visible:outline-litt-focus active:scale-[0.99]"
                >
                  <span className="flex items-center justify-between gap-2 text-litt-small font-medium text-litt-fg">
                    {ex.title}
                    <ArrowRightIcon aria-hidden="true" className="text-litt-fg-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                  <span className="text-litt-caption text-litt-fg-subtle">{ex.description}</span>
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
    <Loading label="Analyzing the plan" className="grid h-full grid-cols-1 md:grid-cols-[300px_1fr]">
      <div className="grid content-start gap-3 border-b border-litt-line p-4 md:border-r md:border-b-0">
        <Skeleton text="h3" className="w-2/3" />
        <Skeleton className="h-14 w-full" radius="surface" />
        <Skeleton className="h-14 w-full" radius="surface" />
        <Skeleton className="h-14 w-full" radius="surface" />
      </div>
      <div className="grid content-start gap-3 p-6">
        <Skeleton text="h2" className="w-1/2" />
        <Skeleton className="h-80 w-full" radius="surface" />
      </div>
    </Loading>
  );
}

function Workspace({ name, result }: { name: string; result: Result }) {
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
  const hidden = result.paths.length - visible.length;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-auto md:grid-cols-[300px_1fr] md:overflow-hidden">
      <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] border-b border-litt-line bg-litt-surface-1 md:border-r md:border-b-0" aria-label="Paths">
        <div className="grid gap-4 border-b border-litt-line p-4">
          <p className="truncate font-litt-mono text-litt-small text-litt-fg" title={name}>
            {name}
          </p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-litt-small">
            {CHANGE_ORDER.map((c) => (
              <div key={c} className="flex items-baseline gap-1.5">
                <dd className={`font-display text-lg font-medium tabular-nums ${result.summary[c] ? CHANGE_TEXT[c] : "text-litt-fg-subtle"}`}>{result.summary[c]}</dd>
                <dt className="text-litt-fg-subtle">{STAT_LABEL[c]}</dt>
              </div>
            ))}
          </dl>
        </div>
        <div className="border-b border-litt-line px-4 py-3">
          <Segmented<Filter>
            legend="Show"
            size="sm"
            block
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "changes", label: "Changes" },
              { value: "all", label: `All paths (${result.paths.length})` },
            ]}
          />
        </div>
        <ScrollArea label="Paths" className="min-h-0">
          {visible.length ? (
            <ul className="grid gap-1 p-2">
              {visible.map((p) => (
                <li key={p.id}>
                  <PathRow path={p} current={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No reachability changes from the internet" bare className="p-4">
              {result.paths.length
                ? `Nothing changes. Switch to All paths to see the ${hidden} paths the engine checked.`
                : "No security group in this plan opens a port to a public address, so there is no internet path to check."}
            </Empty>
          )}
        </ScrollArea>
        {result.notes.length > 0 && (
          <div className="border-t border-litt-line px-4">
            <Accordion type="single" collapsible headingLevel={2}>
              <AccordionItem value="notes">
                <AccordionTrigger>Not modeled yet ({result.notes.length})</AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-1 pb-2">
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

function PathRow({ path, current, onSelect }: { path: Path; current: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={current}
      onClick={onSelect}
      className={`grid w-full gap-1.5 rounded-litt-control px-3 py-2.5 text-left transition-colors duration-200 hover:bg-litt-surface-2 focus-visible:outline-2 focus-visible:outline-litt-focus ${current ? "bg-litt-surface-2 shadow-[inset_0_0_0_1px_var(--litt-line-strong)]" : ""}`}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate font-litt-mono text-litt-small text-litt-fg">{path.to}</span>
        <ChangeTag change={path.change} />
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-litt-caption text-litt-fg-subtle">
        <span className="font-litt-mono">
          {path.protocol}/{path.ports}
        </span>
        <span aria-hidden="true">·</span>
        {VERDICT_LABEL[path.before.verdict]}
        <ArrowRightIcon aria-label="to" className="size-3" />
        {VERDICT_LABEL[path.after.verdict]}
      </span>
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

function PathDetail({ path }: { path: Path }) {
  const lanes = useMemo(() => lanesOf(path), [path]);
  const [column, setColumn] = useState(lanes.focus);
  const col = COLUMNS[column];
  const change: Change = path.change;

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]" aria-labelledby="detail-title">
      <header className="grid gap-2 border-b border-litt-line px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="detail-title" className="font-display text-lg font-medium tracking-[-0.01em] text-litt-fg">
            <span className="text-litt-fg-subtle">internet to</span> <span className="font-litt-mono">{path.to}</span>{" "}
            <span className="font-litt-mono text-litt-fg-subtle">
              {path.protocol}/{path.ports}
            </span>
          </h2>
          <ChangeTag change={change} />
          <p className="text-litt-small text-litt-fg-muted">{sourcesText(path)}</p>
        </div>
        {path.outageRisk && (
          <Callout
            tone="warning"
            title="Outage risk during apply"
            description={`The plan replaces ${path.outageRisk.join(", ")} by deleting it before creating the new one. Traffic on this path can drop during the apply. create_before_destroy avoids the gap.`}
          />
        )}
      </header>
      <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative h-[560px] xl:h-auto" role="region" aria-label="Hop graph">
          <LaneGraph path={path} lanes={lanes} selected={column} onSelect={setColumn} />
        </div>
        <div className="grid min-h-0 content-start gap-4 overflow-auto border-t border-litt-line bg-litt-surface-1 p-4 xl:border-t-0 xl:border-l">
          <div className="grid gap-2">
            <p className="text-litt-caption text-litt-fg-subtle">Hop · before → after</p>
            <ol className="flex flex-wrap gap-1.5" aria-label="Hops">
              {COLUMNS.map((c, i) => (
                <li key={c.key}>
                  <button
                    type="button"
                    aria-current={i === column}
                    onClick={() => setColumn(i)}
                    className={`inline-flex items-center gap-1.5 rounded-litt-pill px-2.5 py-1 text-litt-caption transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-litt-focus ${
                      i === column ? "bg-litt-fg text-litt-canvas" : "bg-litt-surface-2 text-litt-fg-muted hover:text-litt-fg"
                    }`}
                  >
                    {lanes.changed[i] && <span className="size-1.5 rounded-full bg-litt-warning" aria-label="differs" />}
                    {c.label}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          {(["before", "after"] as const).map((side) => {
            const cell = lanes[side].cells[column];
            if (!cell) return null;
            return (
              <Details key={side} title={`${side === "before" ? "Before" : "After"}: ${col?.label ?? ""}`} headingLevel="h3">
                <DetailsItem label="Decision">
                  <DecisionTag state={cell.state} />
                </DetailsItem>
                <DetailsItem label="Resource" mono copy={cell.resource || undefined} empty="None">
                  {cell.resource || undefined}
                </DetailsItem>
                <DetailsItem label="Rule">{cell.rule || undefined}</DetailsItem>
                {cell.doc && (
                  <DetailsItem label="AWS documentation">
                    <DetailsLink href={cell.doc} target="_blank" rel="noreferrer">
                      Read how this hop works
                    </DetailsLink>
                  </DetailsItem>
                )}
              </Details>
            );
          })}
        </div>
      </div>
    </section>
  );
}
