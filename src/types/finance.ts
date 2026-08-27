export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'FARM_CLAIM'
  | 'STUDY_FEE'
  | 'MERGE_FEE'
  | 'SLOT_UNLOCK'
  | 'TIER_ROLL'
  | 'REFERRAL_REWARD'
  | 'STREAK_REWARD'
  | 'QUEST_REWARD';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** GRAM, always positive — direction comes from `type`. */
  amount: number;
  status: TransactionStatus;
  /** epoch ms */
  timestamp: number;
  /** on-chain hash once settled, null while PENDING. */
  txHash: string | null;
  /** platform fee, GRAM (withdrawals). */
  fee?: number;
  /** amount the recipient actually gets after `fee` (withdrawals). */
  netAmount?: number;
  /** counterparty wallet address (deposits / withdrawals). */
  address?: string | null;
}

/** Types that add TON to the balance (shown with a "+" and lime color). */
export const CREDIT_TYPES: ReadonlySet<TransactionType> = new Set([
  'DEPOSIT',
  'FARM_CLAIM',
  'REFERRAL_REWARD',
  'STREAK_REWARD',
  'QUEST_REWARD',
]);
