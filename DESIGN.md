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

### The mark: open delta

A boundary drawn as a delta (Δ, the symbol for change) with a break in its left side,
and a Signal Cyan dot in the break: the place where traffic gets in. It says what the
tool does in one shape: a change to a boundary, and the opening it creates.

| File | Use |
|---|---|
| `docs/brand/mark.svg` | Default, on light surfaces |
| `docs/brand/mark-dark.svg` | On dark surfaces and on Harbor |
| `docs/brand/mark-mono.svg`, `mark-mono-dark.svg` | One color |
| `docs/brand/mark-small.svg` | 20 px and below: thicker stroke, wider break, bigger dot |
| `docs/brand/favicon.svg` | Favicon and app icon: the small mark on a `#0a0908` tile |

Rules:

- The dot is always Signal Cyan (or the one mono color). Never a status color.
- Keep clear space equal to the dot's diameter on every side.
- No gradients, glows, outlines, rotation, or a closed (unbroken) triangle.

### The wordmark

`vpcdiff` in Google Sans, weight 600, tracking -0.02em, lowercase, in ink. The mark sits
to its left at 1.15 times the cap height, 8 px away. On the landing page the wordmark may
carry a small `v0.1` tag in Google Sans Code.

## 3. Color

### Rationale

- **Warm stone neutrals** (litt's canvas and surfaces) carry most pixels. They read as
  paper and stone rather than a terminal.
- **Signal Cyan is the one brand and action color.** Cyan is cool and technical (a
  network cable, a terminal cursor) and sits opposite the warm neutrals, so a little of
  it leads the eye. It marks the brand, links, focus, selection, and the primary action.
- **Harbor is the depth color.** A deep navy teal (`#0b2027`) for the navigation capsule
  and inverted bands. It gives the page contrast and rhythm without adding a hue, and
  cyan glows on it.
- **Status colors keep fixed meanings.** Red is new exposure, green is closed exposure,
  amber is a change or a risk, gray is unknown. Their hues (about 25°, 75°, 145°) stay
  clear of cyan (about 195°).
- **Hop decisions use data hues, not status colors.** A hop that allows traffic is teal,
  one that denies is rose, a partial allow is amber, so "allows" is never read as
  "closed" and "denies" never as "new exposure".
- **Tinted surfaces carry meaning on the landing page.** A section about hops sits on a
  cyan tint, outage risk on an amber tint, privacy on Harbor. Color is used where it
  says something, never as decoration.

### Tokens

Use the litt variables in code (`var(--litt-…)`, Tailwind `bg-litt-…`); vpcdiff sets
the accent and adds Harbor:

| Role | Light | Dark | Token |
|---|---|---|---|
| Canvas | `#fcfbfa` | `#0a0908` | `--litt-canvas` |
| Surface | `#ffffff` | `#11100f` | `--litt-surface-1` |
| Ink | `#110f0d` | `#f9f8f7` | `--litt-fg` |
| Signal Cyan (fill) | `#0e7490` | `#22d3ee` | `--litt-accent` |
| Signal Cyan (text, focus) | `#0e7490` | `#22d3ee` | `--litt-accent-text`, `--litt-focus` |
| On cyan | `#ffffff` | `#0a0908` | `--litt-accent-fg` |
| Cyan tint | `#e6f4f7` | `#082f38` | `--litt-accent-tint` |
| Harbor | `#0b2027` | `#0b2027` | `--vd-harbor` |
| New exposure | `#be2e31` | `#ff756f` | `--litt-danger` |
| Closed | `#007c3b` | `#4bc680` | `--litt-success` |
| Changed, outage risk | `#9c5a00` | `#e19b1b` | `--litt-warning` |

### Contrast (measured, WCAG 2)

| Pair | Ratio |
|---|---|
| Ink on canvas, light / dark | 16.9 / 18.1 |
| White on Signal Cyan `#0e7490` (primary button, light) | 5.4 |
| Dark ink on Signal Cyan `#22d3ee` (primary button, dark and on Harbor) | 11.0 |
| Cyan text on canvas, light / dark | 5.2 / 11.0 |
| Danger, success, warning on white / on dark canvas | 5.8, 5.3, 5.4 / 7.6, 9.2, 8.4 |

Every text pair passes AA. Status always has a label too, never color alone.

## 4. Type

Fonts load from Google Fonts (see section 10 for what that means for privacy).

- **Google Sans:** the landing page, all headings, and the wordmark. Weights 400 to 600.
- **Source Sans 3:** the viewer's interface text, chosen for dense, long reading.
- **Google Sans Code:** code, Terraform addresses (`aws_security_group.db`), CIDRs,
  ports, eyebrow labels.
- Never heavier than 600, never italic.
- Landing headings use the Tailwind scale (`text-5xl` to `text-7xl` for the hero) with
  tight leading and negative tracking; the viewer uses litt's type scale.
- Headings `text-wrap: balance`, body `text-wrap: pretty`. No word alone on a last line.

## 5. Space, shape, depth

- **Spacing:** 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96 px.
- **Radius:** controls 8 px (`--litt-radius-control`), landing buttons 10 px, the
  navigation capsule and its button fully round, cards 18 px, surfaces 8 px. A nested
  shape gets the outer radius minus the gap.
- **Depth:** light themes use a hairline and a soft shadow; dark themes use a lighter
  surface. Harbor bands create depth on both.
- **Backgrounds are flat.** No background gradients.

## 6. Motion

- Motion explains cause and effect: a path appears because a rule changed, a hop
  lights up because the engine checked it. Nothing moves for decoration.
- UI feedback is quick (150 to 300 ms). Storytelling motion in product demos is slower
  and follows the Stageshow rules: things arrive whole, nothing pops, loops reset with a
  visible cause.
- Base curve `cubic-bezier(0.22, 1, 0.36, 1)`. Only `transform` and `opacity` animate.
- `prefers-reduced-motion` replaces movement with a plain fade or the final state.
- Landing page motion comes from Sora UI and Stageshow, each used where it carries
  meaning: the headline blurs in and a cyan marker draws under "opens to the internet";
  section headings fog or blur in on scroll; "How it works" loops through where you run
  it; "How it is checked" types each hop; numbers count up; the final call to action
  types itself in; nav and footer links draw an underline; buttons scale their background
  on hover while the label stays still. A frosted band at the foot of the screen says
  "more below" and fades out at the end of the page.

## 7. Icons and logos

- **Interface icons:** litt's icon set, one size and one stroke weight per screen. No
  hand-drawn glyphs. Hand-drawn marks are allowed only for the vpcdiff logo itself.
- **Product logos** (AWS, Amazon EC2, Amazon RDS, Terraform, GitHub Actions) come from
  [Logoforge](https://logoforge.terravidhal.me/), whose artwork for these marks is CC0
  (from gilbarbara/logos and Simple Icons). They are vendored in `apps/viewer/src/logos/`
  and used only to say what vpcdiff works with: in one color (Logoforge's mono
  variants) on the landing page, at their original colors and proportions elsewhere.
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
- **Stageshow kit** (MIT): the hero product demo, in `apps/viewer/src/stageshow/`.
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
with `connect-src 'none'`, so the page and its worker cannot make a data request.

Fonts come from Google Fonts, so a visitor's browser fetches the font stylesheet and font
files from Google (`fonts.googleapis.com`, `fonts.gstatic.com`). Those requests carry no
plan content. The policy allows exactly those two origins for styles and fonts and
nothing else. There are no analytics, no cookies, and no other third party requests; the
footer says so.
