import { StaggerButton } from "@/components/sora-ui/buttons/stagger-button";

/**
 * Landing page call to action: Sora UI's stagger button at medium size. Its background
 * scales on hover and press; the label stays still (the per-character roll is turned off).
 */
export function Cta({ href, children, primary = false, external = false, size = "md", pill = false }: { href: string; children: string; primary?: boolean; external?: boolean; size?: "sm" | "md"; pill?: boolean }) {
  return (
    <StaggerButton
      href={href}
      size={size}
      variant={primary ? "default" : "secondary"}
      stagger="text"
      bgClassName={pill ? "rounded-full" : "rounded-[10px]"}
      charClassName="transition-none [text-shadow:none] group-hover:translate-y-0"
      className={`${pill ? "rounded-full" : "rounded-[10px]"} font-litt-title`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </StaggerButton>
  );
}
