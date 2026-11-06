"use client";
// @litt/details 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * Details: an information card of labelled facts about one thing, such as a deployment, an invoice or a
 * client: Status, Domain, Branch, Region, Created. Compose it from Details, DetailsItem and DetailsLink.
 *
 * - Surface (components.md, Details): `.litt-raised`, so the surface radius, surface-1, an inset hairline and the
 *   top highlight, and no outer shadow (R3). Never glass (R3), never an accent rail. `bare` drops the surface for
 *   a list that already sits on one, such as a dialog or a side panel.
 * - Header: an optional title (body size, title weight, fg), a description (small, fg-subtle) and an action at the
 *   end, such as an sm secondary Button. The action sits in a one-line-tall cell (`1lh`) on the title's line, so a
 *   32px button hangs evenly around it. A hairline separates the header from the facts.
 * - Rows (the default): the label sits beside the value, split by 1px hairlines, each row space-3 above and below so
 *   a line of text makes a 44px row. The labels share one column, as wide as the longest label up to 40% of the
 *   card, so the values line up. The label and the value's first line share a baseline, so a Tag or a wrapped
 *   value still reads on one line. Under 20rem wide (a container query) the label moves above the value.
 * - Grid: the label sits above the value, in columns that measure the card: one under 20rem, two from there, and up
 *   to `columns` once it is wide. `wide` lets an item, such as a note, take the whole row.
 * - Type (R8): the label is small in fg-subtle, the value is body in fg. `mono` sets a value in Geist Mono at the
 *   small size, for an identifier a person reads character by character: a hash, an ID, a path. A version, a
 *   region or a number stays in the sans.
 *   A long value wraps anywhere rather than truncating, so nothing is ever hidden.
 * - Empty: an item with no value says "Not set" in fg-subtle (or its own `empty` words), never a dash.
 * - Loading: `loading` swaps every value for a still surface-2 bar one line tall, so the card keeps its height when
 *   the facts arrive. No pulse, no shimmer. The card sets aria-busy, and copy buttons wait.
 * - Copy: `copy` adds an icon-only ghost button at the end of the row that copies that exact string. It swaps its
 *   icon for a check at once, and a polite live region says "Domain copied". No toast. It grows to 44px on a
 *   coarse pointer, and pulls into the row with negative margins so the row keeps its height.
 * - Semantics: a description list. Each label is a term and its value the description, so a screen reader reads
 *   "Region, fra1". The card links nowhere, so it has no hover and no focus stop of its own.
 * - Motion: none. A value that changes just changes, and the copy icon swaps at once.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { CheckIcon, CopyIcon } from "./icons";
import { Skeleton } from "./states";

/** Rows put each label beside its value; grid puts it above, in columns. */
export type DetailsLayout = "rows" | "grid";

const DetailsContext = createContext<{ layout: DetailsLayout; loading: boolean }>({ layout: "rows", loading: false });

/* -------------------------------------------------------------------------- */
/* Details                                                                    */
/* -------------------------------------------------------------------------- */

/* The list itself. Rows use a subgrid, so every label shares one column and the values line up. */
const LIST: Record<DetailsLayout, string> = {
  rows:
    "grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-6 divide-y divide-litt-line " +
    "@max-[20rem]:grid-cols-1",
  grid: "grid grid-cols-1 gap-x-8 gap-y-6 @min-[20rem]:grid-cols-2",
};

/* Grid only: how many columns once the card is wide. Two is the narrow default. */
const COLUMNS: Record<2 | 3 | 4, string> = {
  2: "",
  3: "@min-[36rem]:grid-cols-3",
  4: "@min-[36rem]:grid-cols-3 @min-[48rem]:grid-cols-4",
};

/* The card's padding. Rows pad space-3 top and bottom themselves, so the card pads the rest of space-6. */
const PADDING: Record<DetailsLayout, { header: string; plain: string }> = {
  rows: { header: "px-6 pt-6 pb-3", plain: "px-6 py-3" },
  grid: { header: "p-6", plain: "p-6" },
};

export type DetailsProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** What the facts are about, such as "Deployment". It is a real heading, so a screen reader can list the cards. */
  title?: ReactNode;
  /** One short line under the title, in small fg-subtle. */
  description?: ReactNode;
  /** One action at the end of the header, such as an sm secondary Button: Visit, Edit. */
  action?: ReactNode;
  /** Rows put the label beside the value, split by hairlines. Grid puts it above, in columns, for a few short facts. */
  layout?: DetailsLayout;
  /** Grid only: the most columns once the card is wide. It always starts at one under 20rem and two from there. */
  columns?: 2 | 3 | 4;
  /** Shows a still bar in place of every value and sets aria-busy, so the card keeps its height while the facts load. */
  loading?: boolean;
  /** Drops the raised surface and its padding, for a list that already sits on a surface such as a dialog. */
  bare?: boolean;
  /** The title's heading level. Pick the one that fits the page's outline; it changes the semantics only, never the size. */
  headingLevel?: "h2" | "h3" | "h4";
  /** The element. Keep section for a card that stands alone, and use li when it sits in a list. */
  as?: "section" | "article" | "div" | "aside" | "li";
  /** The facts: one DetailsItem each. */
  children?: ReactNode;
  /** Extra classes for the card, such as a max width. */
  className?: string;
};

/** An information card: a header, then labelled facts in rows or a grid. It links nowhere, so it has no hover. */
export function Details({
  title,
  description,
  action,
  layout = "rows",
  columns = 2,
  loading = false,
  bare = false,
  headingLevel: Heading = "h3",
  as: Tag = "section",
  children,
  className = "",
  ...rest
}: DetailsProps) {
  const header = title !== undefined || action !== undefined;
  const surface = bare ? "" : `litt-raised rounded-litt-surface ${header ? PADDING[layout].header : PADDING[layout].plain}`;
  return (
    <DetailsContext.Provider value={{ layout, loading }}>
      <Tag aria-busy={loading || undefined} className={`@container min-w-0 ${surface} ${className}`} {...rest}>
        {header && (
          <div className="flex items-start justify-between gap-4 pb-4">
            <div className="grid min-w-0 gap-1">
              {title !== undefined && <Heading className="text-litt-body font-litt-title text-litt-fg">{title}</Heading>}
              {description !== undefined && <p className="text-litt-small text-litt-fg-subtle">{description}</p>}
            </div>
            {action !== undefined && <div className="flex h-lh shrink-0 items-center text-litt-body">{action}</div>}
          </div>
        )}
        <dl
          className={[
            LIST[layout],
            layout === "grid" ? COLUMNS[columns] : "",
            header ? (layout === "grid" ? "border-t border-litt-line pt-6" : "border-t border-litt-line") : "",
          ].join(" ")}
        >
          {children}
        </dl>
      </Tag>
    </DetailsContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* DetailsItem                                                                */
/* -------------------------------------------------------------------------- */

/** The older route for pages without the async clipboard API (plain http). It must run inside the click. */
function copyBySelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

type CopyState = "idle" | "copied" | "failed";
/* How long the check stays up. It is feedback, not animation. */
const FEEDBACK_MS = 2000;

/** Copy with feedback that needs no toast. `copy(text)` is called straight from the click, so Safari keeps the gesture. */
function useCopy(): [CopyState, (text: string) => void] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    const settle = (next: CopyState) => {
      setState(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => settle("copied"),
        () => settle("failed"),
      );
    } else settle(copyBySelection(text) ? "copied" : "failed");
  }, []);
  return [state, copy];
}

/* One fact. In rows it joins the list's subgrid, so its label lands in the shared column. */
const ITEM: Record<DetailsLayout, string> = {
  rows:
    "col-span-full grid grid-cols-subgrid items-baseline py-3 " +
    "@max-[20rem]:flex @max-[20rem]:flex-col @max-[20rem]:items-stretch @max-[20rem]:gap-1",
  grid: "grid min-w-0 content-start gap-1",
};

export type DetailsItemProps = {
  /** What the fact is, in sentence case with no colon: "Region", "Created". */
  label: string;
  /** The value: text, a Tag, an Avatar with a name, or a DetailsLink. Leave it out and the item says it is not set. */
  children?: ReactNode;
  /** Sets the value in Geist Mono at the small size, for a hash, an ID or a path. */
  mono?: boolean;
  /** Adds a copy button at the end of the row that puts exactly this text on the clipboard. */
  copy?: string;
  /** Grid only: the item takes the whole row, for a longer value such as a note. */
  wide?: boolean;
  /** The words for a missing value. */
  empty?: string;
  /** Extra classes for the item. */
  className?: string;
};

/** One labelled fact. The label is the term, the value its description. */
export function DetailsItem({ label, children, mono = false, copy, wide = false, empty = "Not set", className = "" }: DetailsItemProps) {
  const { layout, loading } = useContext(DetailsContext);
  const [state, copyText] = useCopy();
  const missing = children === undefined || children === null || children === false || children === "";

  let value: ReactNode;
  if (loading) value = <Skeleton text={mono ? "small" : "body"} className="w-32 max-w-full" />;
  else if (missing) value = <span className="text-litt-fg-subtle">{empty}</span>;
  else value = children;

  return (
    <div className={`${ITEM[layout]} ${layout === "grid" && wide ? "col-span-full" : ""} ${className}`}>
      <dt className="text-litt-small text-litt-fg-subtle">{label}</dt>
      <dd className="m-0 flex min-w-0 items-baseline gap-2 text-litt-body text-litt-fg">
        <div className={"min-w-0 grow [overflow-wrap:anywhere] " + (mono && !missing ? "font-litt-mono text-litt-small font-normal" : "")}>
          {value}
        </div>
        {copy !== undefined && !loading && (
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            aria-label={`Copy ${label}`}
            className="-my-1.5 self-center pointer-coarse:-my-3 pointer-coarse:h-litt-control-md pointer-coarse:w-litt-control-md"
            onClick={() => copyText(copy)}
          >
            {state === "copied" ? <CheckIcon /> : <CopyIcon />}
          </Button>
        )}
        {copy !== undefined && (
          <span role="status" aria-live="polite" className="sr-only">
            {state === "copied" ? `${label} copied` : state === "failed" ? "Copy failed. Select the text and copy it by hand." : ""}
          </span>
        )}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DetailsLink                                                                */
/* -------------------------------------------------------------------------- */

export type DetailsLinkProps = Omit<ComponentProps<"a">, "ref"> & {
  /** Where the value goes, such as the live site or the commit. */
  href: string;
};

/** A value that is also a link: accent text with a soft underline that firms up on hover. It is the only focus stop in a row. */
export function DetailsLink({ className = "", children, ...rest }: DetailsLinkProps) {
  return (
    <a
      className={
        "rounded-litt-control text-litt-accent-text underline decoration-[color-mix(in_oklab,var(--litt-accent-text)_40%,transparent)] " +
        "underline-offset-2 transition-colors duration-(--litt-dur-instant) ease-litt hover:decoration-litt-accent-text " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus " +
        className
      }
      {...rest}
    >
      {children}
    </a>
  );
}
