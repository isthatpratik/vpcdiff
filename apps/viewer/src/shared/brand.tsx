// The vpcdiff mark: a boundary drawn as a delta (Δ, for diff) with a break in its left
// side, and the ink dot in the break: the place where traffic gets in.
// Geometry matches docs/brand/mark.svg. See DESIGN.md, section 2.

type MarkProps = { size?: number; small?: boolean; className?: string; title?: string };

export function Mark({ size = 24, small = size <= 20, className = "", title }: MarkProps) {
  const ink = "var(--litt-fg)";
  const accent = "var(--litt-accent-text)";
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {small ? (
        <>
          <path d="M8.34 18.33 L4.4 25.4 L27.6 25.4 L16 4.6 L12.75 10.42" stroke={ink} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10.55" cy="14.38" r="3.1" fill={accent} />
        </>
      ) : (
        <>
          <path d="M8.81 17.50 L4.4 25.4 L27.6 25.4 L16 4.6 L12.52 10.84" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10.66" cy="14.17" r="2.7" fill={accent} />
        </>
      )}
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-litt-fg" aria-label="vpcdiff">
      <Mark size={Math.round(size * 1.15)} />
      <span aria-hidden="true" className="font-display font-semibold tracking-[-0.02em]" style={{ fontSize: size, lineHeight: 1 }}>
        vpcdiff
      </span>
    </span>
  );
}

export const REPO = "https://github.com/isthatpratik/vpcdiff";
