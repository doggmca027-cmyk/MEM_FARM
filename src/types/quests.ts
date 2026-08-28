import type { MemeType } from './game';

export type QuestId = 'farm_claim' | 'tier_roll' | 'raid_win' | 'study_upgrade';
export type RewardKind = 'xp' | 'gram' | 'tickets' | 'case' | 'buff';

export interface Reward {
  kind: RewardKind;
  amount: number;
}

export interface Quest {
  id: QuestId;
  label: string;
  goal: number;
  progress: number;
  claimed: boolean;
  reward: Reward;
}

export interface StreakDay {
  day: number; // 1..7
  rewards: Reward[];
  /** Day 7 — case + income buff. */
  isSuper?: boolean;
}

export interface RaidOpponent {
  id: string;
  name: string;
  memeType: MemeType;
  power: number;
}

export interface BattleResult {
  opponent: RaidOpponent;
  userPower: number;
  won: boolean;
  winChance: number;
  ratingDelta: number;
  newRating: number;
  rewards: Reward[];
}
