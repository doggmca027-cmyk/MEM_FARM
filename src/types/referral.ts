import type { MemeType } from './game';

export type ReferralTier = 1 | 2 | 3;

export interface ReferralStats {
  l1Count: number;
  l2Count: number;
  l3Count: number;
  l1Earned: number;
  l2Earned: number;
  l3Earned: number;
  /** GRAM accrued from referral commissions, not yet moved to the balance. */
  unclaimedGram: number;
}

export interface ReferralFriend {
  id: string;
  handle: string; // "@crypto_capy"
  memeType: MemeType;
  tier: ReferralTier;
  joinedAt: number; // epoch ms
  broughtGram: number;
}
