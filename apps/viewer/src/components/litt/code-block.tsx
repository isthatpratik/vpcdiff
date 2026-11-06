"use client";
// @litt/code-block 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * CodeBlock: code in an answer, in a tool's output, or a diff (components.md, "Code block").
 *
 * - Surface: `--litt-surface-2` with an inset `--litt-line` hairline at the surface radius, drawn as an overlay so a
 *   changed line's band never paints over it. A 32px header holds the file name or the language in mono at
 *   the caption size in `--litt-fg-subtle`, and the Copy button. The header is its own row, so the button can never
 *   cover code. The code is mono at the small size in `--litt-fg`, padded `--litt-space-4`, with a tab size of 2.
 * - Highlighting: tsx, ts, jsx and js go through sugar-high, and every other language is plain. Code is not
 *   data, so the colors are the foreground's tones and the accent text for strings (no data hues, R7).
 *   sugar-high paints each token with a syntax variable, so this file declares all of them on the block
 *   itself with arbitrary properties. It needs no stylesheet from the gallery and ships alone.
 * - Diff: with lang "diff" each line's first character is its sign, read into its own column: `+` in
 *   `--litt-success`, `-` in `--litt-danger`. Added lines are `--litt-fg`, removed lines `--litt-fg-subtle`, and both changed kinds
 *   take an fg 4% band that runs the whole scroll width (each row owns the side padding, so the band reaches
 *   the edges). Status color stays on the sign. Diff lines are not syntax-highlighted, so a removed line can
 *   step back to `--litt-fg-subtle`. Header lines before the first hunk (`diff`, `---`, `+++`) and `@@` lines show
 *   as quiet text with no sign.
 * - Screen readers: the sign column is hidden from them and a changed line starts with hidden words, "Added:"
 *   or "Removed:". Color and glyphs are never the only signal. The hidden words cannot be selected, so a hand
 *   selection never picks them up.
 * - Line numbers: an optional gutter in mono at the caption size in `--litt-fg-subtle`. It is hidden from screen
 *   readers, cannot be selected, and is not part of Copy.
 * - Overflow: lines scroll sideways inside the block (`wrap` wraps them), and a block taller than `maxHeight`
 *   scrolls down. The scroller is focusable and named by `label`, so a keyboard can scroll it.
 * - Copy: the button copies `code` exactly as given, a diff with its signs included. It swaps its icon for a
 *   check at once, and a polite live region says "Copied". No toast.
 * - Touch: the header and the button grow to 44px on a coarse pointer.
 * - Focus: the scroller and the Copy button both draw the 2px focus ring inside themselves, because the button
 *   fills the header's height and an outer ring would run past the block's edge.
 * - Motion: none. The copy icon swaps at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { highlight } from "sugar-high";
import { Button } from "./button";
import { CheckIcon, CopyIcon } from "./icons";

export type CodeBlockProps = {
  /** The source to show. Copy puts exactly this text on the clipboard. */
  code: string;
  /** Names the scroll area for screen readers and keyboard users. Defaults to the file name, or "Code". */
  label?: string;
  /** tsx, ts, jsx and js are highlighted. diff reads each line's first character as its sign. shell and text are plain. */
  lang?: "tsx" | "ts" | "jsx" | "js" | "diff" | "shell" | "text";
  /** Shown in the header in place of the language, such as "next.config.ts". */
  filename?: string;
  /** Shows a gutter of line numbers. It is hidden from screen readers, cannot be selected and is not copied. */
  lineNumbers?: boolean;
  /** Wraps long lines instead of scrolling them sideways. */
  wrap?: boolean;
  /** Caps the height of the code, which then scrolls down. A number is px, a string is any CSS length such as "16rem". */
  maxHeight?: number | string;
  /** Extra classes for the block, such as a top margin. It fills the width of its container. */
  className?: string;
};

type Lang = NonNullable<CodeBlockProps["lang"]>;

/* sugar-high paints every token with a color read from a variable of its own. Declaring those variables here, on
   the block, maps them to the tokens in both themes and keeps the component free of any stylesheet. Strings are
   the one place the accent text appears, mixed 90% into the foreground, so they sit quietly beside the code. */
const SYNTAX =
  "[--sh-identifier:var(--litt-fg)] [--sh-class:var(--litt-fg)] [--sh-property:var(--litt-fg)] [--sh-entity:var(--litt-fg)] " +
  "[--sh-keyword:var(--litt-fg)] [--sh-sign:var(--litt-fg-muted)] [--sh-comment:var(--litt-fg-subtle)] " +
  "[--sh-string:color-mix(in_oklab,var(--litt-accent-text)_90%,var(--litt-fg))] [--sh-jsxliterals:var(--sh-string)] " +
  "[--sh-space:currentColor] [--sh-break:currentColor]";

/* The band behind an added or removed line: the foreground at 4%, so it follows both themes. */
const BAND = "bg-[color-mix(in_oklab,var(--litt-fg)_4%,transparent)]";

const HIGHLIGHT: Partial<Record<Lang, "typescript" | "javascript">> = {
  tsx: "typescript",
  ts: "typescript",
  jsx: "javascript",
  js: "javascript",
};

type Kind = "code" | "add" | "remove" | "context" | "meta";
type Row = { kind: Kind; text: string; html?: string };

/** One row per line of a diff. The first character is the sign: + added, - removed, a space context. */
function diffRows(lines: string[]): Row[] {
  /* With hunks, everything before the first @@ is the file header (diff, index, ---, +++), which is not a change. */
  const hunks = lines.some((l) => l.startsWith("@@"));
  let inHunk = !hunks;
  return lines.map((line): Row => {
    if (line.startsWith("@@")) {
      inHunk = true;
      return { kind: "meta", text: line };
    }
    if (!inHunk || line.startsWith("\\")) return { kind: "meta", text: line };
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "remove", text: line.slice(1) };
    return { kind: "context", text: line.startsWith(" ") ? line.slice(1) : line };
  });
}

const SIGN: Partial<Record<Kind, string>> = { add: "+", remove: "-" };
const SIGN_COLOR: Partial<Record<Kind, string>> = { add: "text-litt-success", remove: "text-litt-danger" };
/* What a screen reader hears before a changed line. */
const SAID: Partial<Record<Kind, string>> = { add: "Added: ", remove: "Removed: " };
const ROW_COLOR: Record<Kind, string> = {
  code: "text-litt-fg",
  context: "text-litt-fg",
  add: `text-litt-fg ${BAND}`,
  remove: `text-litt-fg-subtle ${BAND}`,
  meta: "text-litt-fg-subtle",
};

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
/* How long "Copied" stays up. It is feedback, not animation. */
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

/**
 * A block of code on a quiet surface, with a header that names the file or the language and a Copy button.
 * tsx, ts, jsx and js are highlighted in the foreground's tones; lang "diff" shows signs, bands and hidden
 * "Added" and "Removed" words; the rest is plain. Long lines scroll sideways inside the block, and a
 * focusable, labelled scroller lets a keyboard reach them.
 */
export function CodeBlock({
  code,
  label,
  lang = "text",
  filename,
  lineNumbers = false,
  wrap = false,
  maxHeight,
  className = "",
}: CodeBlockProps) {
  const [state, copy] = useCopy();
  const diff = lang === "diff";

  const rows = useMemo<Row[]>(() => {
    /* One trailing line break is the end of the last line, not a blank line. */
    const lines = code.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    if (diff) return diffRows(lines);
    const grammar = HIGHLIGHT[lang];
    /* sugar-high escapes the source itself, so its HTML is safe to inject. It makes one <span> per line, joined by line breaks. */
    const html = grammar ? highlight(lines.join("\n"), { lang: grammar }).split("\n") : null;
    return lines.map((text, i) => ({ kind: "code", text, html: html?.[i] }));
  }, [code, lang, diff]);

  const digits = String(rows.length).length;
  const name = label ?? filename ?? "Code";

  return (
    <div className={`relative min-w-0 max-w-full rounded-litt-surface bg-litt-surface-2 ${SYNTAX} ${className}`}>
      <div className="flex h-litt-control-sm items-center justify-between gap-2 pl-4 pr-1 pointer-coarse:h-litt-control-md">
        <span className="min-w-0 truncate font-litt-mono text-litt-caption font-normal text-litt-fg-subtle">{filename ?? lang}</span>
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          aria-label="Copy code"
          className="focus-visible:outline-offset-[-2px] pointer-coarse:h-litt-control-md pointer-coarse:w-litt-control-md"
          onClick={() => copy(code)}
        >
          {state === "copied" ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {/* The scroller. A diff's bands and the gutter live in the rows, so they scroll with the code. */}
      <pre
        tabIndex={0}
        role="group"
        aria-label={name}
        style={maxHeight === undefined ? undefined : { maxHeight }}
        className={
          "m-0 overflow-auto rounded-b-litt-surface py-4 font-litt-mono text-litt-small font-normal text-litt-fg [tab-size:2] " +
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-litt-focus"
        }
      >
        <code
          style={{ "--code-gutter": `${digits}ch` } as CSSProperties}
          className={wrap ? "block w-full" : "block w-max min-w-full"}
        >
          {rows.map((row, i) => (
            <span key={i} className={`flex items-baseline gap-3 px-4 ${ROW_COLOR[row.kind]}`}>
              {lineNumbers && (
                <span aria-hidden="true" className="w-(--code-gutter) shrink-0 select-none text-right font-litt-mono text-litt-caption font-normal text-litt-fg-subtle">
                  {i + 1}
                </span>
              )}
              {diff && (
                <span aria-hidden="true" className={`w-[1ch] shrink-0 select-none ${SIGN_COLOR[row.kind] ?? ""}`}>
                  {SIGN[row.kind]}
                </span>
              )}
              <span
                className={"min-w-0 grow " + (wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre")}
              >
                {SAID[row.kind] && <span className="sr-only select-none">{SAID[row.kind]}</span>}
                {/* An empty line holds a line break, so it keeps its height and a hand copy keeps the blank line. */}
                {row.text === "" ? "\n" : row.html === undefined ? row.text : <span dangerouslySetInnerHTML={{ __html: row.html }} />}
              </span>
            </span>
          ))}
        </code>
      </pre>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-litt-surface shadow-[inset_0_0_0_1px_var(--litt-line)]" />
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed. Select the text and copy it by hand." : ""}
      </span>
    </div>
  );
}
