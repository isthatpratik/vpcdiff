import { useEffect } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { Tag } from "@/components/litt/tag";
import { TooltipProvider } from "@/components/litt/tooltip";
import { TextLoop } from "@/components/sora-ui/texts/text-loop";
import aws from "../logos/aws-icon-mono.svg?url";
import actions from "../logos/github-actions-icon-mono.svg?url";
import nodejs from "../logos/nodejs-icon-mono.svg?url";
import terraform from "../logos/terraform-icon-mono.svg?url";
import { Mark, REPO, Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeCycle } from "../shared/theme.tsx";
import { Cta } from "./Cta.tsx";
import { HeroDemo } from "./HeroDemo.tsx";
import { PathField } from "./PathField.tsx";
import { Footer } from "./Footer.tsx";
import { HopStrip } from "./HopStrip.tsx";
import { Plate } from "./Plate.tsx";
import { Tagline } from "./Tagline.tsx";
import { CliSection } from "./Terminal.tsx";
import { StepTabs } from "./StepTabs.tsx";
import { Divider, EASE, PAD, Rail, SectionHead, useInViewOnce } from "./rails.tsx";
import { ScrollFrost } from "./ScrollFrost.tsx";
import { startSmoothScroll } from "./smooth.ts";

const APP = "./app/";

/* ---- Feature visuals: each shows its idea working, in the product's own words. ---- */

const HOP_NAMES = ["Public IP", "Gateway", "NACL in", "Groups", "NACL out", "Route"];

/** The hops as a short path: squares on a line that fill in order. */
function HopChain({ on }: { on: boolean }) {
  return (
    <ol className="relative grid grid-cols-6" aria-label="The six hops, in the order traffic meets them">
      {HOP_NAMES.map((h, i) => (
        <li key={h} className="relative grid content-start justify-items-start gap-3">
          {i < HOP_NAMES.length - 1 && (
            <span aria-hidden="true" className={`absolute top-[5px] left-3 h-px w-[calc(100%-12px)] origin-left bg-litt-fg transition-transform duration-500 ${EASE} ${on ? "scale-x-100" : "scale-x-0"}`} style={{ transitionDelay: `${200 + i * 160}ms` }} />
          )}
          <span aria-hidden="true" className={`relative size-3 border border-litt-fg transition-colors duration-300 ${on ? "bg-litt-fg" : "bg-litt-canvas"}`} style={{ transitionDelay: `${120 + i * 160}ms` }} />
          <span className="pr-2 font-litt-mono text-litt-caption leading-tight text-litt-fg-muted">{h}</span>
        </li>
      ))}
      {/* After the chain fills, a soft light travels it, the way a packet meets each hop in order. */}
      <li aria-hidden="true" className="pointer-events-none absolute top-[5px] left-1.5 h-px w-[83.333%]">
        {on && (
          <span className="absolute inset-y-0 left-0 w-full opacity-0 motion-safe:animate-[hop-packet_4.2s_cubic-bezier(0.65,0,0.35,1)_1.6s_infinite]">
            <span className="absolute top-1/2 -left-[3px] size-[7px] -translate-y-1/2 rounded-full bg-litt-fg shadow-[0_0_0_3px_color-mix(in_oklab,var(--litt-fg)_14%,transparent),0_0_12px_2px_color-mix(in_oklab,var(--litt-fg)_35%,transparent)]" />
          </span>
        )}
      </li>
    </ol>
  );
}

function UnknownLine() {
  return (
    <div className="grid gap-3 border border-litt-line bg-litt-surface-1 p-4 font-litt-mono text-litt-small" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-litt-fg">gateway_id</span>
        <span className="text-litt-fg-subtle">=</span>
        <span className="text-litt-fg-muted motion-safe:animate-[unknown-shimmer_3.2s_linear_infinite] motion-safe:bg-[linear-gradient(90deg,var(--litt-fg-subtle)_0%,var(--litt-fg-subtle)_40%,var(--litt-fg)_50%,var(--litt-fg-subtle)_60%,var(--litt-fg-subtle)_100%)] motion-safe:bg-[length:250%_100%] motion-safe:bg-clip-text motion-safe:text-transparent">(known after apply)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tag status="neutral">Unknown</Tag>
        <span className="font-litt-sans text-litt-caption text-litt-fg-subtle">the route's target is set at apply time</span>
      </div>
    </div>
  );
}

function OutageTimeline({ on }: { on: boolean }) {
  return (
    <div className="grid gap-3 font-litt-mono text-litt-caption" aria-hidden="true">
      <div className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2">
        <span className="border border-litt-line-strong px-2 py-1.5 text-center text-litt-fg-muted">delete</span>
        <span className="relative h-8">
          <span className={`absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--litt-fg)_0_4px,transparent_4px_8px)] transition-[clip-path] duration-1000 ${EASE} ${on ? "motion-safe:animate-[dash-march_1.6s_linear_1.2s_infinite]" : ""}`} style={{ clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }} />
        </span>
        <span className="border border-litt-line-strong px-2 py-1.5 text-center text-litt-fg-muted">create</span>
      </div>
      <p className={`flex items-center justify-center gap-2 font-litt-sans text-litt-small text-litt-fg transition-opacity duration-500 ${on ? "opacity-100 delay-700" : "opacity-0"}`}>
        <span className="relative size-1.5 rounded-full bg-litt-warning">
          {on && <span aria-hidden="true" className="absolute inset-0 rounded-full bg-litt-warning opacity-0 motion-safe:animate-[soft-ping_2.4s_cubic-bezier(0.22,1,0.36,1)_1.4s_infinite]" />}
        </span>
        traffic can drop here
      </p>
    </div>
  );
}

function Features() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>("0px 0px -20% 0px");
  const cell = "grid content-between gap-12 bg-litt-canvas px-6 py-10 md:px-16 md:py-14";
  const title = "font-display text-2xl leading-tight font-normal tracking-[-0.02em] text-litt-fg";
  const body = "max-w-[46ch] text-base text-litt-fg-muted";
  const label = "font-litt-mono text-litt-caption text-litt-fg-subtle";
  return (
    <div ref={ref} className="grid gap-px border-t border-litt-line bg-litt-line md:grid-cols-2">
      <article className={cell}>
        <div className="grid gap-3">
          <span className={label}>01 · hop by hop</span>
          <h3 className={title}>Every hop, with the rule that decided it</h3>
          <p className={body}>Each path is checked in the order traffic meets it. Every answer names the resource and links the AWS documentation for that hop.</p>
        </div>
        <HopChain on={seen} />
      </article>
      <article className={cell}>
        <div className="grid gap-3">
          <span className={label}>02 · honest</span>
          <h3 className={title}>Unknown when it cannot know</h3>
          <p className={body}>Values set only at apply time give unknown with the reason, never a guess.</p>
        </div>
        <UnknownLine />
      </article>
      <article id="outage" className={`${cell} scroll-mt-24`}>
        <div className="grid gap-3">
          <span className={label}>03 · new in v0.1</span>
          <h3 className={title}>Outage risk, not only exposure</h3>
          <p className={body}>A group or route replaced by deleting it first leaves a gap on a path that stays open.</p>
        </div>
        <OutageTimeline on={seen} />
      </article>
      <article className={cell}>
        <div className="grid gap-3">
          <span className={label}>04 · private</span>
          <h3 className={title}>Nothing leaves your machine</h3>
          <p className={body}>No AWS account and no credentials. The viewer runs in your browser tab, behind a policy that blocks every data request it could make.</p>
        </div>
        <div className="grid gap-2">
          <span className="font-litt-mono text-2xl text-litt-fg sm:text-3xl">
            connect-src &apos;none&apos;
            <span aria-hidden="true" className="ml-1 inline-block h-[0.9em] w-[0.5em] translate-y-[0.1em] bg-litt-fg/50 motion-safe:animate-[soft-caret_1.4s_ease-in-out_infinite]" />
          </span>
          <span className="text-litt-small text-litt-fg-subtle">in the viewer's Content Security Policy</span>
        </div>
      </article>
    </div>
  );
}

const LOGOS: { name: string; src: string; wordmark?: boolean }[] = [
  { name: "Terraform", src: terraform },
  // The AWS logo is its own wordmark ("aws" over the smile), so it shows without a label.
  { name: "AWS", src: aws, wordmark: true },
  { name: "GitHub Actions", src: actions },
  { name: "Node.js", src: nodejs },
];

/** Logos drawn in the ink color through a CSS mask, so they follow the theme. */
function Logos() {
  return (
    <ul className="grid grid-cols-2 gap-px bg-litt-line sm:grid-cols-4" aria-label="Works with Terraform, AWS, GitHub Actions, and Node.js">
      {LOGOS.map((l) => (
        <li key={l.name} className="flex h-24 items-center justify-center gap-3 bg-litt-canvas">
          <span aria-hidden="true" className={`bg-litt-fg-subtle ${l.wordmark ? "h-7 w-12" : "h-6 w-8"}`} style={{ mask: `url("${l.src}") center / contain no-repeat`, WebkitMask: `url("${l.src}") center / contain no-repeat` }} />
          <span className={l.wordmark ? "sr-only" : "text-litt-small text-litt-fg-subtle"}>{l.name}</span>
        </li>
      ))}
    </ul>
  );
}

const COVERAGE: { group: string; items: string[] }[] = [
  { group: "Endpoints", items: ["aws_instance", "aws_db_instance", "aws_lb"] },
  { group: "Routing", items: ["aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table", "aws_route", "aws_main_route_table_association", "aws_default_route_table"] },
  { group: "Filters", items: ["aws_security_group", "aws_security_group_rule", "aws_vpc_security_group_ingress_rule", "aws_default_security_group", "aws_network_acl", "aws_network_acl_rule", "aws_default_network_acl"] },
  { group: "Addresses and listeners", items: ["aws_eip", "aws_eip_association", "aws_lb_listener", "aws_db_subnet_group"] },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Does vpcdiff need AWS credentials or an AWS account?", a: "No. It reads the JSON that terraform show produces. Terraform needs credentials to make the plan; vpcdiff does not." },
  { q: "Does my plan leave my machine?", a: "No. The CLI and the GitHub Action run where you run them. The viewer analyzes the file in your browser tab, and its Content Security Policy blocks every data request. The Action writes a comment to your own pull request only when you turn that on." },
  { q: "What does unknown mean?", a: "The engine could not decide that hop: a value Terraform learns only at apply time, a resource it does not model yet, or a load balancer whose subnets give different answers. The reason is always shown. Unknown is a result, never a guess." },
  { q: "How is this different from Checkov, tfsec, or Trivy?", a: "Those tools judge each rule on its own. vpcdiff follows the whole path: an open security group behind a network ACL that denies the port is not an exposure, and a narrow rule can still open a path when a route changes." },
  { q: "How is it different from AWS Reachability Analyzer?", a: "Reachability Analyzer checks a live account, one path at a time, after you deploy. vpcdiff works on the plan, before you apply, for every endpoint at once. Each test fixture includes the steps to check it against Reachability Analyzer; those paid checks have not been run yet." },
  { q: "Does it check traffic between my own services?", a: "Not yet. Today it checks paths from the internet to instances, databases, and load balancers. Paths inside the VPC are next on the roadmap." },
  { q: "Can it block a pull request?", a: "Yes. The GitHub Action fails the check when the plan adds a path from the internet (you choose the level with fail-on), writes the report to the job summary, and keeps one comment on the pull request up to date." },
  { q: "What does it cost?", a: "Nothing. vpcdiff is free and open source under the MIT license." },
];

const NAV_LINKS: [string, string][] = [
  ["How it works", "#how"],
  ["Coverage", "#coverage"],
  ["FAQ", "#faq"],
];

/**
 * A nav link whose underline sits 2px under the text (on the inner span, so padding
 * never moves it) and draws in from the left on hover, with a strong ease-out.
 */
function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} className="group inline-flex px-2 py-2 transition-colors duration-200 hover:text-litt-fg focus-visible:outline-2 focus-visible:outline-litt-focus">
      <span className="relative after:absolute after:inset-x-0 after:-bottom-[3px] after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)]:group-hover:after:origin-left [@media(hover:hover)]:group-hover:after:scale-x-100">
        {children}
      </span>
    </a>
  );
}

/** The nav sits between the rails like a section of its own, over a frosted canvas. */
function Nav() {
  return (
    <header className="intro-nav fixed inset-x-0 top-0 z-40 bg-litt-canvas/75 backdrop-blur-xl">
      <div className="intro-rail relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]">
        <nav aria-label="Main" className="grid h-16 grid-cols-[1fr_auto] items-center gap-4 px-4 md:grid-cols-[1fr_auto_1fr] md:px-6">
          <ul className="hidden items-center gap-1 text-litt-small text-litt-fg-subtle md:flex">
            {NAV_LINKS.map(([l, h]) => (
              <li key={h}>
                <NavLink href={h}>{l}</NavLink>
              </li>
            ))}
          </ul>
          <a href="./" aria-label="vpcdiff home" className="flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-litt-focus md:justify-self-center">
            <Wordmark size={18} />
          </a>
          <div className="flex items-center justify-end gap-1">
            <span className="hidden sm:inline">
              <ThemeCycle className="text-litt-fg-subtle hover:bg-litt-surface-2 hover:text-litt-fg" />
            </span>
            <span className="hidden sm:inline [&_a]:rounded-full">
              <GithubLink />
            </span>
            <span className="ml-2">
              <Cta href={APP} primary size="sm">
                Open the viewer
              </Cta>
            </span>
          </div>
        </nav>
      </div>
      <Divider />
    </header>
  );
}

function Hero() {
  return (
    <Rail reveal={false} label="vpcdiff" className="relative">
      <div className="intro-focus relative h-[300px] sm:h-[420px] lg:h-[460px]">
        <PathField />
        {/* Film grain on the animation only, after ui-layouts' Noise: a self-made 6-frame
            noise GIF from this origin at 3.5%, faded out radially so it melts into the
            page. Hidden under reduced motion (a GIF cannot pause). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.035] [mask-image:radial-gradient(ellipse_at_55%_45%,black_30%,transparent_75%)] motion-reduce:hidden" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}noise.gif)` }} />
      </div>
      <div className={`${PAD} relative isolate -mt-16 grid gap-8 pb-16 sm:-mt-20 lg:pb-20`}>
        {/* A feathered frost behind the headline and the buttons: where the animation runs
            under the text, it blurs and fades into the text area instead of meeting it at
            a hard edge. A wide ellipse covers both the left text and the right buttons. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-28 bottom-0 -z-10 bg-litt-canvas/55 backdrop-blur-[10px] [mask-image:radial-gradient(ellipse_75%_70%_at_45%_62%,black_40%,transparent_80%)] [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"
        />
        <h1 id="hero-title" className="font-display text-5xl leading-[1.02] font-normal tracking-[-0.045em] text-litt-fg sm:text-7xl">
          {/* Each line rises from behind its own mask on load (the intro). The text is
              opaque from the first paint, so it counts for Largest Contentful Paint. */}
          <span className="block overflow-hidden pb-[0.1em] -mb-[0.1em]">
            <span className="intro-up block leading-[inherit]" style={{ "--intro-d": "250ms" } as React.CSSProperties}>
              See what a Terraform plan
            </span>
          </span>
          <span className="block overflow-hidden pb-[0.1em] -mb-[0.1em]">
            <span className="intro-up block leading-[inherit] text-litt-fg-subtle" style={{ "--intro-d": "340ms" } as React.CSSProperties}>
              opens to the internet.
            </span>
          </span>
        </h1>
        <div className="intro-fade grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" style={{ "--intro-d": "450ms" } as React.CSSProperties}>
          <p className="max-w-[560px] text-lg leading-relaxed text-litt-fg-muted">vpcdiff reads your plan before you apply it and shows every path the internet gains or loses, with the security group, network ACL, and route that decides each hop.</p>
          <div className="grid justify-items-start gap-4 lg:justify-items-end">
            <div className="flex flex-wrap gap-3">
              <Cta href={APP} primary>
                Open the viewer
              </Cta>
              <Cta href={REPO} external>
                View on GitHub
              </Cta>
            </div>
            <p className="text-litt-small text-litt-fg-subtle">Free and open source. No AWS credentials.</p>
          </div>
        </div>
      </div>
    </Rail>
  );
}

export function Landing() {
  useEffect(() => startSmoothScroll(), []);
  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50">
        Skip to content
      </a>
      <Nav />
      <ScrollFrost until="#footer" />
      <main id="main" className="pt-16">
        <Hero />
        <Divider />
        <Rail label="Works with">
          <Logos />
        </Rail>
        <Divider />

        <Rail label="The check in a pull request" className={`${PAD} grid gap-14 py-24 md:py-28`}>
          <SectionHead eyebrow="In review" title="The check runs on the pull request." rest="Before anyone applies." bar>
            A rule widens in a pull request. vpcdiff finds the new path from the internet and shows the hop that changed.
          </SectionHead>
          <div className="border border-litt-line">
            <Plate inset="px-4 pt-4 sm:px-10 sm:pt-10 lg:px-14 lg:pt-14">
              <div role="img" aria-label="Product demo: a pull request widens a security group rule, and vpcdiff finds and explains the new path from the internet">
                <div aria-hidden="true">
                  <HeroDemo />
                </div>
              </div>
            </Plate>
          </div>
        </Rail>
        <Divider dots />

        <Rail label="Tagline">
          <Tagline />
        </Rail>
        <Divider dots />

        <Rail label="Why vpcdiff">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead eyebrow="Why vpcdiff" title="Review the effect of a change," rest="not just its lines." bar>
              A rule change is easy to read. What it opens is not: that depends on routes, network ACLs, public addresses, and every other group on the resource.
            </SectionHead>
          </div>
          <Features />
        </Rail>
        <Divider />

        <Rail id="how" label="How it works">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead
              eyebrow="How it works"
              title={
                <>
                  Three steps, in{" "}
                  <TextLoop interval={2.6} className="inline-flex" live="off">
                    {["pull requests", "your terminal", "the browser"].map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </TextLoop>
                </>
              }
            />
          </div>
          <StepTabs />
        </Rail>
        <Divider />

        <Rail id="cli" label="In the terminal">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead eyebrow="In the terminal" title="It asks for what it needs." rest="You answer, it explains." bar>
              The CLI finds your plan, reads it, and shows each new path in plain words. The same check runs in CI with plain text output.
            </SectionHead>
          </div>
          <CliSection />
        </Rail>
        <Divider />

        <Rail label="How it is checked">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead eyebrow="Engine" title="Pure and deterministic." rest="The same plan gives the same answer, byte for byte." bar>
              Every AWS networking rule in the code cites its documentation. When the engine cannot decide a hop, it says unknown and why.
            </SectionHead>
          </div>
          <HopStrip />
        </Rail>
        <Divider />

        <Rail id="coverage" label="Coverage">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead eyebrow="Coverage" title="What it understands today.">
              Anything else that can change a path is reported as unknown with the reason, so a gap never hides an open port.
            </SectionHead>
          </div>
          <div className="grid gap-px border-y border-litt-line bg-litt-line md:grid-cols-2">
            {COVERAGE.map((c) => (
              <div key={c.group} className="grid content-start gap-5 bg-litt-canvas px-6 py-10 md:px-16 md:py-12">
                <h3 className="font-display text-lg font-normal text-litt-fg">{c.group}</h3>
                <ul className="flex flex-wrap gap-2">
                  {c.items.map((i) => (
                    <li key={i}>
                      <Tag raised className="font-litt-mono">
                        {i}
                      </Tag>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className={`${PAD} py-6 text-litt-small text-litt-fg-subtle`}>Not yet: NAT gateways, VPC peering, Transit Gateway, VPC endpoints, IPv6, Aurora, and ECS services.</p>
        </Rail>
        <Divider />

        <Rail id="faq" label="Questions" className={`${PAD} grid items-start gap-12 py-24 md:py-28 lg:grid-cols-[1fr_1.4fr]`}>
          <SectionHead eyebrow="Questions" title="Before you try it." className="lg:sticky lg:top-24" />
          <Accordion type="single" collapsible headingLevel={3}>
            {FAQ.map((f, i) => (
              <AccordionItem key={f.q} value={`q${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>
                  <p className="pb-4 text-base text-litt-fg-muted">{f.a}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Rail>
        <Divider />

        <Rail label="Get started" className="relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,var(--litt-fg)_22%,transparent)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
          <div className={`${PAD} relative grid justify-items-center gap-8 py-28 text-center md:py-36`}>
            <Mark size={48} />
            <h2 className="max-w-[720px] font-display text-4xl leading-[1.06] font-normal tracking-[-0.035em] text-litt-fg sm:text-6xl sm:leading-[1.02]">
              Know what your next apply <span className="text-litt-fg-subtle">opens.</span>
            </h2>
            <p className="max-w-[520px] text-lg text-litt-fg-muted">Open a plan in the viewer, or add the check to your pull requests. Free, open source, and offline.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Cta href={APP} primary>
                Open the viewer
              </Cta>
              <Cta href={REPO} external>
                View on GitHub
              </Cta>
            </div>
          </div>
        </Rail>
        <Divider />
      </main>

      <Footer />
    </TooltipProvider>
  );
}
