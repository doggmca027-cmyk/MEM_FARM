export type AmbStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AmbassadorApplication {
  id: string;
  channelLink: string;
  contactUsername: string;
  status: AmbStatus;
  createdAt: number;
}

export interface AmbassadorPost {
  id: string;
  postLink: string;
  status: AmbStatus;
  adminComment: string | null;
  createdAt: number;
}

/** Application row as the admin panel sees it (joined with the applicant). */
export interface AdminAmbassadorApplication extends AmbassadorApplication {
  userId: string;
  username: string | null;
  firstName: string | null;
  telegramId: number | null;
  balanceGram: number;
}

/** Post report row as the admin panel sees it. */
export interface AdminAmbassadorPost extends AmbassadorPost {
  userId: string;
  username: string | null;
  firstName: string | null;
}

/** One approved ambassador's referral / deposit rollup. */
export interface AmbassadorStatRow {
  userId: string;
  username: string | null;
  channelLink: string;
  l1Count: number;
  l2Count: number;
  l3Count: number;
  l1DepositTotal: number;
  l2DepositTotal: number;
  l3DepositTotal: number;
}
