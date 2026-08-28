export interface WithdrawalRequest {
  txId: string;
  userId: string;
  username: string | null;
  firstName: string | null;
  registeredAt: number;
  balanceGram: number;
  amount: number;
  fee: number;
  netAmount: number;
  walletAddress: string | null;
  requestedAt: number;
}

export interface AdminMetrics {
  totalBalances: number;
  withdrawn24h: number;
  withdrawn7d: number;
  pendingCount: number;
  pendingSum: number;
  userCount: number;
  emissionFactor: number;
}

export interface AdminUserRow {
  userId: string;
  telegramId: number | null;
  username: string | null;
  firstName: string | null;
  registeredAt: number;
  balanceGram: number;
  isAdmin: boolean;
  isBanned: boolean;
  referralL1: number;
}

export interface AdminUserDetail {
  profile: {
    id: string;
    telegram_id: number | null;
    username: string | null;
    first_name: string | null;
    is_admin: boolean;
    is_banned: boolean;
    wallet_address: string | null;
    referral_code: string | null;
    created_at: string;
  } | null;
  balance: { available_gram: number; pending_gram: number; locked_gram: number } | null;
  referrals: Array<{
    tier: number;
    earned: number;
    unclaimed: number;
    referee: string | null;
    joined: string;
  }>;
  transactions: Array<{
    type: string;
    amount: number;
    fee: number;
    status: string;
    ts: string;
  }>;
}

export const EMISSION_FACTORS = [1.0, 0.8, 0.6, 0.5] as const;
