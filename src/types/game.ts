export type MemeType = 'capybara' | 'pepe' | 'doge' | 'gigachad';

/** Five card grades, one per gacha slot. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type TierId = 1 | 2 | 3 | 4 | 5 | 6;
export type CardSlot = 1 | 2 | 3 | 4 | 5;

export interface MemeCharacter {
  id: string;
  name: string;
  memeType: MemeType;
  rarity: Rarity;
  /** Merge level — raised only by Merge. Drives income AND part of power. */
  level: number;
  /** Study points — raised only by Study. Drives PvP power only, never income. */
  studyLevel: number;
  /** GRAM / day at level 1 (the card's base — merge formula uses this). */
  baseIncome: number;
  /** GRAM / day right now (merge level applied). */
  currentIncome: number;
  /** PvP power at merge level 1 / study 0 — base for the power formula. */
  basePower: number;
  /** PvP power right now — base * (merge-level + study-level contributions). */
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
  /** Distinct card slots (1..10) the player has rolled at least once. */
  discovered: CardSlot[];
  /** Every character instance rolled from this tier (all live on the farm). */
  characters: MemeCharacter[];
}

export type MergeStatus = 'FAIL' | 'SUCCESS' | 'CRIT';

/** Outcome of a Risk/Reward merge attempt — drives the MergeModal result screen. */
export interface MergeOutcome {
  status: MergeStatus;
  /** Levels gained: 0 on FAIL, 1 on SUCCESS, 2..4 on CRIT. */
  delta: number;
  roll: number; // 1..100
  fromLevel: number;
  newLevel: number;
  name: string;
  memeType: MemeType;
  rarity: Rarity;
  tier: TierId;
  fee: number;
  incomeBefore: number;
  incomeAfter: number;
  powerBefore: number;
  powerAfter: number;
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
