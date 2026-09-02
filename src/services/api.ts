import { supabase, SupabaseUnavailableError } from '../lib/supabase';
import type { CardSlot, FarmState, MemeCharacter, MemeType, Rarity, TierId, TierRow } from '../types/game';
import type { ReferralFriend, ReferralStats, ReferralTier } from '../types/referral';
import type {
  AdminMetrics,
  AdminUserDetail,
  AdminUserRow,
  WithdrawalRequest,
} from '../types/admin';
import type {
  AdminAmbassadorApplication,
  AdminAmbassadorPost,
  AmbassadorApplication,
  AmbassadorPost,
  AmbassadorStatRow,
  AmbStatus,
} from '../types/ambassador';
import { TIER_COST, TIER_IDS } from '../data/tiers';
import { readTelegramUser } from '../telegram/telegram';
import type { Transaction, TransactionStatus, TransactionType } from '../types/finance';

// --- helpers ---------------------------------------------------------------

/** PostgREST returns NUMERIC columns as strings to keep precision. */
function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

function client() {
  if (!supabase) throw new SupabaseUnavailableError();
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) {
    throw new SupabaseUnavailableError('No authenticated Supabase session');
  }
  return data.user.id;
}

// --- shapes returned to the store ----------------------------------------

export interface ProfileData {
  id: string;
  telegramId: number | null;
  username: string | null;
  firstName: string | null;
  /** Telegram avatar URL (from initDataUnsafe.user.photo_url), or null. */
  photoUrl: string | null;
  walletAddress: string | null;
  referralCode: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  notifPrefs: NotifPrefs;
}

export interface NotifPrefs {
  farm_ready: boolean;
  pvp_attack: boolean;
  referral_income: boolean;
  /** UI language, mirrored here so the push dispatcher can localise messages. */
  lang?: string;
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  farm_ready: true,
  pvp_attack: true,
  referral_income: true,
};

export interface FarmData {
  balanceGram: number;
  pendingGram: number;
  lockedGram: number;
  incomePerDay: number;
  farm: FarmState;
  tiers: TierRow[];
}

export interface ClaimResult {
  earnedGram: number;
  newAvailableGram: number;
  nextClaimAt: number;
}

export interface RollResult {
  templateId: string;
  name: string;
  rarity: Rarity;
  cardSlot: CardSlot;
  incomeDay: number;
  newBalanceGram: number;
}

export interface WithdrawalResult {
  txId: string;
  fee: number;
  netAmount: number;
  newAvailableGram: number;
}

export interface ReferralClaimResult {
  txId: string;
  claimedGram: number;
  newAvailableGram: number;
}

export interface ReferralData {
  code: string | null;
  stats: ReferralStats;
  friends: ReferralFriend[];
}

// --- row types (partial) -------------------------------------------------

interface TemplateRow {
  id: string;
  name: string;
  meme_type: MemeType;
  rarity: Rarity;
  base_income_day: string;
  base_power: number | null;
  image_url: string | null;
  tier: number | null;
  card_slot: number | null;
}

interface UserCharacterRow {
  id: string;
  template_id: string;
  level: number;
  study_level: number | null;
  current_income_day: string;
  current_power: number | null;
  is_equipped: boolean;
  character_templates: TemplateRow | null;
}

interface TierStateRow {
  tier: number;
  cost_gram: string;
  discovered: number[] | null;
}

interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: string;
  fee: string | null;
  net_amount: string | null;
  wallet_address: string | null;
  status: TransactionStatus;
  tx_hash: string | null;
  created_at: string;
}

// --- mappers -----------------------------------------------------------------

function toCharacter(row: UserCharacterRow): MemeCharacter {
  const tpl = row.character_templates;
  const tier = (tpl?.tier ?? 1) as TierId;
  const cardSlot = (tpl?.card_slot ?? 1) as CardSlot;
  const basePower = num(tpl?.base_power);
  return {
    id: row.id,
    name: tpl?.name ?? 'Unknown',
    memeType: tpl?.meme_type ?? 'capybara',
    rarity: tpl?.rarity ?? 'common',
    level: row.level,
    studyLevel: row.study_level ?? 0,
    baseIncome: num(tpl?.base_income_day),
    currentIncome: num(row.current_income_day),
    basePower,
    power: row.current_power != null ? num(row.current_power) : basePower,
    imageUrl: tpl?.image_url ?? '',
    tier,
    cardSlot,
  };
}

// --- API -------------------------------------------------------------------

export async function fetchUserProfile(): Promise<ProfileData> {
  const uid = await requireUserId();
  const { data, error } = await client()
    .from('profiles')
    .select(
      'id, telegram_id, username, first_name, wallet_address, referral_code, is_admin, is_banned, notif_prefs',
    )
    .eq('id', uid)
    .single();

  if (error) throw error;
  const tg = readTelegramUser();
  return {
    id: data.id,
    telegramId: data.telegram_id ?? null,
    username: data.username ?? tg.username,
    firstName: data.first_name ?? tg.firstName,
    photoUrl: tg.photoUrl,
    walletAddress: data.wallet_address ?? null,
    referralCode: data.referral_code ?? null,
    isAdmin: Boolean(data.is_admin),
    isBanned: Boolean(data.is_banned),
    notifPrefs: { ...DEFAULT_NOTIF_PREFS, ...((data.notif_prefs as Partial<NotifPrefs>) ?? {}) },
  };
}

/** Persist notification toggles (RLS: profiles update-own + column grant). */
export async function updateNotifPrefs(prefs: NotifPrefs): Promise<void> {
  const uid = await requireUserId();
  const { error } = await client().from('profiles').update({ notif_prefs: prefs }).eq('id', uid);
  if (error) throw error;
}

// --- admin ---------------------------------------------------------------

export async function adminListWithdrawals(): Promise<WithdrawalRequest[]> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_list_withdrawals', { p_admin_id: uid });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    txId: String(r.tx_id),
    userId: String(r.user_id),
    username: (r.username as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    registeredAt: ms(r.registered_at as string),
    balanceGram: num(r.balance_gram),
    amount: num(r.amount),
    fee: num(r.fee),
    netAmount: num(r.net_amount),
    walletAddress: (r.wallet_address as string) ?? null,
    requestedAt: ms(r.requested_at as string),
    status: (r.status as string) ?? 'PENDING',
  }));
}

// --- withdraw automation / hot wallet -------------------------------------

export interface WithdrawConfig {
  autoWithdraw: boolean;
  maxInstantLimit: number;
}

export async function adminGetSettings(): Promise<WithdrawConfig> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_get_settings', { p_admin_id: uid });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    autoWithdraw: Boolean(row?.auto_withdraw),
    maxInstantLimit: num(row?.max_instant_limit),
  };
}

export async function adminToggleAutoWithdraw(
  enabled: boolean,
  limit: number,
): Promise<WithdrawConfig> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_toggle_auto_withdraw', {
    p_admin_id: uid,
    p_enabled: enabled,
    p_limit: limit,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    autoWithdraw: Boolean(row?.auto_withdraw),
    maxInstantLimit: num(row?.max_instant_limit),
  };
}

/** Best-effort kick of the payout worker (drains APPROVED / AUTO_PENDING). */
export async function adminTriggerPayout(): Promise<void> {
  try {
    await client().functions.invoke('ton-payout-worker', { body: {} });
  } catch {
    /* worker also runs on cron — non-fatal */
  }
}

export async function adminProcessWithdrawal(
  txId: string,
  action: 'APPROVE' | 'REJECT',
  txHash?: string,
): Promise<{ status: string; refunded: number; newBalanceGram: number }> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_process_withdrawal', {
    p_admin_id: uid,
    p_tx_id: txId,
    p_action: action,
    p_tx_hash: txHash ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: String(row?.status ?? ''),
    refunded: num(row?.refunded),
    newBalanceGram: num(row?.new_balance_gram),
  };
}

export async function adminFetchMetrics(): Promise<AdminMetrics> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_metrics', { p_admin_id: uid });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    totalBalances: num(r.total_balances),
    withdrawn24h: num(r.withdrawn_24h),
    withdrawn7d: num(r.withdrawn_7d),
    pendingCount: Number(r.pending_count) || 0,
    pendingSum: num(r.pending_sum),
    userCount: Number(r.user_count) || 0,
    emissionFactor: num(r.emission_factor) || 1,
  };
}

export async function adminUpdateEmissionFactor(
  factor: number,
): Promise<{ updatedRows: number; emissionFactor: number }> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_update_emission_factor', {
    p_admin_id: uid,
    p_factor: factor,
  });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return { updatedRows: Number(r.updated_rows) || 0, emissionFactor: num(r.emission_factor) || factor };
}

export async function adminFindUser(query: string): Promise<AdminUserRow[]> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_find_user', { p_admin_id: uid, p_query: query });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    telegramId: r.telegram_id != null ? Number(r.telegram_id) : null,
    username: (r.username as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    registeredAt: ms(r.registered_at as string),
    balanceGram: num(r.balance_gram),
    isAdmin: Boolean(r.is_admin),
    isBanned: Boolean(r.is_banned),
    referralL1: Number(r.referral_l1) || 0,
  }));
}

export async function adminUserDetail(userId: string): Promise<AdminUserDetail> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_user_detail', {
    p_admin_id: uid,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as AdminUserDetail;
}

export async function adminBanUser(userId: string, banned: boolean): Promise<boolean> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('admin_ban_user', {
    p_admin_id: uid,
    p_user_id: userId,
    p_banned: banned,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Boolean(row?.is_banned);
}

const REFERRAL_RATE: Record<ReferralTier, number> = { 1: 5, 2: 2, 3: 1 };

interface ReferralRow {
  referee_id: string;
  tier: number;
  total_earned_gram: string | null;
  unclaimed_gram: string | null;
  created_at: string;
  referee: { username: string | null; first_name: string | null } | null;
}

export async function fetchReferralData(): Promise<ReferralData> {
  const uid = await requireUserId();
  const db = client();

  const [profileRes, rowsRes] = await Promise.all([
    db.from('profiles').select('referral_code').eq('id', uid).single(),
    db
      .from('referrals')
      .select(
        'referee_id, tier, total_earned_gram, unclaimed_gram, created_at, referee:profiles!referrals_referee_id_fkey(username, first_name)',
      )
      .eq('referrer_id', uid)
      .order('created_at', { ascending: false }),
  ]);

  if (rowsRes.error) throw rowsRes.error;
  const rows = (rowsRes.data ?? []) as unknown as ReferralRow[];

  const stats: ReferralStats = {
    l1Count: 0, l2Count: 0, l3Count: 0,
    l1Earned: 0, l2Earned: 0, l3Earned: 0,
    unclaimedGram: 0,
  };
  for (const r of rows) {
    const earned = num(r.total_earned_gram);
    stats.unclaimedGram += num(r.unclaimed_gram);
    if (r.tier === 1) { stats.l1Count++; stats.l1Earned += earned; }
    else if (r.tier === 2) { stats.l2Count++; stats.l2Earned += earned; }
    else if (r.tier === 3) { stats.l3Count++; stats.l3Earned += earned; }
  }
  stats.unclaimedGram = num(stats.unclaimedGram);

  const memes: MemeType[] = ['capybara', 'pepe', 'doge', 'gigachad'];
  const friends: ReferralFriend[] = rows.slice(0, 20).map((r) => {
    const hash = [...r.referee_id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const tier = (r.tier >= 1 && r.tier <= 3 ? r.tier : 1) as ReferralTier;
    return {
      id: r.referee_id,
      handle: r.referee?.username ? `@${r.referee.username}` : r.referee?.first_name ?? 'anon',
      memeType: memes[hash % memes.length],
      tier,
      joinedAt: ms(r.created_at),
      broughtGram: Math.round((num(r.total_earned_gram) / (REFERRAL_RATE[tier] / 100)) * 100) / 100,
    };
  });

  return {
    code: (profileRes.data?.referral_code as string | null) ?? null,
    stats,
    friends,
  };
}

export async function claimReferralRewardsRPC(): Promise<ReferralClaimResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('claim_referral_rewards', { p_user_id: uid });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    txId: String(row?.tx_id ?? ''),
    claimedGram: num(row?.claimed_gram),
    newAvailableGram: num(row?.new_available_gram),
  };
}

export async function fetchFarmData(): Promise<FarmData> {
  const uid = await requireUserId();
  const db = client();

  const [balanceRes, stateRes, tiersRes, charsRes] = await Promise.all([
    db.from('balances').select('available_gram, pending_gram, locked_gram').eq('user_id', uid).single(),
    db.from('farm_states').select('last_accrual_at, next_claim_at, emission_factor').eq('user_id', uid).single(),
    db.from('tier_states').select('tier, cost_gram, discovered').eq('user_id', uid),
    db
      .from('user_characters')
      .select(
        'id, template_id, level, study_level, current_income_day, current_power, is_equipped, character_templates(*)',
      )
      .eq('user_id', uid),
  ]);

  if (balanceRes.error) throw balanceRes.error;
  if (stateRes.error) throw stateRes.error;
  if (tiersRes.error) throw tiersRes.error;
  if (charsRes.error) throw charsRes.error;

  const charRows = (charsRes.data ?? []) as unknown as UserCharacterRow[];
  const tierRows = (tiersRes.data ?? []) as unknown as TierStateRow[];
  const characters = charRows.map(toCharacter);

  const incomePerDay = charRows
    .filter((r) => r.is_equipped)
    .reduce((sum, r) => sum + num(r.current_income_day), 0);

  const tiers: TierRow[] = TIER_IDS.map((tier) => {
    const row = tierRows.find((t) => t.tier === tier);
    const own = characters.filter((c) => c.tier === tier);
    return {
      tier,
      costGram: row ? num(row.cost_gram) : TIER_COST[tier],
      discovered: (row?.discovered ?? []).filter((n): n is CardSlot => n >= 1 && n <= 5),
      characters: own,
    };
  });

  const farm: FarmState = {
    totalIncomePerDay: incomePerDay,
    lastClaimAt: ms(stateRes.data.last_accrual_at),
    nextClaimAt: ms(stateRes.data.next_claim_at),
    claimableGram: 0,
  };

  return {
    balanceGram: num(balanceRes.data.available_gram),
    pendingGram: num(balanceRes.data.pending_gram),
    lockedGram: num(balanceRes.data.locked_gram),
    incomePerDay,
    farm,
    tiers,
  };
}

export async function claimIncomeRPC(): Promise<ClaimResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('claim_farm_income', { p_user_id: uid });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    earnedGram: num(row?.earned_gram),
    newAvailableGram: num(row?.new_available_gram),
    nextClaimAt: ms(row?.next_claim_at),
  };
}

export async function rollTierRPC(tier: TierId): Promise<RollResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('roll_tier_character', { p_user_id: uid, p_tier: tier });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    templateId: String(row?.template_id ?? ''),
    name: String(row?.name ?? ''),
    rarity: (row?.rarity ?? 'common') as Rarity,
    cardSlot: (Number(row?.card_slot) || 1) as CardSlot,
    incomeDay: num(row?.income_day),
    newBalanceGram: num(row?.new_balance_gram),
  };
}

export async function requestWithdrawalRPC(
  amount: number,
  address: string,
): Promise<WithdrawalResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('request_withdrawal', {
    p_user_id: uid,
    p_amount: amount,
    p_address: address,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    txId: String(row?.tx_id ?? ''),
    fee: num(row?.fee),
    netAmount: num(row?.net_amount),
    newAvailableGram: num(row?.new_available_gram),
  };
}

export async function studyUpgradeRPC(characterId: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await client().rpc('study_upgrade_character', {
    p_user_id: uid,
    p_user_character_id: characterId,
  });
  if (error) throw error;
}

export interface MergeRpcResult {
  status: 'FAIL' | 'SUCCESS' | 'CRIT';
  delta: number;
  roll: number;
  newLevel: number;
  fee: number;
  newIncomeDay: number;
  newPower: number;
}

export async function mergeCharactersRPC(
  templateId: string,
  level: number,
): Promise<MergeRpcResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('merge_user_characters', {
    p_user_id: uid,
    p_template_id: templateId,
    p_level: level,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? 'FAIL') as MergeRpcResult['status'],
    delta: Number(row?.delta) || 0,
    roll: Number(row?.roll) || 0,
    newLevel: Number(row?.new_level) || level,
    fee: num(row?.fee),
    newIncomeDay: num(row?.new_income_day),
    newPower: num(row?.new_power),
  };
}

// --- PvP wager arena ---------------------------------------------------------

export interface LobbyRow {
  id: string;
  stake: number;
  createdAt: string;
}

export interface JoinLobbyResult {
  won: boolean;
  stake: number;
  pot: number;
  feeAmount: number;
  winnerPayout: number;
  youPower: number;
  opponentPower: number;
  winChance: number;
  ratingDelta: number;
  newRating: number;
  xpTotal: number;
  newAvailableGram: number;
}

/** Open lobbies from other players you can join. */
export interface LeaderRowRpc {
  name: string;
  memeType: string;
  rating: number;
  power: number;
  xp: number;
}

/** Real-players-only PvP leaderboard (top by XP, then rating). */
export async function fetchPvpLeaderboard(limit = 20): Promise<LeaderRowRpc[]> {
  const { data, error } = await client().rpc('pvp_leaderboard', { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    name: String(r.handle ?? 'Player'),
    memeType: String(r.meme_type ?? 'gigachad'),
    rating: Number(r.rating) || 0,
    power: Number(r.power) || 0,
    xp: Number(r.xp) || 0,
  }));
}

export interface PvpProfileData {
  rating: number;
  xp: number;
  streakDay: number;
  /** epoch ms of last check-in day (UTC midnight), or null. */
  lastCheckInAt: number | null;
}

/** The caller's own pvp_profiles row (rating / xp / streak). */
export async function fetchPvpProfile(): Promise<PvpProfileData> {
  const uid = await requireUserId();
  const { data, error } = await client()
    .from('pvp_profiles')
    .select('rating, xp, streak_day, last_check_in')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;
  const lci = data?.last_check_in as string | null | undefined;
  return {
    rating: Number(data?.rating) || 0,
    xp: Number(data?.xp) || 0,
    streakDay: Number(data?.streak_day) || 0,
    lastCheckInAt: lci ? Date.parse(`${lci}T00:00:00Z`) : null,
  };
}

/** Claim today's daily-streak reward (server-guarded once per UTC day). */
export async function claimDailyStreakRPC(): Promise<{
  streakDay: number;
  rewardKind: string;
  rewardAmount: number;
  newAvailableGram: number;
}> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('claim_daily_streak', { p_user_id: uid });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    streakDay: Number(row?.streak_day) || 0,
    rewardKind: String(row?.reward_kind ?? ''),
    rewardAmount: num(row?.reward_amount),
    newAvailableGram: num(row?.new_available_gram),
  };
}

export async function fetchOpenLobbies(): Promise<LobbyRow[]> {
  const uid = await requireUserId();
  const { data, error } = await client()
    .from('pvp_lobbies')
    .select('id, stake, created_at')
    .eq('status', 'OPEN')
    .neq('creator_id', uid)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    stake: num(r.stake),
    createdAt: r.created_at as string,
  }));
}

export async function createPvpLobbyRPC(stake: number): Promise<{ id: string; stake: number }> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('create_pvp_lobby', {
    p_user_id: uid,
    p_stake: stake,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { id: String(row?.lobby_id ?? row?.id), stake: num(row?.stake) || stake };
}

export async function cancelPvpLobbyRPC(lobbyId: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await client().rpc('cancel_pvp_lobby', {
    p_user_id: uid,
    p_lobby_id: lobbyId,
  });
  if (error) throw error;
}

export async function joinPvpLobbyRPC(lobbyId: string): Promise<JoinLobbyResult> {
  const uid = await requireUserId();
  const { data, error } = await client().rpc('join_pvp_lobby', {
    p_user_id: uid,
    p_lobby_id: lobbyId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    won: Boolean(row?.you_won),
    stake: num(row?.stake),
    pot: num(row?.pot),
    feeAmount: num(row?.fee_amount),
    winnerPayout: num(row?.winner_payout),
    youPower: Number(row?.joiner_power) || 0,
    opponentPower: Number(row?.creator_power) || 0,
    winChance: num(row?.win_chance),
    ratingDelta: Number(row?.rating_delta) || 0,
    newRating: Number(row?.new_rating) || 0,
    xpTotal: Number(row?.xp_total) || 0,
    newAvailableGram: num(row?.new_available_gram),
  };
}

// --- ambassador (user) -------------------------------------------------------

export interface MyAmbassadorData {
  application: AmbassadorApplication | null;
  posts: AmbassadorPost[];
}

export async function fetchMyAmbassador(): Promise<MyAmbassadorData> {
  const uid = await requireUserId();
  const db = client();
  const [appRes, postRes] = await Promise.all([
    db
      .from('ambassador_applications')
      .select('id, channel_link, contact_username, status, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('ambassador_posts')
      .select('id, post_link, status, admin_comment, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false }),
  ]);
  if (appRes.error) throw appRes.error;
  if (postRes.error) throw postRes.error;

  const a = (appRes.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    application: a
      ? {
          id: String(a.id),
          channelLink: String(a.channel_link),
          contactUsername: String(a.contact_username),
          status: a.status as AmbStatus,
          createdAt: ms(a.created_at as string),
        }
      : null,
    posts: ((postRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id),
      postLink: String(p.post_link),
      status: p.status as AmbStatus,
      adminComment: (p.admin_comment as string) ?? null,
      createdAt: ms(p.created_at as string),
    })),
  };
}

export async function submitAmbassadorApplication(
  channelLink: string,
  contactUsername: string,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await client()
    .from('ambassador_applications')
    .insert({ user_id: uid, channel_link: channelLink.trim(), contact_username: contactUsername.trim() });
  if (error) throw error;
}

export async function submitAmbassadorPost(postLink: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await client()
    .from('ambassador_posts')
    .insert({ user_id: uid, post_link: postLink.trim() });
  if (error) throw error;
}

// --- ambassador (admin) -----------------------------------------------------

export async function adminListAmbassadorApplications(): Promise<AdminAmbassadorApplication[]> {
  const { data, error } = await client().rpc('admin_list_ambassador_applications');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    username: (r.username as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    telegramId: r.telegram_id != null ? Number(r.telegram_id) : null,
    balanceGram: num(r.balance_gram),
    channelLink: String(r.channel_link),
    contactUsername: String(r.contact_username),
    status: r.status as AmbStatus,
    createdAt: ms(r.created_at as string),
  }));
}

export async function adminSetAmbassadorApplicationStatus(
  id: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<void> {
  const { error } = await client().rpc('admin_set_ambassador_application_status', {
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminListAmbassadorPosts(): Promise<AdminAmbassadorPost[]> {
  const { data, error } = await client().rpc('admin_list_ambassador_posts');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    username: (r.username as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    postLink: String(r.post_link),
    status: r.status as AmbStatus,
    adminComment: (r.admin_comment as string) ?? null,
    createdAt: ms(r.created_at as string),
  }));
}

export async function adminSetAmbassadorPostStatus(
  id: string,
  status: 'APPROVED' | 'REJECTED',
  comment?: string,
): Promise<void> {
  const { error } = await client().rpc('admin_set_ambassador_post_status', {
    p_id: id,
    p_status: status,
    p_comment: comment ?? null,
  });
  if (error) throw error;
}

export async function adminGrantAmbassadorDeposit(
  userId: string,
  amount: number,
): Promise<number> {
  const { data, error } = await client().rpc('admin_grant_ambassador_deposit', {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return num(r.new_available_gram);
}

export async function adminGetAmbassadorStats(): Promise<AmbassadorStatRow[]> {
  const { data, error } = await client().rpc('admin_get_ambassador_stats');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    username: (r.username as string) ?? null,
    channelLink: String(r.channel_link),
    l1Count: Number(r.l1_count) || 0,
    l2Count: Number(r.l2_count) || 0,
    l3Count: Number(r.l3_count) || 0,
    l1DepositTotal: num(r.l1_deposit_total),
    l2DepositTotal: num(r.l2_deposit_total),
    l3DepositTotal: num(r.l3_deposit_total),
  }));
}

export async function fetchTransactions(limit = 50): Promise<Transaction[]> {
  const uid = await requireUserId();
  const { data, error } = await client()
    .from('transactions')
    .select('id, type, amount, fee, net_amount, wallet_address, status, tx_hash, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as TransactionRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    amount: num(r.amount),
    fee: r.fee != null ? num(r.fee) : undefined,
    netAmount: r.net_amount != null ? num(r.net_amount) : undefined,
    address: r.wallet_address,
    status: r.status,
    timestamp: ms(r.created_at),
    txHash: r.tx_hash,
  }));
}
