/** The pMCPg mark (docs/assets/logo.svg), drawn with the theme's brand colour. */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true">
      <g fill="none" className="stroke-brand" strokeWidth={9} strokeLinecap="round">
        <path d="M6,56 C24,56 30,80 50,80" />
        <path d="M6,104 C24,104 30,80 50,80" />
        <path d="M110,80 C130,80 136,40 154,40" />
        <path d="M110,80 C130,80 136,80 154,80" />
        <path d="M110,80 C130,80 136,120 154,120" />
      </g>
      <rect x="40" y="40" width="80" height="80" rx="20" className="fill-brand" />
      <path d="M68,78 v-9 a12,12 0 0 1 24,0 v9" fill="none" stroke="#fff" strokeWidth={6} />
      <rect x="62" y="77" width="36" height="26" rx="5" fill="#fff" />
    </svg>
  );
}
