export type MemeType = 'capybara' | 'pepe' | 'doge' | 'gigachad';

/** Five card grades, one per gacha slot. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type TierId = 1 | 2 | 3 | 4 | 5 | 6;
export type CardSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Wearable that buffs a whole tier (only "hat" for now). */
export interface Equipment {
  id: string;
  name: string;
  slot: 'hat';
  /** Tier-wide income boost, percent (+10 … +30). */
  bonusPct: number;
  imageUrl?: string;
}

/** An owned hat sitting in the player's inventory. */
export interface HatItem {
  id: string;
  name: string;
  bonusPct: number;
  rarity: Rarity;
  /** Emoji placeholder until sticker art lands. */
  emoji: string;
  /** id of the tier this hat is equipped into (`tier-<n>`), or null if benched. */
  equippedTierId: string | null;
}

export interface MemeCharacter {
  id: string;
  name: string;
  memeType: MemeType;
  rarity: Rarity;
  level: number;
  /** GRAM / day at level 1 (the card's base — merge formula uses this). */
  baseIncome: number;
  /** GRAM / day right now (level applied). */
  currentIncome: number;
  /** PvP power, grows with level / merges. */
  power: number;
  imageUrl: string;
  /** Which gacha tier / card this instance came from. */
  tier: TierId;
  cardSlot: CardSlot;
}

/** One of the six purchasable gacha tiers on the farm. */
export interface TierRow {
  tier: TierId;
  /** Roll price, GRAM. */
  costGram: number;
  hat: Equipment | null;
  /** Distinct card slots (1..5) the player has rolled at least once. */
  discovered: CardSlot[];
  /** Every character instance rolled from this tier (all live on the farm). */
  characters: MemeCharacter[];
}

export interface FarmState {
  totalIncomePerDay: number;
  /** epoch ms of the last successful claim. */
  lastClaimAt: number;
  /** epoch ms when the 8h claim window closes. */
  nextClaimAt: number;
  /** GRAM accrued and waiting to be claimed. */
  claimableGram: number;
}
