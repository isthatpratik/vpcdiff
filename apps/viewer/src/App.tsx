import type { Change, Path, Result } from "@vpcdiff/engine";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { analyzeInWorker } from "./engine.ts";
import { EXAMPLES } from "./examples.ts";
import { COLUMNS, lanesOf } from "./graph.ts";
import { ArrowRight, GithubLogo, ShieldCheck, Upload, WarningCircle } from "./icons.tsx";
import { LaneGraph, STATE_LABEL, VERDICT_LABEL } from "./LaneGraph.tsx";

const REPO = "https://github.com/isthatpratik/vpcdiff";
const CHANGE_LABEL: Record<Change, string> = { added: "New exposure", removed: "Closed", changed: "Sources changed", unknown: "Unknown", unchanged: "No change" };
const CHANGE_ORDER: Change[] = ["added", "removed", "changed", "unknown", "unchanged"];
const STAT_LABEL: Record<Change, string> = { added: "Opened", removed: "Closed", changed: "Changed", unknown: "Unknown", unchanged: "Same" };

type State = { kind: "empty"; error?: string } | { kind: "loading"; name: string } | { kind: "ready"; name: string; result: Result };

export function App() {
  const [state, setState] = useState<State>({ kind: "empty" });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    openFile(e.dataTransfer.files[0]);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <a className="skip-link button-sm" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <ShieldCheck size={20} />
          <span className="title-3">vpcdiff</span>
        </div>
        <div className="topbar-right">
          <span className="privacy caption-4 muted" title="The plan is read in this tab and never uploaded">
            <ShieldCheck size={14} />
            <span className="privacy-text">The plan is read in this tab and never uploaded</span>
          </span>
          {state.kind === "ready" && (
            <button type="button" className="btn btn-quiet button-sm" onClick={() => fileInput.current?.click()}>
              <Upload size={16} />
              Open plan
            </button>
          )}
          <a className="icon-link" href={REPO} target="_blank" rel="noreferrer" aria-label="Source code on GitHub">
            <GithubLogo size={20} />
          </a>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <main id="main" className="main" style={{ minHeight: 0, display: "grid" }}>
        {state.kind === "empty" && <Empty error={state.error} dragging={dragging} onPick={() => fileInput.current?.click()} onExample={(id) => {
          const ex = EXAMPLES.find((x) => x.id === id);
          if (ex) void open(`${ex.id}/plan.json`, ex.load());
        }} />}
        {state.kind === "loading" && <Loading />}
        {state.kind === "ready" && <Workspace key={state.name} name={state.name} result={state.result} />}
      </main>
    </div>
  );
}

function Empty({ error, dragging, onPick, onExample }: { error?: string | undefined; dragging: boolean; onPick: () => void; onExample: (id: string) => void }) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <div className="empty-inner">
        <div style={{ display: "grid", gap: "var(--s-200)" }}>
          <h1 id="empty-title" className="heading-3 hero-title">
            See what a Terraform plan
            <br />
            opens to the internet
          </h1>
          <p className="hero-sub body-3 muted">
            Open the JSON form of a plan. vpcdiff compares reachability from the internet before and after the change, and names the rule that decides each hop.
          </p>
        </div>
        <div className={`dropzone${dragging ? " is-over" : ""}`}>
          <div className="dropzone-row">
            <button type="button" className="btn btn-primary button-md" onClick={onPick}>
              <Upload size={20} />
              Open plan file
            </button>
            <span className="body-6 muted">or drop the file anywhere on this page</span>
          </div>
          <code className="snippet">terraform plan -out=tfplan &amp;&amp; terraform show -json tfplan &gt; plan.json</code>
          {error && (
            <div className="error" role="alert">
              <WarningCircle size={16} />
              <span className="body-6">{error}</span>
            </div>
          )}
        </div>
        <div className="examples">
          <h2 className="title-4 muted">Or open an example plan</h2>
          <div className="example-list">
            {EXAMPLES.map((ex) => (
              <button key={ex.id} type="button" className="example" onClick={() => onExample(ex.id)}>
                <span className="title-4">{ex.title}</span>
                <span className="caption-5 muted">{ex.description}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="caption-5 faint">
          Open source under the MIT license. The engine runs in a Web Worker in this tab, and a Content Security Policy blocks every network request from the page. Fonts: Geist, SIL Open Font License.
        </p>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Analyzing the plan">
      <div className="skeleton-col" style={{ borderRight: "1px solid var(--line)" }}>
        {[60, 100, 90, 80, 95, 70].map((w, i) => (
          <div key={i} className="skeleton-bar" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="skeleton-col">
        <div className="skeleton-bar" style={{ width: "40%" }} />
        <div className="skeleton-bar" style={{ height: 240 }} />
      </div>
    </div>
  );
}

function Workspace({ name, result }: { name: string; result: Result }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const visible = useMemo(
    () => result.paths.filter((p) => showUnchanged || p.change !== "unchanged" || p.outageRisk).toSorted((a, b) => CHANGE_ORDER.indexOf(a.change) - CHANGE_ORDER.indexOf(b.change) || (a.id < b.id ? -1 : 1)),
    [result, showUnchanged],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(visible[0]?.id);
  useEffect(() => {
    if (!visible.some((p) => p.id === selectedId)) setSelectedId(visible[0]?.id);
  }, [visible, selectedId]);
  const selected = result.paths.find((p) => p.id === selectedId);

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="Paths">
        <div className="sidebar-head">
          <div className="file-row">
            <span className="file-name title-4 mono" title={name}>
              {name}
            </span>
          </div>
          <div className="stats">
            {CHANGE_ORDER.map((c) => (
              <div key={c} className="stat">
                <span className={`stat-value c-${c}`}>{result.summary[c]}</span>
                <span className="caption-5 muted">{STAT_LABEL[c]}</span>
              </div>
            ))}
          </div>
        </div>
        <label className="toggle body-6">
          <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
          Show unchanged paths ({result.summary.unchanged})
        </label>
        {visible.length ? (
          <ul className="path-list">
            {visible.map((p) => (
              <li key={p.id}>
                <button type="button" className="path-item" aria-current={p.id === selectedId} onClick={() => setSelectedId(p.id)}>
                  <span className="path-top">
                    <span className="path-target title-4">{p.to}</span>
                    <span className={`badge caption-3 c-${p.change}`}>{CHANGE_LABEL[p.change]}</span>
                  </span>
                  {p.outageRisk && <span className="caption-4 c-changed">Outage risk during apply</span>}
                  <span className="path-verdicts caption-5 muted">
                    {p.protocol}/{p.ports}
                    <span aria-hidden="true">·</span>
                    {VERDICT_LABEL[p.before.verdict]}
                    <ArrowRight size={12} aria-label="to" />
                    {VERDICT_LABEL[p.after.verdict]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="list-empty">
            <span className="title-4">No reachability changes from the internet</span>
            <span className="body-6 muted">
              {result.paths.length
                ? "Turn on unchanged paths to see every path the engine checked."
                : "No security group in this plan opens a port to a public address, so there is no internet path to check."}
            </span>
          </div>
        )}
        {result.notes.length > 0 && (
          <details className="notes">
            <summary className="title-5 muted">Not modeled yet ({result.notes.length})</summary>
            <ul className="caption-5 muted">
              {result.notes.map((n) => (
                <li key={n.resource}>
                  <span className="mono">{n.resource}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>
      {selected ? <Detail key={selected.id} path={selected} /> : <section className="detail" aria-label="Path detail" />}
    </div>
  );
}

function Detail({ path }: { path: Path }) {
  const lanes = useMemo(() => lanesOf(path), [path]);
  const [column, setColumn] = useState(lanes.focus);
  const col = COLUMNS[column];
  const sources = path.after.verdict === "allowed" ? path.after.sources : path.before.verdict === "allowed" ? path.before.sources : [];

  return (
    <section className="detail" aria-labelledby="detail-title">
      <div className="detail-head">
        <div className="detail-title">
          <h2 id="detail-title" className="heading-6">
            internet <span className="muted">to</span> <span className="mono">{path.to}</span> <span className="muted">{path.protocol}/{path.ports}</span>
          </h2>
          <span className={`badge caption-3 c-${path.change}`}>{CHANGE_LABEL[path.change]}</span>
        </div>
        <p className="body-6 muted">
          {sources.length ? (
            <>
              Reachable from {sources.length === 1 && sources[0] === "internet" ? "any public address" : <span className="mono">{sources.join(", ")}</span>}
              {path.after.verdict === "allowed" ? " after the plan." : " before the plan only."}
            </>
          ) : (
            "Not reachable from the internet on either side of the plan."
          )}
        </p>
        {path.outageRisk && (
          <div className="risk" role="note">
            <WarningCircle size={16} />
            <span className="body-6">
              The plan replaces <span className="mono">{path.outageRisk.join(", ")}</span> by deleting it before creating the new one. Traffic on this path can drop during the apply. Setting create_before_destroy avoids the gap.
            </span>
          </div>
        )}
      </div>
      <div className="detail-body">
      <div className="canvas">
        <LaneGraph path={path} lanes={lanes} selected={column} onSelect={setColumn} />
      </div>
      <div className="inspector">
        <div className="tabs" role="tablist" aria-label="Hops">
          {COLUMNS.map((c, i) => (
            <button key={c.key} type="button" role="tab" aria-selected={i === column} className={`tab caption-4${lanes.changed[i] ? " is-changed" : ""}`} onClick={() => setColumn(i)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="sides" role="tabpanel" aria-label={col?.label}>
          {(["before", "after"] as const).map((side) => {
            const cell = lanes[side].cells[column];
            if (!cell) return null;
            return (
              <div key={side} className="side">
                <div className="path-top">
                  <span className="title-4">{side === "before" ? "Before" : "After"}</span>
                  <span className={`badge caption-3 d-${cell.state}`}>{STATE_LABEL[cell.state]}</span>
                </div>
                {cell.resource && <span className="caption-4 mono">{cell.resource}</span>}
                <span className="side-rule body-6 muted">{cell.rule || " "}</span>
                {cell.doc && (
                  <a className="doc-link caption-4" href={cell.doc} target="_blank" rel="noreferrer">
                    AWS documentation for this hop
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </section>
  );
}
