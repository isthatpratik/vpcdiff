# 0006: litt.md components, a landing page, and a product demo

- **Status:** Accepted
- **Date:** 2026-11-06
- **Amends:** [ADR 0005](0005-viewer-stack.md) (the viewer stack)

## Context

The maintainer asked for a professional brand and a less generic interface: the viewer
rebuilt on the [litt.md](https://littmd.vercel.app/) component library, product logos
from [Logoforge](https://logoforge.terravidhal.me/), a landing page for the tool, and an
animated product demo built with the Stageshow kit. ADR 0005 chose hand-made styles and
three runtime dependencies; this changes that.

## Decision

- **Components:** litt.md (MIT), installed as source with the shadcn CLI. Its
  components need Tailwind CSS v4, `motion`, Radix UI primitives, `clsx`, and
  `tailwind-merge`. These become dependencies of `apps/viewer` only.
- **Styling:** Tailwind CSS v4 through `@tailwindcss/vite` (build time), with litt's
  tokens. The design rules live in `DESIGN.md`.
- **Pages:** the viewer app becomes a two-page static site: the landing page at `/`
  and the tool at `/app/`. Both are built by Vite and served from the same origin.
- **Product demo:** the Stageshow kit (MIT), vendored under
  `apps/viewer/src/stageshow/`. It needs `lucide-react` for its `Icon` part.
- **Logos:** CC0 SVG artwork from Logoforge, vendored. No runtime fetch.
- **Privacy is unchanged:** the build keeps the Content Security Policy with
  `connect-src 'none'` on every page, and no page loads anything from another origin.
  Fonts stay vendored.

The engine keeps zero runtime dependencies. The CLI and the GitHub Action are not
affected.

## Alternatives considered

- **Keep hand-made styles:** the maintainer judged the result generic.
- **shadcn/ui defaults:** the most common look on the web, which is the problem.
- **A separate repository or framework for the landing page:** two toolchains for one
  small site, and the demo could not reuse the viewer's real parts.

## Consequences

- The viewer bundle grows (motion, Radix). It is still a static site with no backend.
- litt components are source files in the repo; updates are deliberate, through the
  shadcn CLI, and reviewed like any code.
- `DESIGN.md` is now the reference for visual decisions; generic design skills defer to
  it on visual values.
