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

/** 10 slots per tier — two cards per rarity grade. */
export const CARD_SLOTS: CardSlot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const SLOTS_PER_TIER = 10;

/** Per-slot rarity (pairs: 1-2 common, 3-4 uncommon, 5-6 rare, 7-8 epic, 9-10 legendary). */
export const SLOT_RARITY: Record<CardSlot, Rarity> = {
  1: 'common',
  2: 'common',
  3: 'uncommon',
  4: 'uncommon',
  5: 'rare',
  6: 'rare',
  7: 'epic',
  8: 'epic',
  9: 'legendary',
  10: 'legendary',
};

/**
 * Drop weights, percent (sum = 100). Each rarity's total is split evenly
 * between its two cards. The roll uses per-mille ranges (see `rollCardSlot`):
 *   1..300 s1 · 301..600 s2 · 601..725 s3 · 726..850 s4 · 851..895 s5
 *   896..940 s6 · 941..960 s7 · 961..980 s8 · 981..990 s9 · 991..1000 s10
 */
export const SLOT_WEIGHT: Record<CardSlot, number> = {
  1: 30,
  2: 30,
  3: 12.5,
  4: 12.5,
  5: 4.5,
  6: 4.5,
  7: 2,
  8: 2,
  9: 1,
  10: 1,
};

/** Tier 1 daily yield per card slot (by rarity); every higher tier doubles it. */
const T1_INCOME: Record<CardSlot, number> = {
  1: 0.025,
  2: 0.025,
  3: 0.035,
  4: 0.035,
  5: 0.05,
  6: 0.05,
  7: 0.075,
  8: 0.075,
  9: 0.12,
  10: 0.12,
};

type Names10 = [string, string, string, string, string, string, string, string, string, string];

const NAMES: Record<TierId, Names10> = {
  1: ['Capy-Baby', 'Capy-Tot', 'Doge-Noob', 'Doge-Pup', 'Pepe-Clown', 'Pepe-Jester', 'Chad-Ghost', 'Chad-Wisp', 'King-Boo', 'Court-Boo'],
  2: ['Capy-Punk', 'Capy-Rebel', 'Doge-Rider', 'Doge-Racer', 'Pepe-Wizard', 'Pepe-Mage', 'Chad-Knight', 'Chad-Squire', 'Queen-Boo', 'Duchess-Boo'],
  3: ['Capy-Ninja', 'Capy-Shinobi', 'Doge-Astro', 'Doge-Rover', 'Pepe-Samurai', 'Pepe-Ronin', 'Chad-Viking', 'Chad-Berserk', 'Lord-Boo', 'Baron-Boo'],
  4: ['Capy-Cyber', 'Capy-Mecha', 'Doge-Pilot', 'Doge-Ace', 'Pepe-Demon', 'Pepe-Imp', 'Chad-Titan', 'Chad-Golem', 'Emperor-Boo', 'Regent-Boo'],
  5: ['Capy-Cosmic', 'Capy-Nebula', 'Doge-Prime', 'Doge-Vector', 'Pepe-Oracle', 'Pepe-Seer', 'Chad-Colossus', 'Chad-Leviathan', 'Gigaboo', 'Ultraboo'],
  6: ['Capy-Genesis', 'Capy-Bang', 'Doge-Nova', 'Doge-Quasar', 'Pepe-Seraph', 'Pepe-Cherub', 'Chad-Warlord', 'Chad-Overlord', 'Omega-Boo', 'Alpha-Boo'],
};

const SLOT_MEME: Record<CardSlot, MemeType> = {
  1: 'capybara',
  2: 'capybara',
  3: 'doge',
  4: 'doge',
  5: 'pepe',
  6: 'pepe',
  7: 'gigachad',
  8: 'gigachad',
  9: 'gigachad',
  10: 'gigachad',
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

/** The 10-card pool for a tier, ordered by slot (common → legendary). */
export function tierPool(tier: TierId): GachaCard[] {
  const mult = 2 ** (tier - 1);
  return CARD_SLOTS.map((slot) => ({
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

/** Weighted 1..1000 roll → a card slot (see `SLOT_WEIGHT`). */
export function rollCardSlot(rng: () => number = Math.random): CardSlot {
  const n = Math.floor(rng() * 1000) + 1; // 1..1000
  if (n <= 300) return 1;
  if (n <= 600) return 2;
  if (n <= 725) return 3;
  if (n <= 850) return 4;
  if (n <= 895) return 5;
  if (n <= 940) return 6;
  if (n <= 960) return 7;
  if (n <= 980) return 8;
  if (n <= 990) return 9;
  return 10;
}

/** Roll a concrete card from a tier's pool. */
export function rollTierCard(tier: TierId, rng?: () => number): GachaCard {
  const slot = rollCardSlot(rng);
  return tierPool(tier)[slot - 1];
}
