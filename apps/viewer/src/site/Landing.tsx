import { useEffect, useRef, useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { CodeBlock } from "@/components/litt/code-block";
import { Tabs, TabsList, TabsPanel, TabsPanels, TabsTrigger } from "@/components/litt/tabs";
import { Tag } from "@/components/litt/tag";
import { TooltipProvider } from "@/components/litt/tooltip";
import { SlidingChipButton } from "@/components/sora-ui/buttons/sliding-chip-button";
import { LogoCarouselSwapper } from "@/components/sora-ui/effects/logo-carousel-swapper";
import { TiltCard } from "@/components/sora-ui/effects/tilt-card";
import { NumberFlow } from "@/components/sora-ui/texts/number-flow";
import { TextEffect } from "@/components/sora-ui/texts/text-effect";
import { DrawUnderlineLink } from "@/components/sora-ui/texts/draw-underline-link";
import { FogTextReveal } from "@/components/sora-ui/texts/fog-text-reveal";
import { HoverLink } from "@/components/sora-ui/texts/hover-link";
import { TextCursorLoop } from "@/components/sora-ui/texts/text-cursor-loop";
import { TextLoop } from "@/components/sora-ui/texts/text-loop";
import { TextScramble } from "@/components/sora-ui/texts/text-scramble";
import { Typer } from "@/components/sora-ui/texts/typer";
import aws from "../logos/aws-icon-mono.svg?url";
import actions from "../logos/github-actions-icon-mono.svg?url";
import github from "../logos/github-icon-mono.svg?url";
import hashicorp from "../logos/hashicorp-icon-mono.svg?url";
import terraform from "../logos/terraform-icon-mono.svg?url";
import { Mark, REPO, Wordmark } from "../shared/brand.tsx";
import { GithubLink } from "../shared/github.tsx";
import { ThemeCycle } from "../shared/theme.tsx";
import { Cta } from "./Cta.tsx";
import { HeroDemo } from "./HeroDemo.tsx";
import { ScrollFrost } from "./ScrollFrost.tsx";

const APP = "./app/";
const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/** True once the element has entered the viewport (or at once under reduced motion). */
function useInViewOnce<T extends Element>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setSeen(true);
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

/** True when the media query matches; follows changes. */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Sections rise 32px and fade in once as they enter the viewport. */
function Reveal({ children, className = "", id, label }: { children: ReactNode; className?: string; id?: string; label?: string }) {
  const [ref, seen] = useInViewOnce<HTMLElement>();
  return (
    <section ref={ref} id={id} aria-label={label} className={`transition-[opacity,transform] duration-700 ${EASE} ${seen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"} ${className}`}>
      {children}
    </section>
  );
}

/** The tagline: each word moves from a muted tone to full ink as it crosses the trigger line. */
function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = lines.flatMap((line, li) => {
    const parts = line.split(" ");
    return parts.map((w, wi) => ({ w, key: `${li}-${wi}`, lineEnd: wi === parts.length - 1 && li < lines.length - 1 }));
  });
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setLit(words.length);
    let frame = 0;
    const update = () => {
      frame = 0;
      const trigger = window.innerHeight * 0.62;
      let n = 0;
      el.querySelectorAll<HTMLSpanElement>("[data-word]").forEach((s) => {
        if (s.getBoundingClientRect().top < trigger) n++;
      });
      setLit((prev) => Math.max(prev, n));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [words.length]);
  return (
    <p ref={ref} className="mx-auto max-w-[760px] text-center font-display text-4xl leading-tight font-medium tracking-[-0.03em] text-balance sm:text-6xl sm:leading-[1.05]" aria-label={lines.join(" ")}>
      {words.map((x, i) => (
        <span key={x.key} aria-hidden="true">
          <span data-word className={`transition-colors duration-500 ${EASE} ${i < lit ? (x.w.startsWith("open") ? "text-litt-accent-text" : "text-litt-fg") : "text-litt-fg/25"}`}>
            {x.w}
          </span>
          {x.lineEnd ? <br /> : " "}
        </span>
      ))}
    </p>
  );
}

const H2 = "font-display text-3xl leading-tight font-medium tracking-[-0.03em] text-litt-fg sm:text-5xl sm:leading-[1.05]";

/** A section heading: the title fogs in as it scrolls into view, or a custom title node (loops). */
function SectionHead({ eyebrow, title, titleNode, children, center = false }: { eyebrow: string; title: string; titleNode?: ReactNode; children?: ReactNode; center?: boolean }) {
  // Fog draws the title on a canvas on one line, so it is used only where one line fits.
  const wide = useMedia("(min-width: 640px)");
  return (
    <div className={`grid max-w-[680px] gap-4 ${center ? "mx-auto justify-items-center text-center" : ""}`}>
      <p className="font-litt-mono text-litt-caption tracking-[0.08em] text-litt-accent-text uppercase">{eyebrow}</p>
      {titleNode ? (
        <h2 className={H2}>{titleNode}</h2>
      ) : wide && title.length <= 28 ? (
        <FogTextReveal as="h2" text={title} startOnView className={H2} />
      ) : (
        <TextEffect as="h2" per="word" preset="fade-in-blur" scrollTrigger once className={`${H2} leading-[inherit]`}>
          {title}
        </TextEffect>
      )}
      {children && <p className="text-lg text-litt-fg-muted">{children}</p>}
    </div>
  );
}

/* ---- Bento visuals: each card shows its idea working, in the product's own words. ---- */

const HOP_NAMES = ["Public IP", "Gateway", "NACL in", "Groups", "NACL out", "Route"];

function HopChain({ on }: { on: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
      {HOP_NAMES.map((h, i) => (
        <span key={h} className="flex items-center gap-2">
          <span
            className={`rounded-litt-pill px-3 py-1 text-litt-small font-medium transition-[background-color,color,box-shadow] duration-300 ${EASE} ${
              on ? "bg-litt-data-teal-tint text-litt-data-teal-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--litt-data-teal)_30%,transparent)]" : "bg-litt-surface-2 text-litt-fg-subtle shadow-[inset_0_0_0_1px_var(--litt-line)]"
            }`}
            style={{ transitionDelay: on ? `${300 + i * 180}ms` : "0ms" }}
          >
            {h}
          </span>
          {i < HOP_NAMES.length - 1 && <span className="h-px w-3 bg-litt-line-strong" />}
        </span>
      ))}
    </div>
  );
}

function UnknownLine() {
  return (
    <div className="grid gap-3 rounded-litt-surface border border-litt-line bg-litt-surface-2 p-4 font-litt-mono text-litt-small" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-litt-fg">gateway_id</span>
        <span className="text-litt-fg-subtle">=</span>
        <span className="text-litt-fg-muted">(known after apply)</span>
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
    <div className="grid gap-2 font-litt-mono text-litt-caption" aria-hidden="true">
      <div className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2">
        <span className="rounded-litt-control bg-litt-surface-2 px-2 py-1.5 text-center text-litt-fg-muted shadow-[inset_0_0_0_1px_var(--litt-line)]">delete</span>
        <span className="relative h-8">
          <span className={`absolute inset-x-0 top-1/2 h-0 -translate-y-1/2 border-t-2 border-dashed border-litt-warning transition-[clip-path] duration-1000 ${EASE}`} style={{ clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }} />
        </span>
        <span className="rounded-litt-control bg-litt-surface-2 px-2 py-1.5 text-center text-litt-fg-muted shadow-[inset_0_0_0_1px_var(--litt-line)]">create</span>
      </div>
      <p className={`text-center font-litt-sans text-litt-small text-litt-warning transition-opacity duration-500 ${on ? "opacity-100 delay-700" : "opacity-0"}`}>traffic can drop here</p>
    </div>
  );
}

function Bento() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>("0px 0px -20% 0px");
  const base = "grid h-full content-between gap-10 rounded-[18px] border p-8";
  const title = "font-display text-2xl leading-tight font-medium tracking-[-0.02em] text-litt-fg";
  const body = "max-w-[48ch] text-base text-litt-fg-muted";
  return (
    <div ref={ref} className="grid gap-4 md:grid-cols-6">
      <div className="md:col-span-4 [&>div]:h-full">
        <TiltCard className="h-full [&>*]:h-full" rotationFactor={3} scaleOnHover={1.01}>
          <article className={`${base} border-[color-mix(in_oklab,var(--litt-accent)_22%,var(--litt-line))] bg-litt-accent-tint`}>
            <div className="grid gap-3">
              <span className="font-litt-mono text-litt-caption text-litt-accent-text">01 · hop by hop</span>
              <h3 className={title}>Every hop, with the rule that decided it</h3>
              <p className={body}>Each path is checked in the order traffic meets it. Every answer names the resource and links the AWS documentation for that hop.</p>
            </div>
            <HopChain on={seen} />
          </article>
        </TiltCard>
      </div>
      <div className="md:col-span-2 [&>div]:h-full">
        <TiltCard className="h-full [&>*]:h-full" rotationFactor={3} scaleOnHover={1.01}>
          <article className={`${base} border-litt-line bg-litt-surface-1`}>
            <div className="grid gap-3">
              <span className="font-litt-mono text-litt-caption text-litt-fg-subtle">02 · honest</span>
              <h3 className={title}>Unknown when it cannot know</h3>
              <p className={body}>Values set only at apply time give unknown with the reason, never a guess.</p>
            </div>
            <UnknownLine />
          </article>
        </TiltCard>
      </div>
      <div className="md:col-span-2 [&>div]:h-full">
        <TiltCard className="h-full [&>*]:h-full" rotationFactor={3} scaleOnHover={1.01}>
          <article id="outage" className={`${base} scroll-mt-28 border-[color-mix(in_oklab,var(--litt-warning)_24%,var(--litt-line))] bg-litt-data-amber-tint`}>
            <div className="grid gap-3">
              <span className="font-litt-mono text-litt-caption text-litt-warning">03 · new</span>
              <h3 className={title}>Outage risk, not only exposure</h3>
              <p className={body}>A group or route replaced by deleting it first leaves a gap on a path that stays open.</p>
            </div>
            <OutageTimeline on={seen} />
          </article>
        </TiltCard>
      </div>
      <div className="md:col-span-4 [&>div]:h-full">
        <TiltCard className="h-full [&>*]:h-full" rotationFactor={3} scaleOnHover={1.01}>
          <article style={ON_HARBOR} className={`${base} border-white/10 bg-(--vd-harbor) text-litt-fg`}>
            <div className="grid gap-3">
              <span className="font-litt-mono text-litt-caption text-litt-accent-text">04 · private</span>
              <h3 className={title}>Nothing leaves your machine</h3>
              <p className={body}>No AWS account and no credentials. The viewer runs in your browser tab, behind a policy that blocks every data request it could make.</p>
            </div>
            <div className="grid gap-2">
              <TextScramble as="span" trigger={seen} duration={1.4} className="font-litt-mono text-2xl text-litt-accent-text sm:text-3xl">
                connect-src &apos;none&apos;
              </TextScramble>
              <span className="text-litt-small text-litt-fg-subtle">in the viewer's Content Security Policy</span>
            </div>
          </article>
        </TiltCard>
      </div>
    </div>
  );
}

function Stats() {
  const [ref, seen] = useInViewOnce<HTMLDListElement>();
  const facts = [
    { value: 6, label: "hops checked for every path, before and after the plan" },
    { value: 5, label: "real Terraform plans in the test suite, each with a written proof" },
    { value: 101, label: "tests on every change, with byte for byte expected results" },
    { value: 0, label: "runtime dependencies in the engine: a terminal, CI, or a tab" },
  ];
  return (
    <dl ref={ref} className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="grid content-start gap-3 border-t border-litt-line pt-6">
          <dt className="sr-only">{f.label}</dt>
          <dd className="font-display text-6xl leading-none font-medium tracking-[-0.04em] text-litt-fg tabular-nums">
            <NumberFlow value={seen ? f.value : 0} />
          </dd>
          <dd className="text-litt-small text-litt-fg-muted">{f.label}</dd>
        </div>
      ))}
    </dl>
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

const ACTION_YAML = `- run: terraform show -json tfplan > plan.json
- uses: isthatpratik/vpcdiff@main
  with:
    plan: plan.json
    fail-on: added`;

const CLI_OUTPUT = `$ vpcdiff plan.json
vpcdiff: 1 added, 0 removed, 0 changed, 0 unknown

ADDED     internet -> aws_instance.db  tcp/5432
  before: blocked at security-group
  after:  allowed from internet`;

/** Inverted tokens for parts on Harbor ink: white text, bright cyan, dark text on the cyan button. */
const ON_HARBOR = {
  "--litt-fg": "#f4f7f8",
  "--litt-fg-muted": "color-mix(in oklab, #f4f7f8 72%, transparent)",
  "--litt-fg-subtle": "color-mix(in oklab, #f4f7f8 52%, transparent)",
  "--litt-line": "color-mix(in oklab, white 12%, transparent)",
  "--litt-accent": "#22d3ee",
  "--litt-accent-hover": "#67e8f9",
  "--litt-accent-fg": "#071419",
  "--litt-accent-text": "#22d3ee",
  "--litt-surface-1": "#12303a",
  "--litt-surface-2": "#173a45",
  "--litt-focus": "#22d3ee",
} as React.CSSProperties;

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-3">
      <nav
        aria-label="Main"
        style={ON_HARBOR}
        className={`pointer-events-auto flex w-full min-w-0 items-center justify-between gap-3 rounded-full border border-white/10 bg-[color-mix(in_oklab,var(--vd-harbor)_88%,transparent)] py-1.5 pr-1.5 pl-4 text-litt-fg backdrop-blur-xl transition-[max-width,box-shadow] duration-500 ${EASE} ${
          scrolled ? "max-w-[760px] shadow-[0_12px_32px_-12px_rgba(4,18,23,0.55)]" : "max-w-[960px] shadow-none"
        }`}
      >
        <a href="./" aria-label="vpcdiff home" className="flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-litt-focus">
          <Wordmark size={17} />
          <span className="hidden rounded-full border border-white/15 px-1.5 font-litt-mono text-[10px] leading-4 text-litt-fg-subtle sm:inline">v0.1</span>
        </a>
        <ul className="hidden items-center text-litt-small text-litt-fg-muted md:flex">
          {[
            ["How it works", "#how"],
            ["Coverage", "#coverage"],
            ["FAQ", "#faq"],
          ].map(([l, h]) => (
            <li key={h}>
              <HoverLink href={h} variant="underline-left" className="px-3 py-1.5 transition-colors duration-200 hover:text-litt-fg">
                {l}
              </HoverLink>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1">
          <ThemeCycle className="hidden text-litt-fg-muted hover:bg-white/10 hover:text-litt-fg sm:inline-flex" />
          <span className="hidden sm:inline [&_a]:rounded-full [&_a:hover]:bg-white/10">
            <GithubLink />
          </span>
          <Cta href={APP} primary size="sm" pill>
            Open the viewer
          </Cta>
        </div>
      </nav>
    </div>
  );
}

function Hero() {
  const [ready, setReady] = useState(false);
  const logos = [
    [
      { alt: "Terraform", src: terraform },
      { alt: "AWS", src: aws },
      { alt: "GitHub Actions", src: actions },
      { alt: "HashiCorp", src: hashicorp },
    ],
    [
      { alt: "GitHub", src: github },
      { alt: "Terraform", src: terraform },
      { alt: "AWS", src: aws },
      { alt: "GitHub Actions", src: actions },
    ],
  ];
  return (
    <section className="relative pt-28 sm:pt-36" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-[1088px] justify-items-center gap-8 px-6 text-center">
        <SlidingChipButton href="#outage" label="New: outage risk" size="sm" variant="ghost" labelClassName="normal-case font-litt-sans tracking-normal" />
        <h1 id="hero-title" className="max-w-[900px] font-display text-5xl leading-[1.02] font-medium tracking-[-0.045em] text-litt-fg sm:text-7xl">
          <TextEffect as="span" per="word" preset="fade-in-blur" speedReveal={1.1} className="block leading-[inherit]">
            See what a Terraform plan
          </TextEffect>
          <span className="relative isolate inline leading-[inherit] decoration-litt-accent decoration-[0.07em] underline-offset-[0.14em] max-sm:underline sm:inline-block">
            <TextEffect as="span" per="word" preset="fade-in-blur" delay={0.35} speedReveal={1.1} className="leading-[inherit]" onAnimationComplete={() => setReady(true)}>
              opens to the internet
            </TextEffect>
            <span
              aria-hidden="true"
              className={`absolute inset-x-[0.04em] bottom-[0.02em] -z-10 hidden h-[0.07em] sm:block origin-left rounded-full bg-litt-accent transition-transform duration-700 ${EASE} ${ready ? "scale-x-100" : "scale-x-0"}`}
            />
          </span>
        </h1>
        <TextEffect as="p" per="line" preset="fade-in-blur" delay={0.7} className="max-w-[620px] text-lg leading-[1.55] text-litt-fg-muted sm:text-xl">
          {"vpcdiff reads your plan before you apply it and shows every path the internet gains or loses, with the security group, network ACL, and route that decides each hop."}
        </TextEffect>
        <div className={`flex flex-wrap justify-center gap-3 transition-[opacity,transform] duration-700 ${EASE} ${ready ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
          <Cta href={APP} primary>
            Open the viewer
          </Cta>
          <Cta href={REPO} external>
            View on GitHub
          </Cta>
        </div>
        <p className={`text-litt-small text-litt-fg-subtle transition-opacity delay-200 duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>Free and open source. No AWS credentials. Your plan never leaves your machine.</p>
      </div>
      <div className="relative mx-auto mt-14 max-w-[1120px] px-4 sm:px-6" aria-label="Product demo: a pull request widens a security group rule, and vpcdiff finds and explains the new path from the internet">
        <div className="relative overflow-hidden rounded-[18px] border border-litt-line bg-litt-surface-2 p-2 sm:p-3">
          <div className="overflow-hidden rounded-[12px] bg-litt-canvas">
            <HeroDemo />
          </div>
        </div>
      </div>
      <div className="mx-auto mt-14 grid max-w-[1088px] justify-items-center px-6">
        <div className="grid w-full max-w-[720px] justify-items-center gap-4" aria-label="Works with Terraform, AWS, Amazon EC2, Amazon RDS, and GitHub Actions">
          <span className="font-litt-mono text-litt-caption tracking-[0.08em] text-litt-fg-subtle uppercase">Works with</span>
          <LogoCarouselSwapper rows={logos} columns={4} interval={3200} monochrome size="sm" className="w-full max-w-[560px] opacity-60 [&_img]:max-h-7" />
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50">
        Skip to content
      </a>
      <Nav />
      <ScrollFrost />
      <main id="main">
        <Hero />

        <section className="px-6 py-36 sm:py-48" aria-label="Tagline">
          <TaglineReveal lines={["A diff shows which rules changed.", "vpcdiff shows what they open."]} />
        </section>

        <Reveal className="mx-auto grid max-w-[1088px] gap-12 px-6 pb-24" label="Why vpcdiff">
          <SectionHead eyebrow="Why vpcdiff" title="Review the effect of a change, not just its lines">
            A rule change is easy to read. What it opens is not: that depends on routes, network ACLs, public addresses, and every other group on the resource.
          </SectionHead>
          <Bento />
        </Reveal>

        <Reveal id="how" className="mx-auto grid max-w-[1088px] scroll-mt-28 gap-14 px-6 py-24" label="How it works">
          <SectionHead
            eyebrow="How it works"
            title="Three steps, in pull requests, your terminal, or the browser"
            titleNode={
              <>
                Three steps, in{" "}
                <TextLoop interval={2.4} className="inline-flex text-litt-accent-text" live="off">
                  {["pull requests", "your terminal", "the browser"].map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </TextLoop>
              </>
            }
          />
          <ol className="relative grid gap-10 lg:grid-cols-3">
            <li className="grid content-start gap-5">
              <Step n={1} title="Make the plan">
                The same plan you would apply, written as JSON.
              </Step>
              <CodeBlock lang="shell" filename="Terminal" code={"terraform plan -out=tfplan\nterraform show -json tfplan > plan.json"} />
            </li>
            <li className="grid content-start gap-5">
              <Step n={2} title="Run vpcdiff">
                On every pull request, in a terminal, or in the browser.
              </Step>
              <Tabs defaultValue="action">
                <TabsList aria-label="Where to run vpcdiff">
                  <TabsTrigger value="action">GitHub Action</TabsTrigger>
                  <TabsTrigger value="cli">CLI</TabsTrigger>
                  <TabsTrigger value="viewer">Viewer</TabsTrigger>
                </TabsList>
                <TabsPanels>
                  <TabsPanel value="action">
                    <CodeBlock lang="text" filename=".github/workflows/plan.yml" code={ACTION_YAML} />
                  </TabsPanel>
                  <TabsPanel value="cli">
                    <CodeBlock lang="shell" filename="Terminal" code={"node packages/cli/dist/vpcdiff.mjs plan.json"} />
                  </TabsPanel>
                  <TabsPanel value="viewer">
                    <p className="rounded-litt-surface border border-litt-line bg-litt-surface-1 p-4 text-litt-small text-litt-fg-muted">
                      Drop plan.json on the{" "}
                      <DrawUnderlineLink href={APP} underlineColor="var(--litt-accent)" className="text-litt-accent-text">
                        viewer
                      </DrawUnderlineLink>
                      . It runs entirely in your tab.
                    </p>
                  </TabsPanel>
                </TabsPanels>
              </Tabs>
            </li>
            <li className="grid content-start gap-5">
              <Step n={3} title="Read the diff">
                New exposure fails the check. Every path shows its hops before and after.
              </Step>
              <CodeBlock lang="text" filename="Output" code={CLI_OUTPUT} />
            </li>
          </ol>
        </Reveal>

        <section style={ON_HARBOR} className="bg-(--vd-harbor) text-litt-fg" aria-label="How it is checked">
          <Reveal className="mx-auto grid max-w-[1088px] gap-14 px-6 py-28">
<SectionHead
              eyebrow="How it is checked"
              title="Every path checked at every hop"
              titleNode={
                <>
                  Every path checked at the
                  <br />
                  <TextCursorLoop words={["public IP", "internet gateway", "network ACL", "security groups", "return route"]} className="text-litt-accent-text" />
                </>
              }
            >
              The engine is pure and deterministic: the same plan gives the same result, byte for byte. Every AWS rule in the code cites its documentation.
            </SectionHead>
            <Stats />
          </Reveal>
        </section>

        <Reveal id="coverage" className="mx-auto grid max-w-[1088px] scroll-mt-28 gap-12 px-6 py-24" label="Coverage">
          <SectionHead eyebrow="Coverage" title="What it understands today">
            Anything else that can change a path is reported as unknown with the reason, so a gap never hides an open port.
          </SectionHead>
          <div className="grid gap-px overflow-hidden rounded-[14px] border border-litt-line bg-litt-line md:grid-cols-2">
            {COVERAGE.map((c) => (
              <div key={c.group} className="grid content-start gap-4 bg-litt-surface-1 p-7">
                <h3 className="font-display text-lg font-medium text-litt-fg">{c.group}</h3>
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
          <p className="text-litt-small text-litt-fg-subtle">Not yet: NAT gateways, VPC peering, Transit Gateway, VPC endpoints, IPv6, Aurora, and ECS services.</p>
        </Reveal>

        <Reveal id="faq" className="mx-auto grid max-w-[1088px] scroll-mt-28 gap-12 px-6 py-24 lg:grid-cols-[1fr_1.4fr]" label="Questions">
          <SectionHead eyebrow="Questions" title="Before you try it" />
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
        </Reveal>

        <Reveal className="mx-auto max-w-[1088px] px-6 pt-12 pb-28" label="Get started">
          <div className="relative grid justify-items-center gap-7 overflow-hidden rounded-[18px] border border-litt-line bg-litt-surface-1 px-6 py-20 text-center">
            <Mark size={56} />
            <FinalHeading />
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
        </Reveal>
      </main>

      <footer className="border-t border-litt-line">
        <div className="mx-auto grid max-w-[1088px] gap-8 px-6 py-12 text-litt-small text-litt-fg-subtle md:grid-cols-[1fr_auto]">
          <div className="grid gap-3">
            <Wordmark size={16} />
            <p className="max-w-[560px]">Privacy: no analytics and no cookies. Fonts load from Google Fonts; nothing about your plan is ever sent. Your theme choice stays in your browser.</p>
            <p className="max-w-[560px]">Terraform, AWS, Amazon EC2, Amazon RDS, HashiCorp, GitHub, and GitHub Actions are trademarks of their owners. vpcdiff is not affiliated with or endorsed by them.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-6 gap-y-2">
            <DrawUnderlineLink href={APP} underlineColor="var(--litt-accent)">Viewer</DrawUnderlineLink>
            <DrawUnderlineLink href={REPO} underlineColor="var(--litt-accent)">GitHub</DrawUnderlineLink>
            <DrawUnderlineLink href={`${REPO}/blob/main/LICENSE`} underlineColor="var(--litt-accent)">MIT license</DrawUnderlineLink>
            <DrawUnderlineLink href={`${REPO}/blob/main/DESIGN.md`} underlineColor="var(--litt-accent)">Design system</DrawUnderlineLink>
          </nav>
        </div>
      </footer>
    </TooltipProvider>
  );
}

/** The final call to action types itself in once it is on screen. */
function FinalHeading() {
  const [ref, seen] = useInViewOnce<HTMLHeadingElement>();
  return (
    <h2 ref={ref} className="max-w-[680px] font-display text-4xl leading-tight font-medium tracking-[-0.03em] text-litt-fg sm:text-5xl sm:leading-[1.05]" aria-label="Know what your next apply opens">
      {seen ? (
        <Typer as="span" fg="var(--litt-fg)" bg="var(--litt-surface-1)" accent="var(--litt-accent)" accentInk="var(--litt-accent-fg)" border="var(--litt-line-strong)">
          Know what your next apply opens
        </Typer>
      ) : (
        <span className="opacity-0">Know what your next apply opens</span>
      )}
    </h2>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="grid size-8 place-items-center rounded-full border border-litt-line font-litt-mono text-litt-caption text-litt-accent-text">{n}</span>
      <h3 className="font-display text-xl font-medium tracking-[-0.01em] text-litt-fg">{title}</h3>
      <p className="text-litt-small text-litt-fg-muted">{children}</p>
    </div>
  );
}
