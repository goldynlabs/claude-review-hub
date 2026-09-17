// Same mark as web/public/logo-small.svg, inlined so it stays crisp at any size
// and needs no network request. The colours are the mark's own: it reads the
// same in both themes, so it deliberately does not follow the palette.
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Claude Review Hub"
    >
      <rect width="36" height="24" x="6" y="18" fill="#d77757" />
      <rect width="3" height="9" x="9" y="39" fill="#d77757" />
      <rect width="3" height="9" x="15" y="39" fill="#d77757" />
      <rect width="3" height="9" x="30" y="39" fill="#d77757" />
      <rect width="3" height="9" x="36" y="39" fill="#d77757" />
      <rect width="7.5" height="6" y="33" fill="#d77757" />
      <rect width="7.5" height="6" x="40.5" y="33" fill="#d77757" />
      <rect width="9" height="9" x="12" y="24" />
      <rect width="9" height="9" x="27" y="24" />
      <rect width="3" height="6" x="22.5" y="22.5" transform="rotate(90 24 25.5)" />
      <rect width="3" height="7" x="37" y="22" transform="rotate(90 38.5 25.5)" />
      <rect width="3" height="7" x="8" y="22" transform="rotate(90 9.5 25.5)" />
    </svg>
  );
}
