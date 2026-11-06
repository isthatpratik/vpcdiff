"use client";
// @litt/card 2026.11.05. What changed: https://littmd.vercel.app/changelog.md

/**
 * Card: a raised surface for one independent object that links somewhere, such as a client site, a
 * build or an invoice. It is a few small parts you compose: Card, CardCover, CardBody, CardTitle,
 * CardDescription and CardLink.
 *
 * - Surface (components.md, Card): `.litt-raised`. The surface radius, surface-1, an inset hairline and the
 *   top highlight, and no outer shadow (R3). Never glass (R3), never an accent rail.
 * - Padding follows the cover. A plain card pads space-6. With an inset cover the card pads space-1 (4px),
 *   the cover takes the control radius (4 + 4 = 8, so the corners nest) and CardBody pads space-4 above and
 *   at the sides, space-3 below. With a bleed cover the card pads nothing, the cover runs to the edges and
 *   takes the card's surface radius at the top, and CardBody pads space-6. Card tells its parts which one it is.
 * - A linked card holds one real link or button (CardLink), stretched over the whole card by its ::after.
 *   That keeps the semantics right (the title is the accessible name, the card is one tab stop) without
 *   wrapping block content in an <a>. Anything else clickable inside the card sits above it with `relative`.
 * - Hover (instant tier, color only): a linked card's fill moves one step, surface-1 to surface-2, and its
 *   cover steps to surface-3 so it keeps its edge. No lift, no shadow growth, no scale; the box never moves.
 *   An unlinked card has no hover. Touch loses nothing, because hover reveals nothing.
 * - Focus by modality: :focus-visible on the link draws the 2px focus ring around the whole card, at a 2px
 *   offset, and the link's own outline is removed so the two never stack.
 * - Light: `lit` adds `.litt-lit .litt-grain` as the card's own top light. It is optional and static (R2).
 *   The page already has one light source (R2), so use it on one card, not on a set.
 * - Motion: none of its own. The entrance cascade for a set of cards belongs to the page (see List and cards).
 */
import { createContext, useContext, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";

/** How a cover sits in its card. "none" is a card with no cover. */
type CoverStyle = "none" | "inset" | "bleed";
const CoverContext = createContext<CoverStyle>("none");

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

const cardPadding: Record<CoverStyle, string> = {
  none: "p-6",
  inset: "p-1",
  bleed: "p-0",
};

const card =
  "litt-raised group/card relative flex min-w-0 flex-col rounded-litt-surface " +
  "transition-[background-color] duration-(--litt-dur-instant) ease-litt " +
  "has-[[data-card-link]]:hover:bg-litt-surface-2";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** The element. Use li when the card sits in a list or grid of ul, and keep article when it stands alone. */
  as?: "article" | "div" | "li" | "section";
  /** How a CardCover sits: inset pads the card by 4px and gives the cover the control radius, bleed runs it to the card's edges. Leave it out for a card with no cover. */
  cover?: "inset" | "bleed";
  /** Adds the card's own light: a soft accent falloff from the top, with a trace of grain. Keep it to one card per page. */
  lit?: boolean;
  /** The card's parts: a CardCover, then a CardBody with a CardTitle and a CardDescription. */
  children?: ReactNode;
  /** Extra classes for the card, such as a max width. */
  className?: string;
};

/** A raised card. A linked card holds a CardLink; its whole surface is the target and its fill steps on hover. */
export function Card({ as: Tag = "article", cover, lit = false, className = "", children, ...rest }: CardProps) {
  const style: CoverStyle = cover ?? "none";
  return (
    <CoverContext.Provider value={style}>
      <Tag className={[card, cardPadding[style], lit ? "litt-lit litt-grain" : "", className].join(" ")} {...rest}>
        {children}
      </Tag>
    </CoverContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* CardCover                                                                  */
/* -------------------------------------------------------------------------- */

type Ratio = "8/5" | "16/9" | "4/3" | "1/1" | "auto";
const ratios: Record<Ratio, string> = {
  "8/5": "aspect-[8/5]",
  "16/9": "aspect-video",
  "4/3": "aspect-[4/3]",
  "1/1": "aspect-square",
  auto: "",
};

const coverShape: Record<CoverStyle, string> = {
  // Padded by 4px, so the surface radius less 4px sits concentric inside the card's: the control radius at every
  // shape but the pill, where the control radius would be rounder than the card.
  none: "rounded-[calc(var(--litt-radius-surface)-4px)]",
  inset: "rounded-[calc(var(--litt-radius-surface)-4px)]",
  // Full-bleed: it takes the card's surface radius at the top. A hairline drawn over it
  // (::before) stands in for the card's own, which the cover would otherwise hide.
  bleed:
    "rounded-t-litt-surface before:pointer-events-none before:absolute before:inset-0 before:z-10 " +
    "before:rounded-t-litt-surface before:shadow-[inset_0_0_0_1px_var(--litt-line)]",
};

export type CardCoverProps = {
  /** An image with alt text, or decorative art that is aria-hidden. It fills the cover. */
  children?: ReactNode;
  /** The cover's shape: 8/5 (the default), 16/9, 4/3, 1/1, or auto to let the content set the height. */
  ratio?: Ratio;
  /** Adds the cover's own light and grain, as a lit hero would have. The art draws over it, so it shows on an empty or transparent cover. */
  lit?: boolean;
  /** Extra classes for the cover. */
  className?: string;
};

/** The picture at the top of a card. It fills surface-2, and steps to surface-3 when its linked card is hovered. */
export function CardCover({ children, ratio = "8/5", lit = false, className = "" }: CardCoverProps) {
  const style = useContext(CoverContext);
  return (
    <div
      data-card-cover=""
      className={[
        "relative shrink-0 overflow-hidden bg-litt-surface-2",
        "transition-[background-color] duration-(--litt-dur-instant) ease-litt",
        "group-has-[[data-card-link]]/card:group-hover/card:bg-litt-surface-3",
        coverShape[style],
        ratios[ratio],
        lit ? "litt-lit litt-grain" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CardBody, CardTitle, CardDescription                                       */
/* -------------------------------------------------------------------------- */

const bodyPadding: Record<CoverStyle, string> = {
  // The card pads space-6 itself.
  none: "",
  // space-4 above and at the sides, space-3 below (components.md).
  inset: "px-4 pt-4 pb-3",
  bleed: "p-6",
};

export type CardBodyProps = {
  /** The text and anything under it. Put the title and description first; a row of tags can follow with `mt-4`, or `mt-auto` to sit at the bottom of a taller card. */
  children?: ReactNode;
  /** Extra classes for the body. */
  className?: string;
};

/** The padded text area under a cover, or the whole card when it has no cover. It grows to fill a taller card. */
export function CardBody({ children, className = "" }: CardBodyProps) {
  const style = useContext(CoverContext);
  return <div className={["flex flex-1 flex-col gap-1", bodyPadding[style], className].join(" ")}>{children}</div>;
}

export type CardTitleProps = {
  /** The heading level. Pick the one that fits the page's outline; it changes the semantics only, never the size. */
  as?: "h2" | "h3" | "h4";
  /** The title text. Wrap it in a CardLink to make the card a link. */
  children: ReactNode;
  /** Extra classes for the title, such as truncate. */
  className?: string;
};

/** The card's name, in body size and fg. A real heading, so a screen reader can list the cards. */
export function CardTitle({ as: Tag = "h3", children, className = "" }: CardTitleProps) {
  return <Tag className={"text-litt-body font-litt-title text-litt-fg " + className}>{children}</Tag>;
}

export type CardDescriptionProps = {
  /** One or two short lines about the card. */
  children: ReactNode;
  /** Extra classes for the description, such as truncate. */
  className?: string;
};

/** Supporting text in small size and fg-subtle. */
export function CardDescription({ children, className = "" }: CardDescriptionProps) {
  return <p className={"text-litt-small text-litt-fg-subtle " + className}>{children}</p>;
}

/* -------------------------------------------------------------------------- */
/* CardLink                                                                   */
/* -------------------------------------------------------------------------- */

const link =
  "cursor-pointer text-left outline-none focus-visible:outline-none " +
  // The stretched target, and the focus ring on the whole card (not on the link's own text).
  "after:absolute after:inset-0 after:rounded-litt-surface " +
  "focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-litt-focus";

export type CardLinkProps = Omit<ComponentProps<"a">, "ref" | "href"> & {
  /** Where the card goes. Leave it out and CardLink renders a button, so use onClick for the action. */
  href?: string;
};

/**
 * The one link or button that makes a card clickable. Put it around the title text. Its ::after covers the
 * whole card, so the card is the target and the title is the name. It must sit inside a Card.
 */
export function CardLink({ href, className = "", children, ...rest }: CardLinkProps) {
  if (href !== undefined) {
    return (
      <a href={href} data-card-link="" className={link + " " + className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      data-card-link=""
      className={link + " " + className}
      {...(rest as ComponentProps<"button">)}
    >
      {children}
    </button>
  );
}
