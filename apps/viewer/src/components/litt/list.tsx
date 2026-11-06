"use client";
// @litt/list 2026.11.05. What changed: https://littmd.vercel.app/changelog.md

/**
 * List and cards: project rows, project cards, filter chips and the empty state.
 *
 * "Placed, not thrown": things arrive with intent and settle.
 *
 * - ProjectList is the page's ONE expressive moment. Rows fade in and rise from
 *   the travel token's distance to rest, each waiting index x stagger. The cascade is
 *   capped at six, so row 7 onward arrive with row 6 and a long list never drags.
 * - ProjectGrid is responsive. Filtering re-flows the grid with Motion `layout`
 *   (position only, so text never stretches). Leaving cards fade and shrink to
 *   0.98 with no travel; added cards enter on the same tier.
 * - Hover is the instant tier and only changes fills and the hairline color.
 *   Rows and cards never move, and selection only turns the card's ring to the
 *   focus color.
 * - Touch has no hover, so on a coarse pointer a row (and an unselected filter chip) that is held
 *   down fills (PRESS_FILL, color only, instant tier), and a pressed card shows its hover steps.
 *   The box never moves, and the OS tap flash is off so the two do not double.
 * - Corners: the list container and cards are rounded-litt-surface; the rows inset 4px
 *   inside the container and the card cover inset 4px inside the card are
 *   rounded-litt-control (concentric), and so are the chips and tags.
 */
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useExit, useStagger, useTransition, useTravel } from "../../lib/litt/motion";
import { Button } from "./button";
import { Empty } from "./states";
import { Tag, type TagStatus } from "./tag";
import { ProjectCover, type CoverName } from "./list-cover";

export type { CoverName } from "./list-cover";

export type ProjectStatus = "live" | "review" | "draft" | "idea";
export type ProjectFilter = "all" | "live" | "review" | "draft";

/**
 * What every component here reads. Only id, name, client, status and updated are required; leave out
 * the rest and their part of the row or card is left out too. Map your own data to this shape where you
 * render the list, and leave the installed file as it is.
 */
export type Project = {
  /** Unique. It is the React key and what the selection tracks. */
  id: string;
  name: string;
  /** The line under the name: a client, an owner, a team. */
  client: string;
  /** Last deploy, in words: "Deployed 2 days ago", "No deploy yet". Shown after the client on wider screens. */
  deploy?: string;
  /** Shown as a status tag: live, review, draft or idea. */
  status: ProjectStatus;
  /** When it was last touched. An ISO date (YYYY-MM-DD) shows as "09 Oct"; anything else ("2024", "Q3") shows as written. */
  updated: string;
  /** One line, on the card. */
  description?: string;
  /** Short labels on the card. */
  tags?: string[];
  /** Which drawn cover the card shows. Without one, the card has no cover. */
  cover?: CoverName;
  /** When set, the row is a link; otherwise it is a button. */
  href?: string;
};

/** The entrance cascade stops counting at this many rows. */
export const CASCADE_CAP = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^\d{4}-(\d{2})-(\d{2})$/;
/** A machine-readable year, month or day ("2024", "2024-10", "2024-10-09"), which a <time> can carry. */
const DATETIME = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** "2026-10-09" becomes "09 Oct": always six characters, so tabular dates align. Anything that is not an ISO date ("2024", "Q3") stays as written. */
export function formatDate(value: string) {
  const m = ISO_DATE.exec(value);
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined;
  return m && month ? `${m[2]} ${month}` : value;
}

/** The date column: a <time> when the value is a real date or year, plain text otherwise. */
function When({ value, className }: { value: string; className: string }) {
  return DATETIME.test(value) ? (
    <time dateTime={value} className={className}>
      {formatDate(value)}
    </time>
  ) : (
    <span className={className}>{value}</span>
  );
}

/**
 * Whether a project shows under a filter. "all" shows everything; any other filter matches the status.
 *
 * @param p The project to test.
 * @param filter The filter chip that is on.
 */
export function matchesFilter(p: Project, filter: ProjectFilter) {
  return filter === "all" || p.status === filter;
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

// The project statuses on Tag's own status set. Idea is neutral like Draft; their words tell them apart.
const STATUS: Record<ProjectStatus, { label: string; status: TagStatus }> = {
  live: { label: "Live", status: "success" },
  review: { label: "Review", status: "warning" },
  draft: { label: "Draft", status: "neutral" },
  idea: { label: "Idea", status: "neutral" },
};

/** A project's status as a Tag: the label in words, and the text in the status color, never the fill (components.md, Tag). */
export function StatusTag({
  status,
  className = "",
}: {
  /** Sets the label and the text color. Draft and Idea share a color; their words differ. */
  status: ProjectStatus;
  /** Extra classes for the tag. */
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <Tag status={s.status} className={className}>
      {s.label}
    </Tag>
  );
}

/** A quiet pill for a label such as Framer or Site. */
export function ProjectTag({ children }: { children: ReactNode }) {
  return <Tag>{children}</Tag>;
}

/* -------------------------------------------------------------------------- */
/* ProjectList: airy rows with the staggered entrance                         */
/* -------------------------------------------------------------------------- */

/** What a finger holding a row shows: fg 6%, a step above the 4% hover fill because the finger covers the row. */
const PRESS_FILL = "pointer-coarse:active:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)]";

const rowClass =
  "flex size-full items-center gap-4 rounded-litt-control px-4 text-left " +
  "cursor-pointer transition-[background-color] duration-(--litt-dur-instant) ease-litt [-webkit-tap-highlight-color:transparent] " +
  "hover:bg-[color-mix(in_oklab,var(--litt-fg)_4%,transparent)] " + PRESS_FILL + " " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus";

function RowContent({ project }: { project: Project }) {
  return (
    <>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate text-litt-body font-litt-title text-litt-fg">{project.name}</span>
        <span className="truncate text-litt-caption text-litt-fg-subtle">
          {project.client}
          {project.deploy && <span className="hidden sm:inline"> · {project.deploy}</span>}
        </span>
      </span>
      <span className="flex shrink-0 sm:w-24">
        <StatusTag status={project.status} />
      </span>
      <When
        value={project.updated}
        className="hidden min-w-14 shrink-0 text-right text-litt-caption font-normal whitespace-nowrap tabular-nums text-litt-fg-subtle sm:block"
      />
    </>
  );
}

export type ProjectListProps = {
  /** The rows, in order. Each row is a button, or a link when the project has an href. */
  projects: Project[];
  /** Called when a row without an href is pressed. */
  onOpen?: (project: Project) => void;
  /** Play the staggered entrance on mount. Remount (change `key`) to replay. */
  entrance?: boolean;
  /** The list's accessible name. Change it when the page has more than one list. */
  label?: string;
  /** Extra classes for the list, such as a max width. */
  className?: string;
};

/** Airy project rows in one hairline box. The rows arrive in a staggered cascade, the page's one expressive moment. */
export function ProjectList({ projects, onOpen, entrance = true, label = "Projects", className = "" }: ProjectListProps) {
  const enter = useTransition("expressive");
  const travel = useTravel();
  const stagger = useStagger();
  return (
    <ul
      aria-label={label}
      className={"w-full rounded-litt-surface p-1 shadow-[inset_0_0_0_1px_var(--litt-line)] " + className}
    >
      {projects.map((p, i) => {
        // Rows after the sixth reuse the sixth's delay.
        const wait = Math.min(i, CASCADE_CAP - 1) * stagger;
        return (
          <motion.li
            key={p.id}
            className="h-16 border-b border-litt-line last:border-b-0"
            initial={entrance ? { opacity: 0, y: travel } : false}
            animate={{ opacity: 1, y: 0, transition: { ...enter, delay: wait } }}
          >
            {p.href ? (
              <a href={p.href} className={rowClass}>
                <RowContent project={p} />
              </a>
            ) : (
              <button type="button" onClick={() => onOpen?.(p)} className={rowClass}>
                <RowContent project={p} />
              </button>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* ProjectCard                                                                */
/* -------------------------------------------------------------------------- */

export type ProjectCardProps = {
  /** The project to show. */
  project: Project;
  /** Whether the card is selected. You own this state. */
  selected?: boolean;
  /** Called with the checkbox's new state. Leave it out and the checkbox cannot be changed. */
  onSelectedChange?: (selected: boolean) => void;
  /** Called when the card is pressed anywhere except the checkbox. */
  onOpen?: (project: Project) => void;
  /** Extra classes for the card. */
  className?: string;
};

/**
 * A raised card: no shadow, nothing moves. Hover (instant tier) strengthens the
 * hairline (line to line-strong) and steps the cover fill (surface-2 to
 * surface-3). Touch has no hover, so on a coarse pointer a press shows the same
 * two steps (instant tier, color only). Selected turns the ring to 1px --litt-focus and
 * changes nothing else. The whole card opens through one stretched button; the
 * checkbox sits above it.
 */
export function ProjectCard({ project, selected = false, onSelectedChange, onOpen, className = "" }: ProjectCardProps) {
  const select = (
    <label className="absolute top-1 right-1 z-10 grid size-8 cursor-pointer place-items-center pointer-coarse:size-11">
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelectedChange?.(e.target.checked)}
        aria-label={`Select ${project.name}`}
        className="size-4 cursor-pointer rounded-litt-control accent-litt-fg"
      />
    </label>
  );
  return (
    <article
      data-selected={selected || undefined}
      className={"litt-raised group relative flex h-full flex-col rounded-litt-surface p-1 " + className}
    >
      {/* The ring. It changes color only, on the instant tier. */}
      <span
        aria-hidden="true"
        className={
          "pointer-events-none absolute inset-0 rounded-litt-surface border transition-[border-color] duration-(--litt-dur-instant) ease-litt " +
          (selected ? "border-litt-focus" : "border-litt-line group-hover:border-litt-line-strong pointer-coarse:group-active:border-litt-line-strong")
        }
      />

      {project.cover ? (
        <div className="relative aspect-[8/5] shrink-0 overflow-hidden rounded-[calc(var(--litt-radius-surface)-4px)] bg-litt-surface-2 transition-[background-color] duration-(--litt-dur-instant) ease-litt group-hover:bg-litt-surface-3 pointer-coarse:group-active:bg-litt-surface-3">
          <ProjectCover name={project.cover} />
          {select}
        </div>
      ) : (
        select
      )}

      {/* Without a cover the select box sits in the card's corner, so the title keeps clear of it. */}
      <div className={"grid gap-1 px-3 pt-4 " + (project.cover ? "" : "pr-12")}>
        <h3 className="truncate text-litt-body font-litt-title text-litt-fg">{project.name}</h3>
        {project.description && <p className="truncate text-litt-small text-litt-fg-subtle">{project.description}</p>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 px-3 pt-4 pb-3">
        <StatusTag status={project.status} />
        {project.tags?.map((t) => (
          <ProjectTag key={t}>{t}</ProjectTag>
        ))}
      </div>

      <button
        type="button"
        aria-label={`Open ${project.name}`}
        onClick={() => onOpen?.(project)}
        className="absolute inset-0 z-0 cursor-pointer rounded-litt-surface [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus"
      />
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter chips                                                               */
/* -------------------------------------------------------------------------- */

const FILTERS: { id: ProjectFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "review", label: "Review" },
  { id: "draft", label: "Draft" },
];

/** Filter chips at the control radius, like the tags beside them. Selected is fg on surface-3; the rest are fg-subtle. Color and fill only. */
export function ProjectFilters({
  value,
  onChange,
  className = "",
}: {
  /** The chip that is on: all, live, review or draft. You own this state. */
  value: ProjectFilter;
  /** Called with the chip that was pressed. */
  onChange: (filter: ProjectFilter) => void;
  /** Extra classes for the row of chips. */
  className?: string;
}) {
  return (
    <div role="group" aria-label="Filter projects" className={"flex flex-wrap gap-2 " + className}>
      {FILTERS.map((f) => {
        const on = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(f.id)}
            className={
              "inline-flex h-litt-control-sm cursor-pointer items-center rounded-litt-control px-litt-control-pad-sm text-litt-small font-litt-title " +
              "transition-[background-color,color] duration-(--litt-dur-instant) ease-litt [-webkit-tap-highlight-color:transparent] " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus " +
              (on
                ? "bg-litt-surface-3 text-litt-fg"
                : "text-litt-fg-subtle hover:text-litt-fg hover:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)] " + PRESS_FILL + " pointer-coarse:active:text-litt-fg")
            }
          >
            <span className="litt-trim">{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

const EMPTY: Record<ProjectFilter, { line: string; hint: string }> = {
  all: { line: "No projects yet.", hint: "A new project starts as a draft and shows up here." },
  live: { line: "Nothing is live yet.", hint: "A project appears here once it is deployed." },
  review: { line: "Nothing is in review.", hint: "Send a draft for review and it lands here." },
  draft: { line: "No drafts right now.", hint: "New projects start as drafts." },
};

/** The Empty state for a filter: one line in fg-muted, a hint in fg-subtle, and the way out. Left-aligned, no illustration. */
export function ProjectsEmpty({
  filter,
  onClearFilter,
}: {
  /** Picks the wording: each filter has its own line and hint. */
  filter: ProjectFilter;
  /** Called by the Clear filter button, which shows for every filter except all. Leave it out to hide the button. */
  onClearFilter?: () => void;
}) {
  const copy = EMPTY[filter];
  return (
    <Empty
      role="status"
      title={copy.line}
      action={
        filter !== "all" && onClearFilter ? (
          // The ghost button's label is inset by its padding; pull it back so it lines up with the text above.
          <Button variant="ghost" size="sm" onClick={onClearFilter} className="-ml-litt-control-pad-sm">
            Clear filter
          </Button>
        ) : undefined
      }
    >
      {copy.hint}
    </Empty>
  );
}

/* -------------------------------------------------------------------------- */
/* ProjectGrid: layout motion on the responsive tier                          */
/* -------------------------------------------------------------------------- */

export type ProjectGridProps = {
  /** Every project. The grid applies the filter itself, so it can animate the difference. */
  projects: Project[];
  /** Which projects show: all, or the ones with that status. Pair it with ProjectFilters. */
  filter: ProjectFilter;
  /** The ids of the selected cards. You own this state. */
  selectedIds?: string[];
  /** Called with a card's id and its checkbox's new state. */
  onSelectedChange?: (id: string, selected: boolean) => void;
  /** Called by the Clear filter button in the empty state. */
  onClearFilter?: () => void;
  /** Called when a card is pressed anywhere except the checkbox. */
  onOpen?: (project: Project) => void;
};

/** A grid of ProjectCards. Changing the filter re-flows it: cards that stay slide, cards that leave fade, and an empty result shows ProjectsEmpty. */
export function ProjectGrid({ projects, filter, selectedIds = [], onSelectedChange, onClearFilter, onOpen }: ProjectGridProps) {
  const enter = useTransition("responsive");
  const exit = useExit("responsive");
  const travel = useTravel();
  const visible = projects.filter((p) => matchesFilter(p, filter));
  const empty = visible.length === 0;
  // The empty state waits for the leaving cards to finish fading, so the two never overlap.
  const { duration: settle = 0 } = exit as { duration?: number };

  return (
    <div className="grid w-full">
      <div className="relative col-start-1 row-start-1 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] content-start gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((p) => (
            <motion.div
              key={p.id}
              layout="position"
              className="h-full"
              initial={{ opacity: 0, y: travel / 2, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: exit }}
              transition={enter}
            >
              <ProjectCard
                project={p}
                selected={selectedIds.includes(p.id)}
                onSelectedChange={(on) => onSelectedChange?.(p.id, on)}
                onOpen={onOpen}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {empty && (
          <motion.div
            key="empty"
            className="col-start-1 row-start-1"
            initial={{ opacity: 0, y: travel / 2 }}
            animate={{ opacity: 1, y: 0, transition: { ...enter, delay: settle } }}
            exit={{ opacity: 0, transition: exit }}
          >
            <ProjectsEmpty filter={filter} onClearFilter={onClearFilter} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
