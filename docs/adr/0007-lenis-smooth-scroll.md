# 0007: Lenis for smooth scrolling on the landing page

- **Status:** Accepted
- **Date:** 2026-11-06
- **Amends:** [ADR 0006](0006-litt-components-and-landing-page.md) (the landing page)

## Context

The maintainer asked for the landing page to scroll with the weight and inertia of
sites like polar.sh and primora.xyz, and approved one new runtime dependency for it.
Native scrolling has no easing on wheel input, and CSS `scroll-behavior: smooth` only
eases jumps to an anchor.

## Decision

- Add [Lenis](https://github.com/darkroomengineering/lenis) (MIT, no dependencies of
  its own) to `apps/viewer`.
- Load it on the landing page only (`src/site/smooth.ts`). The viewer at `/app/` never
  imports it, so the tool keeps native scrolling for long path lists.
- Turn it off when the visitor asks for reduced motion. Anchor links use it with an
  offset for the fixed navigation.
- Lenis does no network requests, so the privacy rule and the viewer's Content Security
  Policy do not change.

## Alternatives considered

- **CSS `scroll-behavior: smooth`.** Free, but eases only anchor jumps, not the wheel.
- **A hand-written scroll smoother.** Possible, but scroll handling has many edge cases
  (touch, keyboard, nested scroll areas) that Lenis already handles.

## Consequences

- One more runtime dependency in `apps/viewer`, about 4 KB gzipped, in the landing
  page's bundle only.
- Scroll-linked effects on the landing page (the tagline reveal, the frost band) still
  read the native scroll position, which Lenis keeps in sync.
