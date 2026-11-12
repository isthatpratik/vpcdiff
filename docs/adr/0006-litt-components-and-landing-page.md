# 0006: litt.md components, a landing page, and a product demo

- **Status:** Accepted
- **Date:** 2026-11-06
- **Amends:** [ADR 0005](0005-viewer-stack.md) (the viewer stack)
- **Amended 2026-11-12:** the fonts are served from this origin (`apps/viewer/src/fonts`), not from
  Google Fonts, so the policy allows no other origin and a visit sends nothing to a third party.
  The "Fonts" and "Privacy" bullets below describe the original decision.

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
- **Motion:** Sora UI components (MIT; parts derived from Animate UI are MIT plus the
  Commons Clause, which permits use inside an app but not resale of the raw files),
  installed as source with the shadcn CLI. They need only `motion` and
  `class-variance-authority`. Sora's `cn` package dependency is not used; the project's
  own `cn()` (clsx and tailwind-merge) serves.
- **Logos:** CC0 SVG artwork from Logoforge, vendored. No runtime fetch.
- **Fonts:** Google Sans and Google Sans Code from Google Fonts (Source Sans 3 was dropped on 2026-11-06; see DESIGN.md), at the
  maintainer's request.
- **Privacy:** the build keeps `connect-src 'none'` on every page. The policy allows
  `https://fonts.googleapis.com` for styles and `https://fonts.gstatic.com` for fonts, and
  nothing else. Font requests carry no plan data; the landing page footer says that fonts
  load from Google.

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
