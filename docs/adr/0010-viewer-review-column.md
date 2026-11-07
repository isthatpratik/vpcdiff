# 0010: The viewer is one review column, not a sidebar and a detail pane

- **Status:** Accepted
- **Date:** 2026-11-07
- **Amends:** [ADR 0008](0008-viewer-hop-table.md) (page layout only; the path strip and
  the hop table stay)

## Context

The viewer put the plan summary, the filters, and the path list in a 360 px sidebar,
with the selected path's detail beside it. Most plans have a few paths (each fixture
has one or two), so the sidebar was mostly empty below the list and took a quarter of
the screen from the detail. The plan verdict in the sidebar and the path verdict next to
it said almost the same thing side by side. On phones the sidebar stacked above the
detail, which pushed the verdict below the first screen. The maintainer asked for a
better layout (issue #74).

## Decision

- One centered column, at most 1040 px wide, in the way a pull request lists changed
  files.
- A **plan header** on top: the plan verdict as the page heading, the scope line and the
  "not modeled" link, "Copy all for PR", the counters as filters, the Changes / All
  toggle, and search.
- Each path is a **card**. Its header row shows the target, the port, the sources, the
  before → after words, and the change. A click opens the detail inside the card: the
  verdict panel, the path strip, and the hop table.
- The most serious path opens by default. More than one card can be open, and "Open
  all" / "Close all" appears when the list has more than one path. The header of an open
  card stays at the top while its detail scrolls.
- The URL remembers the card opened last, as it remembered the selected path before.
- The detail is mounted only while its card is open, so a plan with many paths stays
  light.
- Phones and wide screens use the same layout.

## Alternatives considered

- **Keep the sidebar and make it narrower.** The empty space gets smaller but stays, and
  the two verdicts still sit side by side.
- **A path table on top and one detail below.** It works for many paths, but a click
  moves the eye from the table to a different place on the page, and for one path the
  table only repeats the detail's title.
- **Paths as horizontal tabs.** Terraform addresses are long, so tabs overflow after two
  or three paths.

## Consequences

- The detail gets the full column width, and the plan verdict is the first thing on the
  page on every screen size.
- With many open cards the page gets long; "Close all" and the sticky card header keep
  it usable.
- Up, Down, Home, and End now move between card headers instead of list rows.
