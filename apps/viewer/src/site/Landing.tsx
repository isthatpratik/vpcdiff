import { useEffect, useRef, useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/litt/accordion";
import { CodeBlock } from "@/components/litt/code-block";
import { Tabs, TabsList, TabsPanel, TabsPanels, TabsTrigger } from "@/components/litt/tabs";
import { Tag } from "@/components/litt/tag";
import { TooltipProvider } from "@/components/litt/tooltip";
import { NumberFlow } from "@/components/sora-ui/texts/number-flow";
import { TextEffect } from "@/components/sora-ui/texts/text-effect";
import { DrawUnderlineLink } from "@/components/sora-ui/texts/draw-underline-link";
import { HoverLink } from "@/components/sora-ui/texts/hover-link";
import { TextLoop } from "@/components/sora-ui/texts/text-loop";
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
import { PathField } from "./PathField.tsx";
import { CrossCard, Divider, EASE, Eyebrow, PAD, Rail, SectionHead, useInViewOnce } from "./rails.tsx";
import { ScrollFrost } from "./ScrollFrost.tsx";
import { startSmoothScroll } from "./smooth.ts";

const APP = "./app/";

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
    <p ref={ref} className="mx-auto max-w-[820px] text-center font-display text-4xl leading-[1.1] font-normal tracking-[-0.035em] text-balance sm:text-6xl sm:leading-[1.04]" aria-label={lines.join(" ")}>
      {words.map((x, i) => (
        <span key={x.key} aria-hidden="true">
          <span data-word className={`transition-colors duration-500 ${EASE} ${i < lit ? "text-litt-fg" : "text-litt-fg/20"}`}>
            {x.w}
          </span>
          {x.lineEnd ? <br /> : " "}
        </span>
      ))}
    </p>
  );
}

/* ---- Feature visuals: each shows its idea working, in the product's own words. ---- */

const HOP_NAMES = ["Public IP", "Gateway", "NACL in", "Groups", "NACL out", "Route"];

/** The hops as a short path: squares on a line that fill in order. */
function HopChain({ on }: { on: boolean }) {
  return (
    <ol className="grid grid-cols-6" aria-label="The six hops, in the order traffic meets them">
      {HOP_NAMES.map((h, i) => (
        <li key={h} className="relative grid content-start justify-items-start gap-3">
          {i < HOP_NAMES.length - 1 && (
            <span aria-hidden="true" className={`absolute top-[5px] left-3 h-px w-[calc(100%-12px)] origin-left bg-litt-fg transition-transform duration-500 ${EASE} ${on ? "scale-x-100" : "scale-x-0"}`} style={{ transitionDelay: `${200 + i * 160}ms` }} />
          )}
          <span aria-hidden="true" className={`relative size-3 border border-litt-fg transition-colors duration-300 ${on ? "bg-litt-fg" : "bg-litt-canvas"}`} style={{ transitionDelay: `${120 + i * 160}ms` }} />
          <span className="pr-2 font-litt-mono text-litt-caption leading-tight text-litt-fg-muted">{h}</span>
        </li>
      ))}
    </ol>
  );
}

function UnknownLine() {
  return (
    <div className="grid gap-3 border border-litt-line bg-litt-surface-1 p-4 font-litt-mono text-litt-small" aria-hidden="true">
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
    <div className="grid gap-3 font-litt-mono text-litt-caption" aria-hidden="true">
      <div className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2">
        <span className="border border-litt-line-strong px-2 py-1.5 text-center text-litt-fg-muted">delete</span>
        <span className="relative h-8">
          <span className={`absolute inset-x-0 top-1/2 h-0 -translate-y-1/2 border-t border-dashed border-litt-fg transition-[clip-path] duration-1000 ${EASE}`} style={{ clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }} />
        </span>
        <span className="border border-litt-line-strong px-2 py-1.5 text-center text-litt-fg-muted">create</span>
      </div>
      <p className={`flex items-center justify-center gap-2 font-litt-sans text-litt-small text-litt-fg transition-opacity duration-500 ${on ? "opacity-100 delay-700" : "opacity-0"}`}>
        <span className="size-1.5 rounded-full bg-litt-warning" />
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
          <span className="font-litt-mono text-2xl text-litt-fg sm:text-3xl">connect-src &apos;none&apos;</span>
          <span className="text-litt-small text-litt-fg-subtle">in the viewer's Content Security Policy</span>
        </div>
      </article>
    </div>
  );
}

function Stats() {
  const [ref, seen] = useInViewOnce<HTMLDListElement>();
  const facts = [
    { value: 6, label: "hops checked for every path, before and after the plan" },
    { value: 5, label: "real Terraform plans in the test suite, each with a written proof" },
    { value: 102, label: "tests on every change, with byte for byte expected results" },
    { value: 0, label: "runtime dependencies in the engine: a terminal, CI, or a tab" },
  ];
  return (
    <dl ref={ref} className="grid gap-px border-t border-litt-line bg-litt-line sm:grid-cols-2 lg:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="grid content-start gap-4 bg-litt-canvas px-6 py-10 md:px-10 md:py-12 md:first:pl-16">
          <dt className="sr-only">{f.label}</dt>
          <dd className="font-display text-6xl leading-none font-normal tracking-[-0.04em] text-litt-fg tabular-nums">
            <NumberFlow value={seen ? f.value : 0} />
          </dd>
          <dd className="text-litt-small text-litt-fg-muted">{f.label}</dd>
        </div>
      ))}
    </dl>
  );
}

const LOGOS = [
  { name: "Terraform", src: terraform },
  { name: "AWS", src: aws },
  { name: "GitHub Actions", src: actions },
  { name: "GitHub", src: github },
  { name: "HashiCorp", src: hashicorp },
];

/** Logos drawn in the ink color through a CSS mask, so they follow the theme. */
function Logos() {
  return (
    <ul className="grid grid-cols-2 gap-px bg-litt-line sm:grid-cols-5" aria-label="Works with Terraform, AWS, GitHub Actions, GitHub, and HashiCorp tools">
      {LOGOS.map((l, i) => (
        <li key={l.name} className={`flex h-24 items-center justify-center gap-3 bg-litt-canvas ${i === LOGOS.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}>
          <span aria-hidden="true" className="h-6 w-8 bg-litt-fg-subtle" style={{ mask: `url("${l.src}") center / contain no-repeat`, WebkitMask: `url("${l.src}") center / contain no-repeat` }} />
          <span className="text-litt-small text-litt-fg-subtle">{l.name}</span>
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

const ACTION_YAML = `- run: |
    terraform show -json tfplan \\
      > plan.json
- uses: isthatpratik/vpcdiff@main
  with:
    plan: plan.json
    fail-on: added`;

const CLI_OUTPUT = `$ vpcdiff plan.json
vpcdiff: 1 added, 0 removed, 0 changed

ADDED  internet -> aws_instance.db
  tcp/5432
  before: blocked at security-group
  after:  allowed from internet`;

const NAV_LINKS: [string, string][] = [
  ["How it works", "#how"],
  ["Coverage", "#coverage"],
  ["FAQ", "#faq"],
];

/** The nav sits between the rails like a section of its own, over a frosted canvas. */
function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-litt-canvas/75 backdrop-blur-xl">
      <div className="relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]">
        <nav aria-label="Main" className="grid h-16 grid-cols-[1fr_auto] items-center gap-4 px-4 md:grid-cols-[1fr_auto_1fr] md:px-6">
          <ul className="hidden items-center gap-1 text-litt-small text-litt-fg-subtle md:flex">
            {NAV_LINKS.map(([l, h]) => (
              <li key={h}>
                <HoverLink href={h} variant="underline-left" className="px-2 py-1.5 transition-colors duration-200 hover:text-litt-fg">
                  {l}
                </HoverLink>
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
      <div className="relative h-[300px] sm:h-[420px] lg:h-[460px]">
        <PathField />
      </div>
      <div className={`${PAD} relative -mt-16 grid gap-8 pb-16 sm:-mt-20 lg:pb-20`}>
        <h1 id="hero-title" className="font-display text-5xl leading-[1.02] font-normal tracking-[-0.045em] text-litt-fg sm:text-7xl">
          <TextEffect as="span" per="word" preset="fade-in-blur" speedReveal={1.2} className="block leading-[inherit]">
            See what a Terraform plan
          </TextEffect>
          <TextEffect as="span" per="word" preset="fade-in-blur" delay={0.3} speedReveal={1.2} className="block leading-[inherit] text-litt-fg-subtle">
            opens to the internet.
          </TextEffect>
        </h1>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
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
          <CrossCard className="bg-litt-surface-1 p-2 sm:p-3">
            <div className="overflow-hidden bg-litt-canvas" aria-label="Product demo: a pull request widens a security group rule, and vpcdiff finds and explains the new path from the internet">
              <HeroDemo />
            </div>
          </CrossCard>
        </Rail>
        <Divider />

        <Rail label="Tagline" className="px-6 py-32 sm:py-44">
          <TaglineReveal lines={["A diff shows which rules changed.", "vpcdiff shows what they open."]} />
        </Rail>
        <Divider />

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
          <ol className="grid gap-px border-t border-litt-line bg-litt-line lg:grid-cols-3">
            <li className="grid min-w-0 content-start gap-6 bg-litt-canvas px-6 py-10 md:px-10 md:py-12 md:first:pl-16">
              <Step n={1} title="Make the plan">
                The same plan you would apply, written as JSON.
              </Step>
              <CodeBlock lang="shell" filename="Terminal" code={"terraform plan -out=tfplan\nterraform show -json tfplan \\\n  > plan.json"} />
            </li>
            <li className="grid min-w-0 content-start gap-6 bg-litt-canvas px-6 py-10 md:px-10 md:py-12 md:first:pl-16">
              <Step n={2} title="Run vpcdiff">
                On every pull request, in a terminal, or in the browser.
              </Step>
              <Tabs defaultValue="action">
                <TabsList aria-label="Where to run vpcdiff">
                  <TabsTrigger value="action">Action</TabsTrigger>
                  <TabsTrigger value="cli">CLI</TabsTrigger>
                  <TabsTrigger value="viewer">Viewer</TabsTrigger>
                </TabsList>
                <TabsPanels>
                  <TabsPanel value="action">
                    <CodeBlock lang="text" filename="plan.yml" code={ACTION_YAML} />
                  </TabsPanel>
                  <TabsPanel value="cli">
                    <CodeBlock lang="shell" filename="Terminal" code={"node packages/cli/dist/vpcdiff.mjs \\\n  plan.json"} />
                  </TabsPanel>
                  <TabsPanel value="viewer">
                    <p className="border border-litt-line bg-litt-surface-1 p-4 text-litt-small text-litt-fg-muted">
                      Drop plan.json on the{" "}
                      <DrawUnderlineLink href={APP} underlineColor="var(--litt-fg)" className="text-litt-fg">
                        viewer
                      </DrawUnderlineLink>
                      . It runs entirely in your tab.
                    </p>
                  </TabsPanel>
                </TabsPanels>
              </Tabs>
            </li>
            <li className="grid min-w-0 content-start gap-6 bg-litt-canvas px-6 py-10 md:px-10 md:py-12 md:first:pl-16">
              <Step n={3} title="Read the diff">
                New exposure fails the check. Every path shows its hops before and after.
              </Step>
              <CodeBlock lang="text" filename="Output" code={CLI_OUTPUT} />
            </li>
          </ol>
        </Rail>
        <Divider />

        <Rail label="How it is checked">
          <div className={`${PAD} pt-24 pb-16 md:pt-28 md:pb-20`}>
            <SectionHead eyebrow="Engine" title="Pure and deterministic." rest="The same plan gives the same answer, byte for byte." bar>
              Every AWS networking rule in the code cites its documentation. When the engine cannot decide a hop, it says unknown and why.
            </SectionHead>
          </div>
          <Stats />
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

        <Rail id="faq" label="Questions" className={`${PAD} grid gap-12 py-24 md:py-28 lg:grid-cols-[1fr_1.4fr]`}>
          <SectionHead eyebrow="Questions" title="Before you try it." />
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

      <footer id="footer" className="relative mx-3 border-x border-litt-line sm:mx-6 xl:mx-auto xl:max-w-[1200px]">
        <div className={`${PAD} grid gap-10 py-14 text-litt-small text-litt-fg-subtle md:grid-cols-[1fr_auto]`}>
          <div className="grid gap-4">
            <Wordmark size={16} />
            <p className="max-w-[560px]">Privacy: no analytics and no cookies. Fonts load from Google Fonts; nothing about your plan is ever sent. Your theme choice stays in your browser.</p>
            <p className="max-w-[560px]">Terraform, AWS, Amazon EC2, Amazon RDS, HashiCorp, GitHub, and GitHub Actions are trademarks of their owners. vpcdiff is not affiliated with or endorsed by them.</p>
          </div>
          <nav aria-label="Footer" className="grid content-start gap-3">
            <Eyebrow>Links</Eyebrow>
            <DrawUnderlineLink href={APP} underlineColor="var(--litt-fg)" variant="sm" className="justify-self-start text-litt-small text-litt-fg-muted hover:text-litt-fg">
              Viewer
            </DrawUnderlineLink>
            <DrawUnderlineLink href={REPO} underlineColor="var(--litt-fg)" variant="sm" className="justify-self-start text-litt-small text-litt-fg-muted hover:text-litt-fg">
              GitHub
            </DrawUnderlineLink>
            <DrawUnderlineLink href={`${REPO}/blob/main/LICENSE`} underlineColor="var(--litt-fg)" variant="sm" className="justify-self-start text-litt-small text-litt-fg-muted hover:text-litt-fg">
              MIT license
            </DrawUnderlineLink>
            <DrawUnderlineLink href={`${REPO}/blob/main/DESIGN.md`} underlineColor="var(--litt-fg)" variant="sm" className="justify-self-start text-litt-small text-litt-fg-muted hover:text-litt-fg">
              Design system
            </DrawUnderlineLink>
          </nav>
        </div>
      </footer>
      <Divider />
      <div className="h-6" />
    </TooltipProvider>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="font-litt-mono text-litt-caption text-litt-fg-subtle">0{n}</span>
      <h3 className="font-display text-xl font-normal tracking-[-0.01em] text-litt-fg">{title}</h3>
      <p className="text-litt-small text-litt-fg-muted">{children}</p>
    </div>
  );
}
