# vpcdiff design system

This file is the source of truth for how vpcdiff looks, sounds, and moves: the landing
page, the web viewer, the README, and anything else with the name on it. It builds on
the [litt.md](https://littmd.vercel.app/) design language (MIT) and adds the vpcdiff
brand on top. When this file and a generic design rule disagree, this file wins.

## 1. The idea

vpcdiff answers one question before `terraform apply`: **what can the internet reach
now that it could not reach before?** The brand should feel like the answer to that
question: exact, calm, and slightly cautious. It is a review tool, so it looks like an
instrument, not a marketing product.

Three words guide every choice:

- **Exact.** Real rule text, real addresses, real ports. Nothing approximate is styled
  as if it were certain.
- **Calm.** Warm neutral surfaces and one quiet accent. Color appears only when it means
  something.
- **Honest.** When the tool does not know, the interface says `unknown` plainly. Nothing
  is decorated to look more confident than it is.

## 2. Logo

### The mark

Two paths start at two open nodes and meet at one solid node. The left path (ink) is
the network before the plan; the right path (accent) is the network after it. The solid
node is the resource they reach. Together they form a V, for VPC.

| File | Use |
|---|---|
| `docs/brand/mark.svg` | Default: on light surfaces |
| `docs/brand/mark-dark.svg` | On dark surfaces |
| `docs/brand/mark-mono.svg`, `mark-mono-dark.svg` | One color: print, embossing, places where blue is not allowed |
| `docs/brand/mark-small.svg` | 20 px and below: the rings are removed so the shape stays clear |
| `docs/brand/favicon.svg` | Favicon and app icon: the small mark on a `#0a0908` tile |

Rules:

- Use the small mark at 20 px and below, the full mark above.
- Keep clear space around the mark equal to the diameter of the solid node on every side.
- Never recolor the two paths with status colors, never swap their order, never add a
  gradient, glow, or outline.

### The wordmark

`vpcdiff` in Geist, weight 600, tracking -0.02em, always lowercase, set in ink. The mark
sits to its left at 1.15 times the cap height, 8 px away, aligned to the center of the x
height. "diff" is never colored differently from "vpc": the accent belongs to the mark.

## 3. Color

### Rationale

- **Warm stone neutrals** (litt's canvas and surfaces) carry almost every pixel. Warm
  grays read as paper and stone rather than as a terminal, which keeps long review
  sessions calm.
- **One cool accent, Signal Blue,** sits opposite the warm neutrals on the color wheel.
  That temperature contrast lets a small amount of blue lead the eye without a second
  brand color. Blue is used for the brand mark, links, focus, and the one primary action
  on a screen.
- **Status colors keep fixed meanings and never double as brand color.** Red is new
  exposure, green is closed exposure, amber is a change or a risk, and neutral gray is
  unknown. Their hues (red near 25°, amber near 75°, green near 145°) sit far from Signal
  Blue (about 255°), so a status can never be mistaken for a link or for the brand.
- **Unknown is gray on purpose.** It is not an error and not a success. Giving it a
  color would suggest the tool knows more than it does.

### Tokens

Use the litt variables in code (`var(--litt-…)`, Tailwind `bg-litt-…`). The vpcdiff
roles map onto them:

| Role | Light | Dark | litt token |
|---|---|---|---|
| Canvas | `#fcfbfa` | `#0a0908` | `--litt-canvas` |
| Surface | `#ffffff` | `#11100f` | `--litt-surface-1` |
| Raised surface | `#f7f5f3` | `#191715` | `--litt-surface-2` |
| Hairline | `#e8e4e1` | `#282421` | `--litt-line` |
| Ink (text) | `#1c1917` | `#f5f4f2` | litt ink |
| Signal Blue (accent) | `#0957fd` | `#0957fd` | `--litt-accent` |
| Accent text and links | `#104dfd` | `#5e78fe` | `--litt-accent-text` |
| New exposure (`added`) | `#be2e31` | `#ff756f` | `--litt-danger` |
| Closed (`removed`) | `#007c3b` | `#4bc680` | `--litt-success` |
| Changed, outage risk | `#9c5a00` | `#e19b1b` | `--litt-warning` |
| Unknown, not reached | litt subtle ink | litt subtle ink | litt subtle ink |

### Contrast (measured, WCAG 2)

| Pair | Ratio |
|---|---|
| Ink on canvas, light / dark | 16.9 / 18.1 |
| Accent text on canvas, light / dark | 5.8 / 5.3 |
| White on Signal Blue (primary button) | 5.5 |
| Danger, success, warning on white | 5.8, 5.3, 5.4 |
| Danger, success, warning on dark canvas | 7.6, 9.2, 8.4 |

Every text pair passes AA (4.5:1). Status is never shown by color alone: each status
also has a label ("New exposure", "Closed", "Changed", "Unknown") and a shape (badge dot).

### Themes

Light and dark are both first class and follow the system setting, with a manual
switch. Material is litt's **flat** material. The accent is litt's default **Blue 4**.

## 4. Type

- **One family: Geist.** Geist Mono only for code, Terraform addresses
  (`aws_security_group.db`), CIDRs, and ports, where the fixed width helps reading.
- Weights: 400 for reading, 500 for titles and labels, 600 for headings and the
  wordmark. Never heavier, never italic.
- Product UI uses litt's type scale (`--litt-type-*`): 13 to 14 px body, 12 px
  captions. The landing page uses the Tailwind scale for its larger steps:
  `text-6xl`/`text-5xl` (hero), `text-4xl` (section), `text-xl` (lead), `text-base`.
- Headings use `text-wrap: balance`; body text uses `text-wrap: pretty`. No word sits
  alone on a last line.

## 5. Space, shape, depth

- **Spacing:** 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96 px. Nothing in between.
- **Radius:** litt's locked shape: 4 px controls, 8 px surfaces, full pills for badges.
  A shape inside another shape gets the outer radius minus the gap between them.
- **Depth:** on light themes, a hairline and litt's raised shadow; on dark themes, a
  lighter surface instead of a shadow. One shadow for hero product shots on the landing
  page.
- **Backgrounds are flat.** No background gradients. The one gradient in the system is
  on the landing page hero heading text.

## 6. Motion

- Motion explains cause and effect: a path appears because a rule changed, a hop
  lights up because the engine checked it. Nothing moves for decoration.
- UI feedback is quick (150 to 300 ms). Storytelling motion in product demos is slower
  and follows the Stageshow rules: things arrive whole, nothing pops, loops reset with a
  visible cause.
- Base curve `cubic-bezier(0.22, 1, 0.36, 1)`. Only `transform` and `opacity` animate.
- `prefers-reduced-motion` replaces movement with a plain fade or the final state.

## 7. Icons and logos

- **Interface icons:** litt's icon set, one size and one stroke weight per screen. No
  hand-drawn glyphs.
- **Product logos** (AWS, Amazon EC2, Amazon RDS, Terraform, GitHub Actions) come from
  [Logoforge](https://logoforge.terravidhal.me/), whose artwork for these marks is CC0
  (from gilbarbara/logos and Simple Icons). They are vendored in `apps/viewer/src/logos/`
  and used only to say what vpcdiff works with, at their original colors and proportions.
  The names and marks remain trademarks of their owners; vpcdiff is not affiliated with
  or endorsed by them.
- No sparkles, no robots, no purple "AI" color.

## 8. Voice

- **Plain and specific.** "Opens tcp/5432 on `aws_instance.db` to the internet", not
  "Detects risky changes".
- **Say what the tool does, then why it matters.** Lead with the outcome.
- **No hype.** Never "revolutionize", "supercharge", "effortless", "AI powered", or
  "world class". No exclamation marks.
- **No invented facts.** Numbers on the landing page come from the repository (tests,
  fixtures, supported resources), never from imagination.
- **Sentence case** for headings and buttons. No hyphens inside running copy; rephrase.
- **Errors say what failed and what to do next.** "This file is not valid JSON. Open the
  output of terraform show -json."

## 9. Components

The viewer and the landing page use litt.md components, installed with the shadcn CLI
from `https://littmd.vercel.app/r/<name>.json` into `apps/viewer/src/components/ui/`.
Do not hand-build a control that litt provides. vpcdiff-specific parts (the hop graph,
the path row, the hop inspector) are composed from litt parts and tokens.

Status in components:

| Change | Label | Color |
|---|---|---|
| `added` | New exposure | danger |
| `removed` | Closed | success |
| `changed` | Sources changed | warning |
| `unknown` | Unknown | subtle ink |
| `unchanged` | No change | subtle ink, quieter |
| outage risk | Outage risk during apply | warning |

## 10. Privacy is part of the design

The viewer never sends plan data anywhere. The interface says so once, quietly, in the
header, and the build enforces it with a Content Security Policy (`connect-src 'none'`).
The landing page also makes no third party requests: no analytics, no web fonts from a
CDN, no embedded scripts.
