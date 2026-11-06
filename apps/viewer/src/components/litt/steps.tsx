"use client";
// @litt/steps 2026.10.25. What changed: https://littmd.vercel.app/changelog.md

/**
 * Steps: where someone is in a flow of a few steps, such as setting up a studio or checking out
 * (components.md, "Steps"). It says which steps are done, which one is now and what is left.
 *
 * - Marks: the step marks Plan and Tool call use, so one mark means one thing everywhere: a check in a circle for done
 *   (--litt-fg-muted), a half-filled circle for the current step (--litt-fg, never spinning or pulsing) and an empty circle for
 *   what is left (--litt-fg-subtle). Never a number in a colored disc and never the accent: a step is not an action.
 * - Words: the current step's label at the title weight in --litt-fg, done ones in --litt-fg-muted, the rest in --litt-fg-subtle,
 *   with an optional description under each in the vertical form.
 * - Horizontal: one row, a hairline between steps, in --litt-fg once the step before it is done. When its box is narrower
 *   than about 640px it becomes "Step 2 of 4", the current label, and a row of 4px rails, one per step, the done and
 *   current ones in --litt-fg. The box decides, not the screen, so it also fits a narrow panel.
 * - Vertical: a column, with the hairline running down between the marks, for a side panel or a checklist.
 * - Going back: with onStepSelect, done steps are buttons that go back to that step. The current step and what is left
 *   are never buttons: a flow moves forward by its own Continue.
 * - Accessibility: an ordered list named by the label. The current step has aria-current="step", and each step's state
 *   is said in hidden text ("done", "current", "not started"). Nothing animates; the colors change at once.
 */
import type { ReactNode } from "react";
import { StatusIcon } from "./icons";

export type Step = {
  /** Unique, and the React key. */
  id: string;
  /** One or two words: "Details", "Team", "Billing". */
  label: string;
  /** A line under the label, in the vertical form only. */
  description?: ReactNode;
};

export type StepsProps = {
  /** What the flow is, as the list's name: "Set up your studio". */
  label: string;
  steps: Step[];
  /** The index of the step someone is on. Steps before it are done. Set it to steps.length once the flow is finished. */
  current: number;
  /** Makes done steps buttons that go back to that step. */
  onStepSelect?: (index: number) => void;
  /** horizontal fits above a form; vertical fits a side panel or a checklist. */
  orientation?: "horizontal" | "vertical";
  className?: string;
};

type State = "done" | "current" | "todo";
const SAID: Record<State, string> = { done: "done", current: "current", todo: "not started" };
const INK: Record<State, string> = { done: "text-litt-fg-muted", current: "text-litt-fg font-litt-title", todo: "text-litt-fg-subtle" };
const MARK: Record<State, "done" | "running" | "pending"> = { done: "done", current: "running", todo: "pending" };

const back =
  "rounded-litt-control transition-colors duration-(--litt-dur-instant) ease-litt hover:text-litt-fg " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus";

/** The mark, the label and the hidden state of one step, as a button when it can be gone back to. */
function Label({ step, state, onSelect }: { step: Step; state: State; onSelect?: () => void }) {
  const words = (
    <>
      {step.label}
      <span className="sr-only">, {SAID[state]}</span>
    </>
  );
  const mark = <StatusIcon status={MARK[state]} className={"shrink-0 " + (state === "current" ? "text-litt-fg" : state === "done" ? "text-litt-fg-muted" : "text-litt-fg-subtle")} />;
  return onSelect && state === "done" ? (
    <button type="button" onClick={onSelect} className={"flex min-w-0 items-center gap-2 text-left text-litt-small " + INK[state] + " " + back}>
      {mark}
      <span className="min-w-0 truncate">{words}</span>
    </button>
  ) : (
    <span className={"flex min-w-0 items-center gap-2 text-litt-small " + INK[state]}>
      {mark}
      <span className="min-w-0 truncate">{words}</span>
    </span>
  );
}

/** Where someone is in a flow of a few steps: done, now and what is left, in the step marks. */
export function Steps({ label, steps, current, onStepSelect, orientation = "horizontal", className = "" }: StepsProps) {
  const stateOf = (i: number): State => (i < current ? "done" : i === current ? "current" : "todo");
  const now = steps[Math.min(current, steps.length - 1)];
  const finished = current >= steps.length;

  if (orientation === "vertical") {
    return (
      <ol aria-label={label} className={"grid " + className}>
        {steps.map((step, i) => {
          const state = stateOf(i);
          return (
            <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
              <div className="col-span-2">
                <Label step={step} state={state} onSelect={onStepSelect && (() => onStepSelect(i))} />
              </div>
              {/* The hairline down to the next mark, in --litt-fg once this step is done. */}
              <span aria-hidden="true" className={"mx-auto w-px " + (i < steps.length - 1 ? (state === "done" ? "bg-litt-fg" : "bg-litt-line") : "")} />
              <div className={"pb-6 text-litt-small text-litt-fg-subtle " + (i === steps.length - 1 ? "pb-0" : "")}>
                {step.description && <p className="pt-1">{step.description}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className={"@container w-full " + className}>
      {/* Wide: every step in one row. */}
      <ol aria-label={label} className="hidden items-center gap-3 @min-[40rem]:flex">
        {steps.map((step, i) => {
          const state = stateOf(i);
          return (
            <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-3 last:flex-none">
              <Label step={step} state={state} onSelect={onStepSelect && (() => onStepSelect(i))} />
              {i < steps.length - 1 && <span aria-hidden="true" className={"h-px min-w-6 flex-1 " + (state === "done" ? "bg-litt-fg" : "bg-litt-line")} />}
            </li>
          );
        })}
      </ol>

      {/* Narrow: where you are in words, and one rail per step. */}
      <div className="grid gap-2 @min-[40rem]:hidden">
        <p className="flex items-baseline justify-between gap-4">
          <span className="text-litt-small font-litt-title text-litt-fg">{finished ? "All steps done" : now?.label}</span>
          <span className="text-litt-caption font-normal tabular-nums text-litt-fg-subtle">
            {finished ? `${steps.length} of ${steps.length}` : `Step ${current + 1} of ${steps.length}`}
          </span>
        </p>
        <ol aria-label={label} className="flex gap-1">
          {steps.map((step, i) => {
            const state = stateOf(i);
            return (
              <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="flex-1">
                <span className={"block h-1 rounded-litt-control " + (state === "todo" ? "bg-[color-mix(in_oklab,var(--litt-fg)_12%,transparent)]" : "bg-litt-fg")} />
                <span className="sr-only">
                  {step.label}, {SAID[state]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
