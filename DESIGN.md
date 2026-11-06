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
- **Calm.** Black, white, and grays. Color appears only when it means something: a
  status such as new exposure or outage risk.
- **Honest.** When the tool does not know, the interface says `unknown` plainly. Nothing
  is decorated to look more confident than it is.

## 2. Logo

### The mark: open delta

A boundary drawn as a delta (Δ, the symbol for change) with a break in its left side,
and a dot in the break: the place where traffic gets in. It says what the
tool does in one shape: a change to a boundary, and the opening it creates.

| File | Use |
|---|---|
| `docs/brand/mark.svg` | Default, on light surfaces |
| `docs/brand/mark-dark.svg` | On dark surfaces |
| `docs/brand/mark-mono.svg`, `mark-mono-dark.svg` | One color |
| `docs/brand/mark-small.svg` | 20 px and below: thicker stroke, wider break, bigger dot |
| `docs/brand/favicon.svg` | Favicon and app icon: the small mark in white on a `#090909` tile |

Rules:

- The mark is one color: ink on light, white on dark. The dot is the same color as the
  line. Never a status color.
- Keep clear space equal to the dot's diameter on every side.
- No gradients, glows, outlines, rotation, or a closed (unbroken) triangle.

### The wordmark

`vpcdiff` in Google Sans, weight 600, tracking -0.02em, lowercase, in ink. The mark sits
to its left at 1.15 times the cap height, 8 px away.

## 3. Color

### Rationale

- **Monochrome.** The brand is black, white, and a short ramp of neutral grays (litt's
  flat material). It reads like an instrument and lets the product's own content, rule
  text and addresses, carry the page. The accent is the ink color itself: black on
  light, white on dark. Links, focus, selection, and the primary button use it.
- **Two tones of ink do the work of color.** Headings set the claim in ink and the rest
  of the sentence in the subtle gray, so the eye reads the claim first.
- **Status colors keep fixed meanings, and only they have hue.** Red is new exposure,
  green is closed exposure, amber is a change or a risk, gray is unknown. Because the
  rest of the interface has no hue, a status color is always noticed.
- **Hop decisions:** a hop that allows traffic is plain ink (a raised tag), one that
  denies is rose, a partial allow is amber. "Denies" is never red, so it is not read as
  new exposure.
- **The landing page opens dark.** The theme switch still offers light and system. The
  viewer follows the system setting.

### Tokens

Use the litt variables in code (`var(--litt-…)`, Tailwind `bg-litt-…`). The page sets
`data-material="flat"`, so litt's neutral gray ramp applies; vpcdiff sets the accent and
the subtle ink:

| Role | Light | Dark | Token |
|---|---|---|---|
| Canvas | `#fbfbfb` | `#090909` | `--litt-canvas` |
| Surface | `#ffffff` | `#101010` | `--litt-surface-1` |
| Line | `#e5e5e5` | `#252525` | `--litt-line` |
| Ink | `#0f0f0f` | `#f8f8f8` | `--litt-fg` |
| Muted ink | `#676767` | `#c6c6c6` | `--litt-fg-muted` |
| Subtle ink | `#737373` | `#8a8a8a` | `--litt-fg-subtle` |
| Accent (fill, text, focus) | `#0f0f0f` | `#f8f8f8` | `--litt-accent`, `--litt-accent-text`, `--litt-focus` |
| On accent | `#ffffff` | `#090909` | `--litt-accent-fg` |
| New exposure | `#be2e31` | `#ff756f` | `--litt-danger` |
| Closed | `#007c3b` | `#4bc680` | `--litt-success` |
| Changed, outage risk | `#9c5a00` | `#e19b1b` | `--litt-warning` |

### Contrast (measured, WCAG 2)

| Pair | Ratio |
|---|---|
| Ink on canvas, light / dark | 18.5 / 18.7 |
| Primary button text on its fill, light / dark | 19.2 / 18.7 |
| Muted ink on canvas, light / dark | 5.5 / 11.7 |
| Subtle ink on canvas, light / dark | 4.6 / 5.8 |
| Danger, success, warning on white / on dark canvas | 5.8, 5.3, 5.4 / 7.6, 9.2, 8.4 |

Every text pair passes AA. Status always has a label too, never color alone. Lines
(1.2 to 1.3) are decoration and carry no meaning on their own.

## 4. Type

Fonts load from Google Fonts (see section 10 for what that means for privacy).

- **Google Sans:** all text on both pages: interface, headings, and the wordmark.
  Weights 400 to 600. One typeface keeps the landing page and the viewer one product.
  (Source Sans 3 was used for the viewer until 2026-11-06; it read as dated next to
  Google Sans.)
- **Google Sans Code:** code, Terraform addresses (`aws_security_group.db`), CIDRs,
  ports, eyebrow labels.
- Never heavier than 600, never italic.
- Landing headings use the Tailwind scale (`text-5xl` to `text-7xl` for the hero) with
  tight leading and negative tracking; the viewer uses litt's type scale.
- Headings `text-wrap: balance`, body `text-wrap: pretty`. No word alone on a last line.

## 5. Space, shape, depth

- **Spacing:** 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96 px.
- **The landing page frame** (after primora.xyz): a 1200 px column drawn by two 1px
  rails. Sections stack inside it, cut by 1px hairlines that run from edge to edge of
  the screen, 12 px in. Where a hairline meets a rail it stops 12 px short on both
  sides, so lines never cross. Most gaps stay empty; only the crossings that frame the
  tagline hold a 3 px dot, so a dot marks something worth stopping at. Grids of cells inside a section are drawn with the same
  1px line. A few section titles get a 2px ink bar on the left rail. Content sits 64 px
  inside the rails (24 px on small screens).
- **Radius:** controls 8 px (`--litt-radius-control`), landing buttons 6 px, surfaces
  8 px, the footer card 14 px. Cells and framed panels are square. A nested shape gets the outer radius minus
  the gap.
- **Cards:** a framed panel has a plain 1px hairline frame. No corner marks.
- **Feature loops:** after a feature visual plays its intro, one quiet loop keeps it
  alive: a light travels the hop chain, "(known after apply)" shimmers, the outage
  dashes march and the warning dot sends a soft ring, and a caret breathes after
  `connect-src 'none'`. All stop under reduced motion. No cursor spotlight anywhere.
- **Pointer and focus:** everything you can press shows the hand cursor; disabled
  controls show not-allowed. Elements without their own focus style get a 2 px ink
  outline on keyboard focus.
- **Neutral grays in demos:** a Stageshow stage sets its own theme, which brings back
  litt's warm default grays. The hero demo maps litt and the kit to the flat (neutral)
  material in `hero-demo.css`, so no demo reads brown.
- **Tagline:** four chips from a real plan sit around the tagline on wide screens, each
  tied to a word by an elbow leader. A chip and its leader appear when their word
  lights up.
- **Depth:** a hairline, not a shadow, separates things. Dark themes use a lighter
  surface.
- **Plates:** a product panel (the pull request demo, the "How it works" terminals) sits
  on a plate: a surface step with a faint dot grid that fades toward the panel. The panel
  is offset from the top left and runs off the right and bottom edges, after unkey.com.
- **Backgrounds are flat.** No background gradients. The only patterns are faint dot
  grids: behind the final call to action and on plates.

## 6. Motion

- Motion explains cause and effect: a path appears because a rule changed, a hop
  lights up because the engine checked it. Nothing moves for decoration.
- UI feedback is quick (150 to 300 ms). Storytelling motion in product demos is slower
  and follows the Stageshow rules: things arrive whole, nothing pops, loops reset with a
  visible cause.
- Base curve `cubic-bezier(0.22, 1, 0.36, 1)`. Only `transform` and `opacity` animate.
- `prefers-reduced-motion` replaces movement with a plain fade or the final state.
- Landing page motion is few and slow, each part with a cause:
  - The hero field: a plan widens one rule (shown as the cause at the top), and one
    path draws from the internet to the database, hop by hop. The path is never seen to
    retract: the camera whip-pans right (a slow start that speeds up, ease-in), the
    field dims at the fastest point, the view continues on a whole number of grid cells,
    and the start frame slides in from the right and lands on the internet (ease-out).
    The path resets while it is off screen.
  - The hero camera moves on a critically damped spring (no overshoot, soft start, slow
    landing): close on the internet, then it follows each hop as it lights and pulls back
    to the whole path. The caption stays still, like a caption on a frame.
  - Hero depth of field: as the path moves forward, the left of the field drifts out of
    focus (a backdrop blur feathered toward the center, 0 to 5.6 px, in-out), like a lens
    racking focus to follow the head of the line. It clears when the loop begins again.
  - The hero's background blocks are small. About 40% are dimmer at random, and a few at
    a time dim briefly and come back; none is ever brighter than its base.
  - On the left of the hero, the spokes from "any public address" keep moving: one
    spoke at a time snaps its far end to an adjacent block (one cell, 0.28 s, a hard
    ease-out), and only the blocks a spoke lands on are lit.
  - The headline blurs in once. Sections rise 24 px and fade in once.
  - Section bars draw down the rail when the title comes into view.
  - "How it works" is a row of step tabs (Plan, Run, Read, Gate) over a split panel,
    after unkey.com. The steps advance every 7 s, with a thin progress line, until
    someone picks one. Tabs are plain buttons; the focus ring shows for the keyboard
    only. The heading loops through where you run it. Numbers count up.
  - Links draw an underline. Buttons scale their background on hover while the label
    stays still.
  - The Stageshow pull request demo.
  - The footer, after primora.xyz: the name and the mark drawn large in outline, full
    bleed (outside the rails), scrolling sideways without end (linear, because it is
    constant motion), faded at its top and bottom; hairline tracks with moving segments
    above and below it. Both stop under reduced motion. A variable font draws overlapping
    contours when stroked, so the outline is a stroke behind a canvas-colored copy.
  - Film grain on the hero animation only: a self-made 6-frame noise GIF (33 KB) at
    3.5%, after ui-layouts' Noise, served from this origin and faded out radially so it
    melts into the page. Hidden under reduced motion.
  - Sections already on screen at first paint show at once; only sections below the
    fold rise in on scroll.
- **Smooth scroll:** Lenis on the landing page only (ADR 0007), off under reduced
  motion.
- **Frost:** a 240 px band at the foot of the screen, five blur layers from 1.5 px to
  24 px (after primora.xyz). It says "more below" and fades out when the footer comes
  into view.

### The viewer

- **App bar:** the wordmark, then a breadcrumb with the plan's file name in mono, and a
  "Local only" marker. Thin, with a hairline below.
- **Start:** a two-tone headline, a framed drop zone on a dot-grid plate with the
  command to make the file, and the example plans as hairline cells, each with a small
  hop strip. A plan can be dropped anywhere on the page at any time.
- **Path list:** hairline rows; the current row has a 2px bar in its change color, as
  the landing page's titles do. Up and down arrows move through the list.
- **Path detail:** the target type, the path as `internet → target`, the change, the
  port with its service name, and before → after. Then the **verdict** first: what
  happens in one sentence, the hop and rule that decide it (copyable), what to do next
  (with a Terraform snippet when there is a standard fix), and "Copy for PR" as
  Markdown. Then the path strip with a legend, and the hop table (ADR 0008): hops that
  differ are open and marked; hops that are the same fold behind one toggle.
- **Trust:** the list is sorted most serious first (opened, unknown, changed, outage
  risk, closed; open to every address before some; admin and database ports first).
  Unknown is amber, never the grey of a zero. Under the counters, a scope line says what
  is checked ("IPv4 paths from the internet") and links to what is not modeled. When
  the engine calls a path reachable but could not decide some sources, the verdict
  says "Partly undecided" with the reason. The PR Markdown escapes every name and
  rule (no links or @-mentions from a plan), and the plan summary ends with the
  vpcdiff version and the plan's SHA-256, computed in the tab.
- **Words for reach:** "the network lets any public IPv4 address reach …", not
  "anyone can connect": the engine checks the network path, not the host.
- **Plain words:** every hop name, counter, and the Changes / All paths toggle has a
  tooltip in plain language (`src/explain.ts`). One term per state: Allows, Allows some
  sources, Denies, Unknown, Not checked, Not in plan. Ports carry their service name
  (tcp/5432 (PostgreSQL)).
- **Color in the viewer:** red is new exposure, green is closed, amber is only a warning
  (outage risk, some sources). "Differs" is a neutral mark, never amber. States where
  nothing was decided are dashed outlines at full contrast, never faded text.
- **Icons:** line icons from litt's set, monochrome: one per hop (globe, at sign, cloud,
  filter, shield, branch) and one per target type (box for EC2, database for RDS,
  layers for load balancers). AWS's own service logos are filled colored tiles that
  read as blocks at 16 px and would break the rule that color means status.

## 7. Icons and logos

- **Interface icons:** litt's icon set, one size and one stroke weight per screen. No
  hand-drawn glyphs. Hand-drawn marks are allowed only for the vpcdiff logo itself.
- **Product logos** (AWS, Amazon EC2, Amazon RDS, Terraform, GitHub Actions) come from
  [Logoforge](https://logoforge.terravidhal.me/), whose artwork for these marks is CC0
  (from gilbarbara/logos and Simple Icons). They are vendored in `apps/viewer/src/logos/`
  and used only to say what vpcdiff works with: in the subtle ink color (Logoforge's mono
  variants, drawn through a CSS mask) on the landing page, at their original colors and proportions elsewhere.
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

- **litt.md** (MIT): the viewer's controls and surfaces, installed with the shadcn CLI
  into `apps/viewer/src/components/litt/`. Do not hand-build a control litt provides.
- **Sora UI** (MIT; a few parts derive from Animate UI under MIT plus the Commons Clause,
  which allows use in apps but not resale of the raw files): the landing page's motion,
  in `apps/viewer/src/components/sora-ui/`.
- **Stageshow kit** (MIT): the pull request demo, in `apps/viewer/src/stageshow/`.
- **cardcn** (https://cardcn.dev): the framed card started from its basic card
  #6 on litt tokens, in `apps/viewer/src/site/rails.tsx`.
- **Lenis** (MIT): smooth scrolling on the landing page.
- Vendored files are not linted; a change to them is marked with a `vpcdiff patch`
  comment.

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

The viewer never sends plan data anywhere. Its build carries a Content Security Policy
with `connect-src 'none'`, so the page and its worker cannot make a data request. The
landing page holds no plan data; its policy allows `connect-src 'self'` so crawlers and
audit tools can read `robots.txt` and `llms.txt` from the page. CI checks that the
viewer's built page keeps `connect-src 'none'`.

Fonts come from Google Fonts, so a visitor's browser fetches the font stylesheet and font
files from Google (`fonts.googleapis.com`, `fonts.gstatic.com`). Those requests carry no
plan content. The policy allows exactly those two origins for styles and fonts and
nothing else. There are no analytics, no cookies, and no other third party requests; the
footer says so.
