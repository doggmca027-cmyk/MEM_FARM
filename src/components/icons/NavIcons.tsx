interface IconProps {
  className?: string;
}

const S = {
  stroke: '#000',
  strokeWidth: 2.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 📅 Quests / Streak — calendar with a check. */
export function QuestsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3.5" fill="#FACC15" {...S} />
      <path d="M3 9.5h18" {...S} />
      <path d="M8 3v4M16 3v4" {...S} />
      <path d="M8.5 15l2.4 2.4L15.5 12" {...S} />
    </svg>
  );
}

/** 🔑 Farm & Collection — key. */
export function FarmIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="#84CC16" {...S} />
      <circle cx="8.5" cy="8.5" r="1.7" fill="#120924" />
      <path d="M12.4 12.4 20 20M20 20l1-3M16.6 16.6 19 15" {...S} />
    </svg>
  );
}

/** ⚔️ Meme Raid — crossed swords. */
export function RaidIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M17.5 4H21v3.5l-8.5 8.5-3.5-3.5L17.5 4Z" fill="#EC4899" {...S} />
      <path d="M6.5 4H3v3.5L11.5 16l3.5-3.5L6.5 4Z" fill="#06B6D4" {...S} />
      <path d="M4 20l3.5-3.5M20 20l-3.5-3.5" {...S} />
    </svg>
  );
}

/** ✉️ Invite & Friends — envelope. */
export function InviteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="3.5" fill="#06B6D4" {...S} />
      <path d="M3.5 7.5 12 13l8.5-5.5" {...S} />
    </svg>
  );
}

/** ⭐ Ambassador — star badge. */
export function AmbassadorIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 20.2l1-5.8L3.5 9.2l5.9-.9L12 3Z"
        fill="#A855F7"
        {...S}
      />
    </svg>
  );
}

/** 🐷 Wallet & Withdraw — piggy bank. */
export function WalletIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M3.5 12.5c0-3.6 3.4-6.5 8-6.5 3.4 0 6.3 1.6 7.5 4h1a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 19 15c-.5 1.1-1.4 2-2.6 2.6V20h-3v-1.4c-.6.1-1.2.2-1.9.2s-1.3-.1-1.9-.2V20h-3v-2.5C4.5 16.2 3.5 14.5 3.5 12.5Z"
        fill="#FACC15"
        {...S}
      />
      <circle cx="9" cy="12" r="1.15" fill="#000" />
      <path d="M2.5 12h1.2M11 6c0-1.6 1-2.6 2.6-2.6" {...S} />
    </svg>
  );
}
