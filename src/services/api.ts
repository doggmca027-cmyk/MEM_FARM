import { supabase, SupabaseUnavailableError } from '../lib/supabase';
import type { CardSlot, FarmState, MemeCharacter, MemeType, Rarity, TierId, TierRow } from '../types/game';
import type { ReferralFriend, ReferralStats, ReferralTier } from '../types/referral';
import { TIER_COST, TIER_IDS } from '../data/tiers';
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
  walletAddress: string | null;
  referralCode: string | null;
}

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
  return {
    id: row.id,
    name: tpl?.name ?? 'Unknown',
    memeType: tpl?.meme_type ?? 'capybara',
    rarity: tpl?.rarity ?? 'common',
    level: row.level,
    baseIncome: num(tpl?.base_income_day),
    currentIncome: num(row.current_income_day),
    power: row.current_power != null ? num(row.current_power) : num(tpl?.base_power),
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
    .select('id, telegram_id, username, first_name, wallet_address, referral_code')
    .eq('id', uid)
    .single();

  if (error) throw error;
  return {
    id: data.id,
    telegramId: data.telegram_id ?? null,
    username: data.username ?? null,
    firstName: data.first_name ?? null,
    walletAddress: data.wallet_address ?? null,
    referralCode: data.referral_code ?? null,
  };
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
        'id, template_id, level, current_income_day, current_power, is_equipped, character_templates(*)',
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
      hat: null, // hat inventory is client-side for now
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
