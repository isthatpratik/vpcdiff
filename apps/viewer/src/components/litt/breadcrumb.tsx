"use client";
// @litt/breadcrumb 2026.10.19. What changed: https://littmd.vercel.app/changelog.md

/**
 * Breadcrumb: where a page sits. Studio / Projects / Marlow Labs / Settings.
 *
 * - Anatomy: a nav landmark (named "Breadcrumb" by default) holding an ordered list on one line. Each level is a
 *   link at the small size in fg-muted that turns fg on hover, on the instant tier, color only, with no underline.
 *   The last level is the current page: fg, not a link, with aria-current="page", and it truncates with an
 *   ellipsis instead of wrapping. Between levels a "/" in fg-subtle with --litt-space-2 each side, hidden from screen
 *   readers. No dots, no chevrons (a chevron reads as "opens"), no accent.
 * - Targets: a link's hit area is 32px tall, and 44px on coarse pointers. The extra height is an invisible layer
 *   around the link (::before), so the text never moves and the row keeps its height.
 * - Long trails: past maxVisible levels (four) the middle ones fold into an icon-only ghost sm "…" button (a pill)
 *   named "Show 3 more levels", which opens litt's Menu of them, in order. The first level and the last three
 *   stay. On compact screens (useDevice().compact) only the last two levels show and the rest fold.
 * - Router: links are plain <a> unless you pass renderLink, as the Header takes it (data items, so a function
 *   draws each link). The folded levels are real links in the Menu (MenuItem href) unless you pass onNavigate.
 * - Motion: none. The Menu that holds the folded levels owns its own, on the responsive tier.
 */
import type { ReactNode } from "react";
import { useDevice } from "../../lib/litt/motion";
import { Button } from "./button";
import { MoreIcon } from "./icons";
import { Menu, MenuItem } from "./menu";

/** One level of the trail. */
export type BreadcrumbItem = {
  /** The level's name, as short as the page title allows. */
  label: string;
  /** Where the level goes. Also the key, so give each level its own. The last level is the current page and is not drawn as a link. */
  href: string;
};

/** What renderLink receives to put on your link, so a router link looks exactly like the default. */
export type BreadcrumbLinkProps = {
  /** The breadcrumb's link classes. Pass them to your link. */
  className: string;
  /** The label. Pass it as the link's children. */
  children: ReactNode;
};

export type BreadcrumbProps = {
  /** The levels, outermost first, each `{ label, href }`. The last one is the current page. */
  items: BreadcrumbItem[];
  /** The nav landmark's name. Give each breadcrumb on a page its own. */
  label?: string;
  /** How many levels show before the middle ones fold into the "…" menu: the first level and the last ones. At least 2. Compact screens always show the last two. */
  maxVisible?: number;
  /** Draws each link. Receives the level and the props to pass on. Use it for a router link, for example `(item, props) => <Link href={item.href} {...props} />`. */
  renderLink?: (item: BreadcrumbItem, props: BreadcrumbLinkProps) => ReactNode;
  /** Pass your router's navigate to keep client-side routing in the menu of folded levels. Without it, its rows are plain links. */
  onNavigate?: (item: BreadcrumbItem) => void;
  /** Gap between the "…" button and its menu, in px. In a glass bar, make it reach past the bar's bottom edge, so the menu floats over the page and never over the bar's own glass. */
  menuOffset?: number;
  /** Extra classes for the nav, such as a max width. */
  className?: string;
};

const link =
  "relative inline-flex h-litt-control-sm shrink-0 items-center rounded-litt-control whitespace-nowrap text-litt-fg-muted " +
  "[-webkit-tap-highlight-color:transparent] transition-colors duration-(--litt-dur-instant) ease-litt " +
  "hover:text-litt-fg pointer-coarse:active:text-litt-fg " +
  /* 44px on a finger, without moving the text: the layer is centered on the 32px link and adds 6px above and below. */
  "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-1.5 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus";

/** The "/" between two levels. Decoration: a screen reader hears the list instead. */
function Slash() {
  return (
    <span aria-hidden="true" className="shrink-0 px-2 text-litt-fg-subtle select-none">
      /
    </span>
  );
}

/** Which levels show, and which fold into the "…" menu. */
function fold(items: BreadcrumbItem[], maxVisible: number, compact: boolean) {
  const keep = compact ? 2 : Math.max(2, Math.floor(maxVisible));
  if (items.length <= keep) return { head: [], folded: [], tail: items };
  /* On a phone the current page and its parent are what people need. Elsewhere the root stays too. */
  const head = compact ? [] : items.slice(0, 1);
  const tail = items.slice(items.length - (keep - head.length));
  return { head, folded: items.slice(head.length, items.length - tail.length), tail };
}

/** Where a page sits, from the outermost level to the current page. Long trails fold their middle into a menu. */
export function Breadcrumb({
  items,
  label = "Breadcrumb",
  maxVisible = 4,
  renderLink,
  onNavigate,
  menuOffset = 8,
  className = "",
}: BreadcrumbProps) {
  const { compact } = useDevice();
  if (items.length === 0) return null;
  const { head, folded, tail } = fold(items, maxVisible, compact);
  const current = items[items.length - 1];
  const draw = renderLink ?? ((item: BreadcrumbItem, props: BreadcrumbLinkProps) => <a href={item.href} {...props} />);
  const level = (item: BreadcrumbItem) =>
    item === current ? (
      <span aria-current="page" className="min-w-0 truncate text-litt-fg">
        {item.label}
      </span>
    ) : (
      draw(item, { className: link, children: item.label })
    );
  const more = folded.length === 1 ? "Show 1 more level" : `Show ${folded.length} more levels`;

  const rows: { key: string; node: ReactNode }[] = head.map((item) => ({ key: item.href, node: level(item) }));
  if (folded.length > 0)
    rows.push({
      key: "folded",
      node: (
        <Menu
          align="start"
          sideOffset={menuOffset}
          trigger={
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              aria-label={more}
              /* The round button has its own air around the dots, so it takes 4px of each slash's. And 44px to a
                 finger, like the links, without growing the row. */
              className="-mx-1 pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5"
            >
              <MoreIcon />
            </Button>
          }
        >
          {folded.map((item) => (
            <MenuItem key={item.href} {...(onNavigate ? { onSelect: () => onNavigate(item) } : { href: item.href })}>
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      ),
    });
  for (const item of tail) rows.push({ key: item.href, node: level(item) });

  return (
    <nav aria-label={label} className={"min-w-0 " + className}>
      <ol className="flex h-litt-control-sm min-w-0 items-center text-litt-small">
        {rows.map((row, i) => (
          /* The current page's item may shrink, so it is the one that truncates. */
          <li key={row.key} className={"flex items-center " + (i === rows.length - 1 ? "min-w-0" : "shrink-0")}>
            {i > 0 && <Slash />}
            {row.node}
          </li>
        ))}
      </ol>
    </nav>
  );
}
