import { StaggerButton } from "@/components/sora-ui/buttons/stagger-button";

/**
 * Landing page call to action: Sora UI's stagger button at medium size. Its background
 * scales on hover and press; the label stays still (the per-character roll is turned off).
 * The primary button is solid ink; the other is an outline with a clear 1px edge.
 */
export function Cta({ href, children, primary = false, external = false, size = "md" }: { href: string; children: string; primary?: boolean; external?: boolean; size?: "sm" | "md" }) {
  return (
    <StaggerButton
      href={href}
      size={size}
      variant={primary ? "default" : "secondary"}
      stagger="text"
      bgClassName={`rounded-[6px] ${primary ? "" : "bg-transparent shadow-[inset_0_0_0_1px_var(--litt-line-strong)] group-hover:bg-litt-surface-2"}`}
      charClassName="transition-none [text-shadow:none] group-hover:translate-y-0"
      className={`rounded-[6px] font-litt-title ${primary ? "" : "bg-transparent text-litt-fg shadow-none hover:bg-transparent"}`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </StaggerButton>
  );
}
