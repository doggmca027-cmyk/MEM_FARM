import type { CardSlot, MemeType, Rarity, TierId } from '../types/game';
import { round4 } from '../lib/format';

/** Roll price per tier, GRAM. */
export const TIER_COST: Record<TierId, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 16,
  6: 32,
};

export const TIER_IDS: TierId[] = [1, 2, 3, 4, 5, 6];

/** Per-slot rarity, ordered 1..5. */
export const SLOT_RARITY: Record<CardSlot, Rarity> = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary',
};

/**
 * Fixed drop weights (percent, sum = 100).
 *   1..60 -> slot 1   61..85 -> slot 2   86..94 -> slot 3
 *   95..98 -> slot 4  99..100 -> slot 5
 */
export const SLOT_WEIGHT: Record<CardSlot, number> = {
  1: 60,
  2: 25,
  3: 9,
  4: 4,
  5: 2,
};

/** Tier 1 daily yield per card slot; every higher tier doubles it. */
const T1_INCOME: Record<CardSlot, number> = {
  1: 0.025,
  2: 0.035,
  3: 0.05,
  4: 0.075,
  5: 0.12,
};

const NAMES: Record<TierId, [string, string, string, string, string]> = {
  1: ['Capy-Baby', 'Doge-Noob', 'Pepe-Clown', 'Chad-Ghost', 'King-Boo'],
  2: ['Capy-Punk', 'Doge-Rider', 'Pepe-Wizard', 'Chad-Knight', 'Queen-Boo'],
  3: ['Capy-Ninja', 'Doge-Astro', 'Pepe-Samurai', 'Chad-Viking', 'Lord-Boo'],
  4: ['Capy-Cyber', 'Doge-Pilot', 'Pepe-Demon', 'Chad-Titan', 'Emperor-Boo'],
  5: ['Capy-Cosmic', 'Doge-Prime', 'Pepe-Oracle', 'Chad-Colossus', 'Gigaboo'],
  6: ['Capy-Genesis', 'Doge-Nova', 'Pepe-Seraph', 'Chad-Warlord', 'Omega-Boo'],
};

const SLOT_MEME: Record<CardSlot, MemeType> = {
  1: 'capybara',
  2: 'doge',
  3: 'pepe',
  4: 'gigachad',
  5: 'gigachad',
};

export interface GachaCard {
  tier: TierId;
  slot: CardSlot;
  /** Stable template id, matches the SQL seed. */
  templateId: string;
  name: string;
  memeType: MemeType;
  rarity: Rarity;
  /** Drop chance, percent. */
  weight: number;
  /** GRAM / day this card yields at level 1. */
  incomePerDay: number;
  /** PvP power at level 1 (matches the SQL seed: slot * 100 * tier). */
  power: number;
}

/** The 5-card pool for a tier, ordered by slot (common → legendary). */
export function tierPool(tier: TierId): GachaCard[] {
  const mult = 2 ** (tier - 1);
  return ([1, 2, 3, 4, 5] as CardSlot[]).map((slot) => ({
    tier,
    slot,
    templateId: `t${tier}_c${slot}`,
    name: NAMES[tier][slot - 1],
    memeType: SLOT_MEME[slot],
    rarity: SLOT_RARITY[slot],
    weight: SLOT_WEIGHT[slot],
    incomePerDay: round4(T1_INCOME[slot] * mult),
    power: slot * 100 * tier,
  }));
}

/** Weighted 1..100 roll → a card slot (see `SLOT_WEIGHT`). */
export function rollCardSlot(rng: () => number = Math.random): CardSlot {
  const n = Math.floor(rng() * 100) + 1; // 1..100
  if (n <= 60) return 1;
  if (n <= 85) return 2;
  if (n <= 94) return 3;
  if (n <= 98) return 4;
  return 5;
}

/** Roll a concrete card from a tier's pool. */
export function rollTierCard(tier: TierId, rng?: () => number): GachaCard {
  const slot = rollCardSlot(rng);
  return tierPool(tier)[slot - 1];
}
