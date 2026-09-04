export type AdNetworkId = 'adsgram' | 'monetag' | 'gigapub' | 'richads';

export interface AdNetwork {
  id: AdNetworkId;
  name: string;
  /** GRAM credited once the network's postback confirms a completed view. */
  reward: number;
}

/** Up to 20 views/day per network (server-enforced in create_ad_view). */
export const AD_NETWORKS: AdNetwork[] = [
  { id: 'adsgram', name: 'Adsgram', reward: 0.002 },
  { id: 'monetag', name: 'Monetag', reward: 0.002 },
  { id: 'gigapub', name: 'GigaPub', reward: 0.002 },
  { id: 'richads', name: 'RichAds', reward: 0.002 },
];

function idList(envKey: string): string[] {
  return String((import.meta.env as Record<string, string | undefined>)[envKey] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Adsgram block ids, comma-separated in VITE_ADSGRAM_BLOCK_ID — tried in
 * order as a fallback chain so one sold-out block doesn't stop the show.
 * Every id must have the SAME Reward URL configured on Adsgram's side.
 */
export function adsgramBlockIds(): string[] {
  return idList('VITE_ADSGRAM_BLOCK_ID');
}

/**
 * Monetag zone ids, comma-separated in VITE_MONETAG_ZONE_ID — same fallback
 * idea as Adsgram. Every zone needs its own Postback URL configured (same
 * URL, repeated per zone) on Monetag's side.
 */
export function monetagZoneIds(): string[] {
  return idList('VITE_MONETAG_ZONE_ID');
}

/** True once this network's publisher id is set (VITE_* env), i.e. wireable. */
export function isAdNetworkConfigured(id: AdNetworkId): boolean {
  switch (id) {
    case 'adsgram':
      return adsgramBlockIds().length > 0;
    case 'monetag':
      return monetagZoneIds().length > 0;
    case 'gigapub':
      return Boolean(import.meta.env.VITE_GIGAPUB_PROJECT_ID);
    case 'richads':
      return false; // no generic SDK — needs a personalized snippet, see adSdks.ts
  }
}
