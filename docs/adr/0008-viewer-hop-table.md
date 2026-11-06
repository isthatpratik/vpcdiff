# 0008: The viewer shows a path strip and a hop table instead of a graph

- **Status:** Accepted
- **Date:** 2026-11-06
- **Amends:** [ADR 0005](0005-viewer-stack.md) (the graph library)

## Context

The viewer drew each path as two lanes of eight boxes in React Flow, and then repeated
the selected hop in an inspector beside it. Most of the screen went to hops that did not
change, and the same facts appeared twice. The maintainer asked for a more elegant and
clearer viewer.

## Decision

- Each path shows a **path strip**: before and after as two rows of squares, one per
  hop, so the difference reads at a glance. A short amber mark sits under each hop that
  differs (or that the plan replaces delete-first).
- Below it, one **hop table**: a hop that differs is open and marked; a hop that is the
  same on both sides folds to one line ("same before and after"). Opening a hop shows the
  rule, the resource with a copy button, and the AWS documentation link for each side.
- React Flow (`@xyflow/react`) is removed. The viewer bundle drops from about 284 KB to
  about 35 KB (before gzip).

## Alternatives considered

- **Keep the graph and remove the inspector.** The graph still gives most space to
  unchanged hops, and pan and zoom add little for a fixed chain of eight hops.

## Consequences

- One runtime dependency fewer.
- The table is plain HTML: keyboard and screen reader behavior come from buttons with
  `aria-expanded`, not from a canvas library.
- `graph.ts` (lanes, changed columns, focus) stays and is still unit tested.
