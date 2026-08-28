/** Telegram bot username (no `@`) for referral deep links. */
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME?.trim() || 'MemeFarmBot';

/** Multi-tier referral commission rates, percent of a platform fee. */
export const REFERRAL_RATES = { l1: 5, l2: 2, l3: 1 } as const;

/**
 * `https://t.me/<bot>?startapp=ref_<code>` — opens the Mini App directly.
 * Returns `''` when there is no code yet (caller must handle the empty case).
 */
export function referralLink(code: string | null | undefined): string {
  if (!code) return '';
  return `https://t.me/${BOT_USERNAME || 'bot'}?startapp=ref_${code}`;
}
