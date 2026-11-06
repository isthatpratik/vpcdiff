"use client";
// @litt/accordion 2026.10.19. What changed: https://littmd.vercel.app/changelog.md

/**
 * Accordion: sections that open in place, such as questions and answers, groups of settings or a long spec
 * (components.md, Accordion; decisions 16 and 17). Built on Radix Accordion for the roles, the keyboard and the
 * open state; everything visual is ours.
 *
 * - Look: rows split by 1px --litt-line hairlines, one above the first and one below the last. Each trigger is a
 *   full-width button at least 56px tall, its label at the body size in --litt-fg, left-aligned, with a 16px chevron
 *   in --litt-fg-subtle at the end that brightens to --litt-fg on hover (instant tier, color only). The content sits under
 *   its trigger in --litt-fg-muted at the reading measure (--litt-measure), with space-6 below it. No card, no fills, no accent.
 * - Behavior: one section open at a time by default (type "single", and the open one can close), or several
 *   (type "multiple"). Each trigger sits in a heading, h3 unless headingLevel says otherwise, and carries
 *   aria-expanded and aria-controls (Radix).
 * - Motion, all on the responsive tier. The content's height is never animated: it snaps open. The content
 *   fades in and drops a quarter of the travel token, the chevron turns half a turn, and the rows below move to
 *   their new place by transform (Motion layout="position", so no text stretches). Closing takes the content out
 *   of the flow at once (popLayout) and fades it on the exit token while the rows below rise.
 * - No jump. The root moves by position too, so if something above shifts the whole accordion in the same
 *   render, the hairline on top and the rows move as one block. (Not Motion's layoutRoot: it cuts the rows'
 *   spring short whenever the accordion re-renders mid-flight, and AnimatePresence re-renders it when the
 *   content's fade ends.) While a section closes, the accordion keeps its old height until the content has
 *   faded, so what sits under it (a card's edge, the next section) never covers the rows still rising. Then the
 *   height snaps, as it snapped open.
 * - Reduced motion: the hooks return zero and the duration tokens are zero, so everything snaps.
 * - Touch: there is no hover, so on a coarse pointer a pressed trigger fills at fg 6% (instant tier, color only).
 * - Focus by modality: :focus-visible only, the 2px ring at a 2px offset around the trigger.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ChevronDownIcon } from "./icons";
import { useExit, useTransition, useTravel } from "../../lib/litt/motion";

/* Radix's asChild, spread in: shadcn's CLI rewrites a written asChild to Base UI's render prop in base-* hosts. */
const asChildProps = { asChild: true } as const;

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

type HeadingLevel = 2 | 3 | 4 | 5 | 6;

type RootCtx = {
  /** The values of the open sections. */
  open: string[];
  headingLevel: HeadingLevel;
  /** Keep the accordion at its last settled height while a section's content fades out. */
  hold: () => void;
  /** Let it go again, once every hold is released. */
  release: () => void;
};
const RootContext = createContext<RootCtx | null>(null);
function useRoot(part: string) {
  const ctx = useContext(RootContext);
  if (!ctx) throw new Error(`${part} must be used inside <Accordion>`);
  return ctx;
}

const ItemContext = createContext<{ open: boolean } | null>(null);
function useItem(part: string) {
  const ctx = useContext(ItemContext);
  if (!ctx) throw new Error(`${part} must be used inside <AccordionItem>`);
  return ctx;
}

const toList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

/* -------------------------------------------------------------------------- */
/* Accordion                                                                  */
/* -------------------------------------------------------------------------- */

/** What the open state holds: one value for type "single" ("" when every section is closed), a list for "multiple". */
export type AccordionValue<T extends "single" | "multiple"> = T extends "multiple" ? string[] : string;

export type AccordionProps<T extends "single" | "multiple" = "single"> = {
  /** "single" (the default) keeps one section open at a time, and opening another closes it. "multiple" lets several stay open. */
  type?: T;
  /** With type "single", whether the open section closes when its trigger is pressed again. */
  collapsible?: boolean;
  /** The open section's value, or a list of them with type "multiple", when you control it. Pair it with onValueChange. */
  value?: AccordionValue<T>;
  /** What starts open when you do not control it: a section's value, or a list of them with type "multiple". */
  defaultValue?: AccordionValue<T>;
  /** Called with the new open value each time a section opens or closes: a string ("" when all are closed), or a list with type "multiple". */
  onValueChange?: (value: AccordionValue<T>) => void;
  /** The heading level each trigger sits in. Pick the one that fits the page's outline; the size never changes. */
  headingLevel?: HeadingLevel;
  /** Extra classes for the root, such as a width or a margin. */
  className?: string;
  /** The AccordionItem for each section. */
  children: ReactNode;
};

/** The root. It holds which sections are open, draws the hairline above the first row and keeps the rows still. */
export function Accordion<T extends "single" | "multiple" = "single">({
  type,
  collapsible = true,
  value: valueProp,
  defaultValue,
  onValueChange,
  headingLevel = 3,
  className = "",
  children,
}: AccordionProps<T>) {
  const multiple = type === "multiple";
  const enter = useTransition("responsive");
  const [inner, setInner] = useState<string[]>(() => toList(defaultValue));
  const open = valueProp === undefined ? inner : toList(valueProp);

  const change = (next: string[]) => {
    setInner(next);
    onValueChange?.((multiple ? next : (next[0] ?? "")) as AccordionValue<T>);
  };

  /* The hold. A ResizeObserver keeps the height the accordion last settled at. When a section closes, its
     content leaves the flow in the same commit, before the browser lays out again, so in that commit the
     observer still has the old height: a min-height of that keeps the box still until the content has faded. */
  const rootRef = useRef<HTMLDivElement>(null);
  const settled = useRef(0);
  const holds = useRef(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      if (holds.current === 0) settled.current = el.getBoundingClientRect().height;
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const hold = useCallback(() => {
    const el = rootRef.current;
    if (el && holds.current++ === 0) el.style.minHeight = `${settled.current}px`;
  }, []);
  const release = useCallback(() => {
    if (holds.current === 0) return;
    holds.current -= 1;
    const el = rootRef.current;
    if (el && holds.current === 0) {
      el.style.minHeight = "";
      settled.current = el.getBoundingClientRect().height;
    }
  }, []);

  const ctx = useMemo<RootCtx>(() => ({ open, headingLevel, hold, release }), [open, headingLevel, hold, release]);

  const body = (
    <motion.div ref={rootRef} layout="position" transition={enter} className={"border-t border-litt-line " + className}>
      {children}
    </motion.div>
  );

  return (
    <RootContext.Provider value={ctx}>
      <LayoutGroup>
        {multiple ? (
          <AccordionPrimitive.Root type="multiple" value={open} onValueChange={change} {...asChildProps}>
            {body}
          </AccordionPrimitive.Root>
        ) : (
          <AccordionPrimitive.Root
            type="single"
            collapsible={collapsible}
            value={open[0] ?? ""}
            onValueChange={(v) => change(v ? [v] : [])}
            {...asChildProps}
          >
            {body}
          </AccordionPrimitive.Root>
        )}
      </LayoutGroup>
    </RootContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* AccordionItem                                                              */
/* -------------------------------------------------------------------------- */

export type AccordionItemProps = {
  /** A value unique in this accordion. It is what value, defaultValue and onValueChange speak in. */
  value: string;
  /** Greys the trigger out and keeps it from opening. Arrow keys skip it. */
  disabled?: boolean;
  /** Extra classes for the row. */
  className?: string;
  /** An AccordionTrigger, then an AccordionContent. */
  children: ReactNode;
};

/** One section: the trigger, the content under it, and the hairline below. It moves by transform when a row above it opens or closes. */
export function AccordionItem({ value, disabled = false, className = "", children }: AccordionItemProps) {
  const { open } = useRoot("AccordionItem");
  const enter = useTransition("responsive");
  const isOpen = open.includes(value);
  const item = useMemo(() => ({ open: isOpen }), [isOpen]);

  return (
    <ItemContext.Provider value={item}>
      <AccordionPrimitive.Item value={value} disabled={disabled} {...asChildProps}>
        {/* relative: the content that leaves is placed against the row (popLayout). */}
        <motion.div layout="position" transition={enter} className={"relative border-b border-litt-line " + className}>
          {children}
        </motion.div>
      </AccordionPrimitive.Item>
    </ItemContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* AccordionTrigger                                                           */
/* -------------------------------------------------------------------------- */

const trigger =
  "group/trigger flex min-h-litt-control-lg w-full cursor-pointer items-center gap-4 rounded-litt-control py-4 text-left text-litt-body text-litt-fg font-litt-title " +
  "[-webkit-tap-highlight-color:transparent] transition-[background-color] duration-(--litt-dur-instant) ease-litt " +
  "enabled:pointer-coarse:active:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)] " +
  "disabled:cursor-not-allowed disabled:text-litt-fg-disabled " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus";

export type AccordionTriggerProps = {
  /** The section's name, at the body size. It is the button's accessible name, so keep it short and plain. */
  children: ReactNode;
  /** Extra classes for the button. */
  className?: string;
};

/** The row you press: a full-width button inside a heading, with the label and a chevron that turns half a turn when it opens. */
export function AccordionTrigger({ children, className = "" }: AccordionTriggerProps) {
  const { headingLevel } = useRoot("AccordionTrigger");
  useItem("AccordionTrigger");
  const Heading = `h${headingLevel}` as const;

  return (
    <AccordionPrimitive.Header {...asChildProps}>
      <Heading className="flex">
        <AccordionPrimitive.Trigger className={trigger + " " + className}>
          <span className="min-w-0 flex-1">{children}</span>
          {/* Two layers: the turn is responsive, the color instant, and one element cannot pair two tiers. */}
          <span
            aria-hidden="true"
            className="grid shrink-0 transition-[rotate] duration-(--litt-dur-responsive) ease-litt-responsive group-data-[state=open]/trigger:rotate-180"
          >
            <ChevronDownIcon className="text-litt-fg-subtle transition-colors duration-(--litt-dur-instant) ease-litt group-hover/trigger:text-litt-fg group-disabled/trigger:text-litt-fg-disabled" />
          </span>
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}

/* -------------------------------------------------------------------------- */
/* AccordionContent                                                           */
/* -------------------------------------------------------------------------- */

export type AccordionContentProps = {
  /** What the section holds: text, a list, a few settings. Paragraphs space themselves, so give them a gap or margin. */
  children: ReactNode;
  /** Extra classes, such as text-litt-small for a denser section, or max-w-none for settings rows that should reach the chevron. */
  className?: string;
};

/** The section's content: a region named by its trigger, mounted only while open. Its height snaps; it fades in and drops a little. */
export function AccordionContent({ children, className = "" }: AccordionContentProps) {
  const { hold, release } = useRoot("AccordionContent");
  const { open } = useItem("AccordionContent");
  const enter = useTransition("responsive");
  const exit = useExit("responsive");
  const travel = useTravel();

  /* A section that starts open appears without a fade. Not through AnimatePresence initial={false}: that reaches
     every motion component inside the content and would swallow their own entrances. */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  /* Hold the accordion's height from the commit that closes this section until its content has faded. A section
     that opens again mid-fade cancels the exit, so it lets go then instead. */
  const held = useRef(false);
  const was = useRef(open);
  const letGo = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    release();
  }, [release]);
  useLayoutEffect(() => {
    if (was.current && !open && !held.current) {
      held.current = true;
      hold();
    }
    if (!was.current && open) letGo();
    was.current = open;
  }, [open, hold, letGo]);
  useEffect(() => letGo, [letGo]);

  return (
    <AnimatePresence mode="popLayout" onExitComplete={letGo}>
      {open && (
        <AccordionPrimitive.Content key="content" forceMount {...asChildProps}>
          <motion.div
            initial={mounted.current ? { opacity: 0, y: -travel / 4 } : false}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className={"max-w-(--litt-measure) pb-6 text-litt-body text-litt-fg-muted data-[state=closed]:pointer-events-none " + className}
          >
            {children}
          </motion.div>
        </AccordionPrimitive.Content>
      )}
    </AnimatePresence>
  );
}
