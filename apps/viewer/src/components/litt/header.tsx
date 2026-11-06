"use client";
// @litt/header 2026.11.02. What changed: https://littmd.vercel.app/changelog.md

/**
 * Header: the site header. Sticky glass, a wordmark, a nav and right-aligned actions.
 *
 * - Surface: litt-glass on a sticky bar of --litt-header-h, full-bleed so it sets rounded-none
 *   (.litt-glass carries the surface radius). It sticks at the safe-area inset, like the
 *   gallery shell. Glass is only honest with content passing under it, so the page that
 *   uses it must scroll beneath.
 * - Content sits in a max-w-litt-wide wrap with the page gutter. Order: wordmark, nav, actions.
 * - Nav links are small type in fg-subtle. Hover is fg on an fg-6% fill (instant tier,
 *   color and background-color only). The current page is raised (R3): the press material's
 *   block (--litt-block, --litt-block-lift) in fg, as a switch's block and a selected segment are, and
 *   aria-current="page". It keeps that look under the pointer. There is no dot. In the menu the current page
 *   carries a check in the icon cell, like a picked option.
 * - Responsive by container, not viewport. The bar asks how wide it is (a CSS container
 *   query), so it behaves the same as a full-bleed header on a page and inside a frame,
 *   and it needs no JavaScript or hydration to pick a layout. Below navFrom the links are
 *   not squeezed or wrapped: they leave the bar and live behind a menu button that opens
 *   litt's Menu (responsive tier, owned by Menu). Actions stay in the bar.
 * - No router. Links take an href and a current flag. renderLink swaps the anchor for your
 *   router's link. The menu's rows are real links too (MenuItem href), unless you pass
 *   onNavigate: then choosing a row calls it, for client-side routing.
 * - Only one nav is ever visible, so there is always exactly one landmark.
 *
 * On a phone (foundations.md section 6)
 * - The nav stays behind the menu button, and the button opens the anchored dropdown (Menu's own
 *   phone behavior, which is only a list here). The bar is container-driven, so a bar narrower than
 *   navFrom shows the button on any screen, and a phone is always narrower than 640.
 * - The bar stays sticky at the safe-area inset and never hides on scroll: nothing here reads the
 *   scroll position, and nothing moves it.
 * - On coarse screens the links, the wordmark link and the menu button are --litt-control-md tall (44px),
 *   and a pressed link fills like a hovered one (pointer-coarse:active:, instant tier, color only),
 *   because a finger has no hover.
 */
import type { ReactNode } from "react";
import { Button } from "./button";
import { CheckIcon, MenuIcon } from "./icons";
import { Menu, MenuItem } from "./menu";

/** One nav link. */
export type HeaderLink = {
  /** The link text. Keep it to one or two short words. */
  label: string;
  /** Where the link goes. Also the key, so give each link its own. */
  href: string;
  /** Marks the page you are on: sets aria-current="page" and lights the link. Set it on at most one link. */
  current?: boolean;
};

/** What renderLink receives to put on your link, so a router link looks exactly like the default. */
export type HeaderLinkProps = {
  /** The header's link classes. Pass them to your link. */
  className: string;
  /** "page" on the current link and undefined on the rest. Pass it to your link. */
  "aria-current"?: "page";
  /** The label. Pass it as the link's children. */
  children: ReactNode;
};

export type HeaderProps = {
  /** The brand: usually a link home that wraps the studio name or a logo. A logo needs an aria-label on the link. */
  wordmark: ReactNode;
  /** The nav links, in order, each `{ label, href, current? }`. Four to six short ones fit the bar. For more, group them behind a page. Leave it empty for a bar with only a wordmark and actions. */
  links: HeaderLink[];
  /** Right-aligned actions, for example one primary Button. They stay in the bar on a phone, so keep it to one or two. */
  actions?: ReactNode;
  /** The nav landmark's name. Give each header on a page its own. */
  navLabel?: string;
  /** Where the links appear in the bar, measured on the header's own width: sm is 640px, lg is 1024px. Below it they move behind the menu button. Use sm for up to four short links and one action. */
  navFrom?: "sm" | "lg";
  /** Draws each link. Receives the link and the props to pass on. Use it for a router link, for example `(link, props) => <Link to={link.href} {...props} />`. */
  renderLink?: (link: HeaderLink, props: HeaderLinkProps) => ReactNode;
  /** Pass your router's navigate to keep client-side routing in the menu. Without it, the menu's rows are plain links. */
  onNavigate?: (link: HeaderLink) => void;
  /** The menu button's accessible name. */
  menuLabel?: string;
  /** Extra classes for the header element, such as a z-index. */
  className?: string;
};

/* Container queries must be written out in full for Tailwind to find them. */
const FROM = {
  sm: { nav: "hidden @min-[40rem]:block", menu: "@min-[40rem]:hidden" },
  lg: { nav: "hidden @min-[64rem]:block", menu: "@min-[64rem]:hidden" },
} as const;

const link =
  "relative flex h-litt-control-sm items-center rounded-litt-control px-litt-control-pad-sm text-litt-small whitespace-nowrap select-none " +
  "[-webkit-tap-highlight-color:transparent] transition-[background-color,color] duration-(--litt-dur-instant) ease-litt " +
  "pointer-coarse:h-litt-control-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-litt-focus";
/* The current page is raised (R3); the others fill on hover, and on a press on touch. */
const current = "bg-litt-block text-litt-fg shadow-(--litt-block-lift) forced-colors:border";
const other =
  "text-litt-fg-subtle hover:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)] hover:text-litt-fg " +
  "pointer-coarse:active:bg-[color-mix(in_oklab,var(--litt-fg)_6%,transparent)] pointer-coarse:active:text-litt-fg";

/** The sticky glass header. It sits at the top of the page, with content that scrolls under it. */
export function Header({
  wordmark,
  links,
  actions,
  navLabel = "Main",
  navFrom = "lg",
  renderLink,
  onNavigate,
  menuLabel = "Menu",
  className = "",
}: HeaderProps) {
  const from = FROM[navFrom];
  const draw = renderLink ?? ((l: HeaderLink, props: HeaderLinkProps) => <a href={l.href} {...props} />);
  return (
    /* Full-bleed, so no corners: .litt-glass carries the surface radius. */
    <header className={"litt-glass sticky top-[env(safe-area-inset-top,0px)] z-30 rounded-none " + className}>
      {/* The bar is the container, so the layout follows the width it is given. */}
      <div className="@container">
        <div className="mx-auto flex h-(--litt-header-h) max-w-litt-wide items-center gap-4 px-litt-gutter @min-[40rem]:gap-6">
          <div className="flex shrink-0 items-center text-litt-body font-litt-title text-litt-fg [&_a]:rounded-litt-control [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-litt-focus pointer-coarse:[&_a]:inline-flex pointer-coarse:[&_a]:h-litt-control-md pointer-coarse:[&_a]:items-center">
            {wordmark}
          </div>

          {links.length > 0 && (
            <nav aria-label={navLabel} className={"ml-4 " + from.nav}>
              <ul className="flex items-center gap-1">
                {links.map((l) => (
                  <li key={l.href}>
                    {draw(l, {
                      className: link + " " + (l.current ? current : other),
                      "aria-current": l.current ? "page" : undefined,
                      children: <span className="litt-trim">{l.label}</span>,
                    })}
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="ml-auto flex items-center gap-3">
            {actions}
            {links.length > 0 && (
              <nav aria-label={navLabel} className={from.menu}>
                <Menu
                  label={navLabel}
                  align="end"
                  /* The 44px button sits 10px above the bar's bottom edge. 8 more clears the bar, so the menu
                     floats over the page and never over its own glass. */
                  sideOffset={18}
                  trigger={
                    <Button iconOnly variant="ghost" aria-label={menuLabel}>
                      <MenuIcon />
                    </Button>
                  }
                >
                  {links.map((l) => (
                    <MenuItem
                      key={l.href}
                      icon={l.current ? <CheckIcon /> : <span />}
                      /* A real link by default; with onNavigate, the router does the navigating. */
                      {...(onNavigate ? { onSelect: () => onNavigate(l) } : { href: l.href })}
                    >
                      {l.label}
                      {l.current && <span className="sr-only">, current page</span>}
                    </MenuItem>
                  ))}
                </Menu>
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
