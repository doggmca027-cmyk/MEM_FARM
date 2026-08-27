interface IconProps {
  className?: string;
}

/** GRAM token — faceted neon crystal with a thick black outline. */
export function GramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M12 2 4 9l8 13 8-13-8-7Z"
        fill="#06B6D4"
        stroke="#000"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M4 9h16M12 2v20M8.5 9 12 22l3.5-13L12 2 8.5 9Z" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 7.5 9.5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Chunky coin / XP token. */
export function CoinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="#FACC15" stroke="#000" strokeWidth="2.4" />
      <circle cx="12" cy="12" r="4.6" fill="#FDE68A" stroke="#000" strokeWidth="1.8" />
      <path d="M9 6.5a7 7 0 0 0-2.5 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Energy bolt for hype / boost badges. */
export function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
        fill="#84CC16"
        stroke="#000"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
