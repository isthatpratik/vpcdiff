// Landing page hero: a pull request changes one CIDR, vpcdiff's check finds the new
// path from the internet and explains it hop by hop. A fix commit is the visible cause
// that returns the scene to its opening frame. Built with the Stageshow kit; see
// references in ~/.claude/skills/stageshow (framing: wide hero with a satellite).
import { Bar, Collapse, Count, Roll, Spinner, Stage, States, Window, type Act } from "../stageshow/kit";
import { Mark } from "../shared/brand.tsx";
import { useResolvedTheme } from "../shared/theme.tsx";
import "./hero-demo.css";

type S = {
  commit: 0 | 1 | 2;
  edited: boolean;
  running: boolean;
  found: number;
  row: boolean;
  lit: number;
  sgAllows: boolean;
};

const initial: S = { commit: 0, edited: false, running: false, found: 0, row: false, lit: 0, sgAllows: false };
const POSTER: S = { commit: 1, edited: true, running: false, found: 1, row: true, lit: 5, sgAllows: true };

const COMMITS = ["Restrict Postgres to the VPC", "Let the reporting job reach Postgres", "Restrict Postgres to the VPC"];
const HOPS = ["Public IP", "Gateway", "NACL", "Group", "Route"];

const TABS = [
  <span key="pr" className="hd-tab">
    <GitHubMark />
    Pull request #42 · acme/infra
  </span>,
  <span key="actions" className="hd-tab">
    <GitHubMark />
    Actions · acme/infra
  </span>,
];

const URL = (
  <span className="hd-url">
    <svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
    <span>
      github.com/<span className="hd-url-path">acme/infra/pull/42/files</span>
    </span>
  </span>
);

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}


async function script(a: Act<S>) {
  await a.wait(1400);
  // A commit widens the rule.
  await a.set({ commit: 1 });
  await a.wait(500);
  await a.set({ edited: true });
  await a.wait(1000);
  // The check runs and finds a new path.
  await a.set({ running: true });
  await a.wait(1100);
  await a.set({ running: false, found: 1 });
  await a.wait(350);
  await a.set({ row: true });
  await a.wait(800);
  // Each hop is checked in order; the group is the hop that changed.
  for (let lit = 1; lit <= 4; lit++) {
    await a.set({ lit });
    await a.wait(lit === 4 ? 650 : 260);
  }
  await a.set({ sgAllows: true });
  await a.wait(400);
  await a.set({ lit: 5 });
  await a.wait(2400);
  // A fix commit restores the rule; the check closes the path.
  await a.set({ commit: 2 });
  await a.wait(500);
  await a.set({ edited: false });
  await a.wait(700);
  await a.set({ running: true, row: false });
  await a.wait(900);
  await a.set({ running: false, found: 0, lit: 0, sgAllows: false });
  await a.wait(1200);
  // Commit 2 says what commit 0 said, so the seam does not show.
  await a.set({ commit: 0 });
}

function DiffLine({ sign, children, tone }: { sign: string; children: React.ReactNode; tone?: "add" | "del" }) {
  return (
    <div className={`hd-line${tone ? ` is-${tone}` : ""}`}>
      <span className="hd-sign" aria-hidden="true">
        {sign}
      </span>
      <span className="hd-code">{children}</span>
    </div>
  );
}

function Diff({ s }: { s: S }) {
  return (
    <div className="hd-file">
      <div className="hd-file-head">
        <span className="hd-file-name">network.tf</span>
        <Bar w={46} h={6} tone={2} />
      </div>
      <div className="hd-diff">
        <DiffLine sign=" ">{'resource "aws_security_group" "db" {'}</DiffLine>
        <DiffLine sign=" ">{"  ingress {"}</DiffLine>
        <DiffLine sign=" ">{"    from_port   = 5432"}</DiffLine>
        <DiffLine sign=" ">{"    to_port     = 5432"}</DiffLine>
        <Collapse open={s.edited}>
          <DiffLine sign="-" tone="del">
            {'    cidr_blocks = ["10.0.0.0/16"]'}
          </DiffLine>
        </Collapse>
        <DiffLine sign={s.edited ? "+" : " "} tone={s.edited ? "add" : undefined}>
          {"    cidr_blocks = ["}
          <span className="hd-q">&quot;</span>
          <Roll>{s.edited ? "0.0.0.0/0" : "10.0.0.0/16"}</Roll>
          <span className="hd-q">&quot;</span>
          {"]"}
        </DiffLine>
        <DiffLine sign=" ">{"  }"}</DiffLine>
        <DiffLine sign=" ">{"}"}</DiffLine>
      </div>
    </div>
  );
}

function Check({ s }: { s: S }) {
  const status = s.running ? "running" : s.found ? "found" : "clear";
  return (
    <div className="hd-card" data-target="card">
      <div className="hd-card-head">
        <span className="hd-brand">
          <Mark size={18} />
          vpcdiff
        </span>
        <States
          value={status}
          align="end"
          states={{
            clear: (
              <span className="hd-status is-ok">
                <span className="hd-status-dot" aria-hidden="true" />
                No new exposure
              </span>
            ),
            running: (
              <span className="hd-status">
                <Spinner size={11} /> Checking paths
              </span>
            ),
            found: (
              <span className="hd-status is-bad">
                <span className="hd-status-dot" aria-hidden="true" />
                New exposure
              </span>
            ),
          }}
        />
      </div>
      <div className="hd-figure">
        <Count value={s.found} className={`hd-number${s.found ? " is-bad" : ""}`} />
        <span className="hd-figure-label">
          <Roll variant="fade">{s.found === 1 ? "path opened to the internet" : "paths opened to the internet"}</Roll>
        </span>
      </div>
      <Collapse open={s.row} reveal="drop">
        <div className="hd-row">
          <div className="hd-row-top">
            <span className="hd-target">aws_instance.db</span>
            <span className="hd-port">tcp/5432</span>
          </div>
          <div className="hd-hops">
            {HOPS.map((h, i) => {
              const on = s.lit > i;
              const group = h === "Group";
              const tone = !on ? "" : group && !s.sgAllows ? " is-deny" : " is-allow";
              return (
                <span key={h} className={`hd-hop${tone}`}>
                  {group && on ? <Roll variant="fade">{s.sgAllows ? "Group allows" : "Group denies"}</Roll> : h}
                </span>
              );
            })}
          </div>
          <div className="hd-rule">aws_security_group.db allows 0.0.0.0/0</div>
        </div>
      </Collapse>
    </div>
  );
}

export function HeroDemo() {
  const theme = useResolvedTheme();
  return (
    <Stage
      width={1040}
      height={460}
      compact={{ below: 720, width: 358, height: 520 }}
      initial={initial}
      poster={POSTER}
      script={script}
      theme={theme}
      className="hero-demo"
    >
      {(s, _rect, layout) =>
        layout === "compact" ? (
          <>
            <Window url={URL} urlShape="pill" lights="grey" className="hd-window hd-window--compact">
              <div className="hd-page">
                <Diff s={s} />
              </div>
            </Window>
            <div className="hd-satellite hd-satellite--compact">
              <Check s={s} />
            </div>
          </>
        ) : (
          <>
            <Window url={URL} tabs={TABS} urlShape="pill" lights="grey" nav className="hd-window">
              <div className="hd-page">
                <div className="hd-pr">
                  <div className="hd-pr-title">Pull request #42</div>
                  <div className="hd-commit">
                    <span className="hd-commit-dot" aria-hidden="true" />
                    <Roll>{COMMITS[s.commit] ?? ""}</Roll>
                  </div>
                  <div className="hd-tabs">
                    <Bar w={84} h={6} tone={2} />
                    <Bar w={52} h={6} tone={2} />
                    <Bar w={60} h={6} tone={2} />
                    <span className="hd-tab-current">Files changed</span>
                  </div>
                </div>
                <Diff s={s} />
              </div>
            </Window>
            <div className="hd-satellite">
              <Check s={s} />
            </div>
          </>
        )
      }
    </Stage>
  );
}
