"use client";
// @litt/file-drop 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * File drop: where someone adds files, by dropping them or choosing them, and where they watch them upload
 * (components.md, "File drop").
 *
 * - FileDrop is the area. It is the Input's cut (R3) at the surface radius: the --litt-cut floor, the --litt-line-control line
 *   and the top wall's shade, because it is something you put files into, as a field is something you type into. A
 *   row, not a centered stack: a square with an up arrow, the words ("Drop files here", and a hint with the types and
 *   the size limit in --litt-fg-subtle), and Choose files, a secondary button at the end. While files are dragged over it,
 *   the line turns --litt-focus, as a field's does on focus, and the words say what a drop will do. Nothing
 *   else moves; the line changes on the instant tier.
 * - On a touch screen nothing is dragged in, so the words say "Add files" and the button does the work.
 * - Choosing: Choose files opens the file picker; so does a click anywhere on the area. Only the button is a tab stop.
 * - Checking: files whose type is not in accept or whose size is over maxSize are turned away, each with a sentence
 *   under the area that says which file and why. The rest go to onFiles. The sentences go when the next files come.
 * - FileList and FileRow show what was added: one row per file, its name, its size, and while it uploads a
 *   Progress rail under the name. A failed file says why in --litt-danger and offers Retry. Remove is an icon button.
 * - Disabled lies flat: surface-2 with the plain --litt-line hairline and no shade, no drop and no tab stop. The words stay
 *   --litt-fg-subtle, because they still say something (when it opens again), as a disabled Slide to confirm's do.
 * - Forced colors drops box-shadow, so the line becomes a real border.
 */
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "./button";
import { ArrowUpIcon, FileIcon, RetryIcon, XIcon } from "./icons";
import { Progress } from "./progress";
import { useDevice } from "../../lib/litt/motion";

/** 2048 to "2.0 KB": the size in the units people read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${bytes < 10 * 1024 ? (bytes / 1024).toFixed(1) : Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Does a file match one entry of an accept list: ".pdf", "image/*" or "image/png"? */
function matches(file: File, rule: string): boolean {
  const r = rule.trim().toLowerCase();
  if (r.startsWith(".")) return file.name.toLowerCase().endsWith(r);
  if (r.endsWith("/*")) return file.type.toLowerCase().startsWith(r.slice(0, -1));
  return file.type.toLowerCase() === r;
}

export type FileRejection = { file: File; reason: string };

/* ------------------------------------------------------------------ FileDrop */

export type FileDropProps = {
  /** What the files are for, as the area's name: "Project files". Screen readers hear it with the button. */
  label: string;
  /** The types it takes, as a file input's accept: [".pdf", "image/*"]. Leave it out to take any file. */
  accept?: string[];
  /** The largest file it takes, in bytes. */
  maxSize?: number;
  /** Takes several files at once. Default true. */
  multiple?: boolean;
  /** Runs with the files that passed the checks, in the order they came. */
  onFiles: (files: File[]) => void;
  /** Runs with the files that were turned away and why. The area also says it under itself. */
  onReject?: (rejected: FileRejection[]) => void;
  /** The line under "Drop files here": the types and the limit, "PDF or images, up to 10 MB". */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** An area to drop files on or choose them from. It checks type and size, says what it turned away, and hands over the rest. */
export function FileDrop({ label, accept, maxSize, multiple = true, onFiles, onReject, hint, disabled = false, className = "" }: FileDropProps) {
  const { coarse } = useDevice();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(0); // how many dragged items are over the area: enter and leave fire for children too
  const [turnedAway, setTurnedAway] = useState<FileRejection[]>([]);

  const take = (list: FileList | null) => {
    if (!list || disabled) return;
    const files = [...list].slice(0, multiple ? undefined : 1);
    const ok: File[] = [];
    const no: FileRejection[] = [];
    for (const file of files) {
      if (accept?.length && !accept.some((r) => matches(file, r))) no.push({ file, reason: `${file.name} is not a type this takes.` });
      else if (maxSize !== undefined && file.size > maxSize) no.push({ file, reason: `${file.name} is ${formatSize(file.size)}, over the ${formatSize(maxSize)} limit.` });
      else ok.push(file);
    }
    setTurnedAway(no);
    if (no.length) onReject?.(no);
    if (ok.length) onFiles(ok);
  };

  const dragging = over > 0 && !disabled;
  const drag = (e: DragEvent<HTMLDivElement>, step: number) => {
    if (disabled || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setOver((n) => Math.max(0, n + step));
  };

  return (
    <div className={"grid gap-3 " + className}>
      <div
        role="group"
        aria-label={label}
        onDragEnter={(e) => drag(e, 1)}
        onDragLeave={(e) => drag(e, -1)}
        onDragOver={(e) => {
          if (disabled || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(0);
          take(e.dataTransfer.files);
        }}
        /* A click anywhere chooses files too; the button is the keyboard's way in, so the area is no tab stop. */
        onClick={(e) => {
          if (!disabled && !(e.target as Element).closest("button")) input.current?.click();
        }}
        className={
          "flex flex-wrap items-center gap-4 rounded-litt-surface p-4 transition-[box-shadow] duration-(--litt-dur-instant) ease-litt forced-colors:border sm:flex-nowrap sm:p-6 " +
          (disabled
            ? "cursor-not-allowed bg-litt-surface-2 shadow-[inset_0_0_0_1px_var(--litt-line)]"
            : dragging
              ? "bg-litt-cut shadow-[inset_0_0_0_1px_var(--litt-focus),var(--litt-cut-shade)]"
              : "cursor-pointer bg-litt-cut shadow-[inset_0_0_0_1px_var(--litt-line-control),var(--litt-cut-shade)]")
        }
      >
        <span
          aria-hidden="true"
          className={
            "grid size-8 shrink-0 place-items-center rounded-litt-control " +
            (disabled ? "bg-litt-surface-2 text-litt-fg-disabled shadow-[inset_0_0_0_1px_var(--litt-line)]" : "bg-litt-surface-1 text-litt-fg shadow-[inset_0_0_0_1px_var(--litt-line),var(--litt-highlight)]")
          }
        >
          <ArrowUpIcon />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <p className={"text-litt-body font-litt-title " + (disabled ? "text-litt-fg-subtle" : "text-litt-fg")}>
            {/* vpcdiff patch: singular wording when multiple is false. */}
            {dragging ? (multiple ? "Drop to add these files" : "Drop to add this file") : coarse ? (multiple ? "Add files" : "Add a file") : multiple ? "Drop files here" : "Drop a file here"}
          </p>
          {hint && (
            <p id={hintId} className="text-litt-small text-litt-fg-subtle">
              {hint}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" disabled={disabled} aria-describedby={hint ? hintId : undefined} onClick={() => input.current?.click()}>
          {multiple ? "Choose files" : "Choose a file"}
        </Button>
        <input
          ref={input}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          multiple={multiple}
          accept={accept?.join(",")}
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = ""; // so choosing the same file again still counts
          }}
        />
      </div>
      {/* What was turned away, and why. An alert, because it answers what the person just did. */}
      <div role="alert" className="grid gap-1 empty:hidden">
        {turnedAway.map((r) => (
          <p key={r.file.name + r.file.size} className="text-litt-small text-litt-danger">
            {r.reason}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ FileList and FileRow */

/** The files that were added, one row each. Name it, so a screen reader knows whose files these are. */
export function FileList({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={"grid " + className}>
      {children}
    </ul>
  );
}

export type FileRowProps = {
  name: string;
  /** In bytes. */
  size?: number;
  /** How far the upload is, 0 to 100. Leave it out once the file is in. */
  progress?: number;
  /** Why the upload failed. Shown in --litt-danger under the name, with Retry. */
  error?: ReactNode;
  onRetry?: () => void;
  onRemove?: () => void;
};

/** One file in a FileList: its name and size, a Progress rail while it uploads, why it failed, Retry and Remove. */
export function FileRow({ name, size, progress, error, onRetry, onRemove }: FileRowProps) {
  const uploading = progress !== undefined && progress < 100 && !error;
  return (
    <li className="flex items-start gap-3 border-t border-litt-line py-3 first:border-t-0">
      <FileIcon className="mt-0.5 shrink-0 text-litt-fg-muted" />
      <div className="grid min-w-0 flex-1 gap-2">
        <p className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 truncate text-litt-caption font-normal text-litt-fg">{name}</span>
          {size !== undefined && <span className="shrink-0 text-litt-caption tabular-nums font-normal text-litt-fg-subtle">{formatSize(size)}</span>}
        </p>
        {(uploading || error) && (
          <Progress
            label={`Uploading ${name}`}
            hideLabel
            value={progress ?? 0}
            status={error ? "failed" : "active"}
            message={error}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {error && onRetry && (
          <Button size="sm" variant="ghost" iconOnly aria-label={`Retry ${name}`} onClick={onRetry}>
            <RetryIcon />
          </Button>
        )}
        {onRemove && (
          <Button size="sm" variant="ghost" iconOnly aria-label={uploading ? `Cancel ${name}` : `Remove ${name}`} onClick={onRemove}>
            <XIcon />
          </Button>
        )}
      </div>
    </li>
  );
}
