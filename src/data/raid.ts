import type { MemeType } from '../types/game';

/** A leaderboard row — populated from `pvp_leaderboard()` (real players only). */
export interface LeaderRow {
  name: string;
  memeType: MemeType;
  rating: number;
  /** Total farm power (⚡). */
  power: number;
  /** All-time leaderboard XP (⭐). */
  xp: number;
}
