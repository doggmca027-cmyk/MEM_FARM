export type AdNetworkId = 'adsgram' | 'monetag' | 'gigapub' | 'richads';

export interface AdNetwork {
  id: AdNetworkId;
  name: string;
  /** GRAM credited once the network's postback confirms a completed view. */
  reward: number;
}

/** No daily cap — a user may watch as many as each network has fill for. */
export const AD_NETWORKS: AdNetwork[] = [
  { id: 'adsgram', name: 'Adsgram', reward: 0.002 },
  { id: 'monetag', name: 'Monetag', reward: 0.002 },
  { id: 'gigapub', name: 'GigaPub', reward: 0.002 },
  { id: 'richads', name: 'RichAds', reward: 0.002 },
];

/** True once this network's publisher id is set (VITE_* env), i.e. wireable. */
export function isAdNetworkConfigured(id: AdNetworkId): boolean {
  switch (id) {
    case 'adsgram':
      return Boolean(import.meta.env.VITE_ADSGRAM_BLOCK_ID);
    case 'monetag':
      return Boolean(import.meta.env.VITE_MONETAG_ZONE_ID);
    case 'gigapub':
      return Boolean(import.meta.env.VITE_GIGAPUB_PROJECT_ID);
    case 'richads':
      return false; // no generic SDK — needs a personalized snippet, see adSdks.ts
  }
}
