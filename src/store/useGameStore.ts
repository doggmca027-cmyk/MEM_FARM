import { create } from 'zustand';
import type {
  CardSlot,
  FarmState,
  MemeCharacter,
  MergeOutcome,
  TierId,
  TierRow,
} from '../types/game';
import type { Transaction } from '../types/finance';
import type { BattleResult, Quest, QuestId, RaidOpponent, Reward } from '../types/quests';
import type { LeaderRow } from '../data/raid';
import type { ReferralFriend, ReferralStats } from '../types/referral';
import { round4 } from '../lib/format';
import { applyDir, isLang, loadLang, saveLang, type LangCode } from '../i18n';
import { isSameUtcDay, utcDaysBetween } from '../lib/time';
import { isSupabaseConfigured } from '../lib/supabase';
import { readTelegramUser } from '../telegram/telegram';
import { TIER_COST, TIER_IDS, farmEarnCap, tierPool, rollTierCard, type GachaCard } from '../data/tiers';
import { DEFAULT_QUESTS, STREAK_DAYS } from '../data/quests';
import {
  adminBanUser,
  adminGetSettings,
  adminProcessWithdrawal,
  adminToggleAutoWithdraw,
  adminTriggerPayout,
  adminUpdateEmissionFactor,
  cancelPvpLobbyRPC,
  claimIncomeRPC,
  claimReferralRewardsRPC,
  createPvpLobbyRPC,
  DEFAULT_NOTIF_PREFS,
  fetchFarmData,
  claimDailyStreakRPC,
  fetchOpenLobbies,
  fetchPvpLeaderboard,
  fetchPvpProfile,
  fetchReferralData,
  fetchTransactions,
  fetchUserProfile,
  joinPvpLobbyRPC,
  type WithdrawConfig,
  mergeCharactersRPC,
  requestWithdrawalRPC,
  rollTierRPC,
  studyUpgradeRPC,
  updateNotifPrefs,
  type LobbyRow,
  type NotifPrefs,
  type ProfileData,
} from '../services/api';

export type NavTab = 'quests' | 'farm' | 'raid' | 'invite' | 'wallet' | 'ambassador';
export type DataMode = 'mock' | 'live';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const COOLDOWN_MS = 8 * 60 * 60 * 1000;
/** Remaining on first load, near the top of the window: ~07:29:xx. */
const INITIAL_REMAINING_MS = (7 * 3600 + 29 * 60 + 12) * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const bootNow = Date.now();
const seedLastClaimAt = bootNow - (COOLDOWN_MS - INITIAL_REMAINING_MS);
const seedNextClaimAt = seedLastClaimAt + COOLDOWN_MS;

// --- mock daily-streak persistence -------------------------------------
// Mock state is in-memory and resets on every reload — persist just the
// streak gate so a reload can't re-claim the same day's reward.
const STREAK_KEY = 'memefarm:streak';
function loadStreak(): { day: number; at: number | null } {
  try {
    const v = JSON.parse(localStorage.getItem(STREAK_KEY) ?? 'null');
    if (v && typeof v.day === 'number') return { day: v.day, at: v.at ?? null };
  } catch {
    /* ignore */
  }
  return { day: 0, at: null };
}
function saveStreak(day: number, at: number): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ day, at }));
  } catch {
    /* ignore */
  }
}
const bootStreak = loadStreak();

function mockHash(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 12; i++) out += hex[Math.floor(Math.random() * 16)];
  return `EQ${out}…${out.slice(0, 4)}`;
}

function newInstanceId(): string {
  return `uc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// --- withdrawal rules --------------------------------------------------

export const WITHDRAW_MIN = 0.5; // GRAM
export const WITHDRAW_FEE_MIN = 0.01; // GRAM
export const WITHDRAW_FEE_PCT = 0.1; // 10%
export const WITHDRAW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Minimum deposit, GRAM (enforced in the UI). */
export const DEPOSIT_MIN = 1;

/** Platform fee for a withdrawal: max(0.01, amount * 10%). */
export function withdrawalFee(amount: number): number {
  return round4(Math.max(WITHDRAW_FEE_MIN, amount * WITHDRAW_FEE_PCT));
}

/**
 * Study fee, GRAM — scales with the study point being bought (0-indexed):
 * `0.05 * 1.5^studyLevel` (first upgrade, studyLevel 0, costs 0.05).
 */
export function studyFeeGram(studyLevel: number): number {
  return round4(0.05 * Math.pow(1.5, Math.max(0, studyLevel)));
}

/** Bonus leaderboard XP granted per action (never spent). */
export const XP_PER_ROLL = 10;
export const XP_MERGE_BASE = 30;
export const XP_MERGE_PER_LEVEL = 15;

const MERGE_GROWTH = 1.75;
export const MERGE_LEVEL_CAP = 10;

/** +35% of base power per merge level above 1. */
export const POWER_MERGE_STEP = 0.35;
/** +50% of base power per study point (Study is the dedicated power path). */
export const POWER_STUDY_STEP = 0.5;

/** Merge: income at a merge level = base * 1.75^(level-1). Study never touches this. */
export function mergedIncome(baseIncome: number, mergeLevel: number): number {
  return round4(baseIncome * Math.pow(MERGE_GROWTH, mergeLevel - 1));
}

/**
 * PvP power = base * (1 + 0.35*(mergeLevel-1) + 0.5*studyLevel).
 * Merge-level and study-level contributions are summed off the card's base.
 */
export function characterPower(
  basePower: number,
  mergeLevel: number,
  studyLevel: number,
): number {
  return Math.round(
    basePower *
      (1 + POWER_MERGE_STEP * (mergeLevel - 1) + POWER_STUDY_STEP * Math.max(0, studyLevel)),
  );
}

/** Merge sink fee, GRAM — scales with tier: 0.02 * 2^(tier-1). */
export function mergeFee(tier: TierId): number {
  return round4(0.02 * 2 ** (tier - 1));
}

/**
 * Hardcore merge roll — 15% success / 85% burn.
 *   roll 1..100 — 1..85  FAIL (material burns, survivor stays at level N)
 *              — 86..100 SUCCESS, then a sub-roll picks the level gain:
 *                  +1 (80%) · +2 (14%) · +3 (5%) · +4 (1%)
 */
export function rollMerge(rng: () => number = Math.random): {
  status: 'FAIL' | 'SUCCESS' | 'CRIT';
  delta: number;
  roll: number;
} {
  const n = Math.floor(rng() * 100) + 1;
  if (n <= 85) return { status: 'FAIL', delta: 0, roll: n };
  const s = Math.floor(rng() * 100) + 1;
  const delta = s <= 80 ? 1 : s <= 94 ? 2 : s <= 99 ? 3 : 4;
  return { status: delta === 1 ? 'SUCCESS' : 'CRIT', delta, roll: n };
}

// --- quests / streak -----------------------------------------------------

export const DAILY_BUFF_MS = 24 * 60 * 60 * 1000;
export const DAILY_BUFF_PCT = 10;

// --- pvp wager arena ---------------------------------------------------

/** GRAM stake tiers for a duel. */
export const STAKE_TIERS = [0.1, 0.25, 0.5, 1, 2, 5] as const;
export type StakeTier = (typeof STAKE_TIERS)[number];

/** Treasury rake on the whole pot. */
export const PVP_RAKE_PCT = 0.1;

/** Whole pot both players put up: `stake * 2`. */
export function pvpPot(stake: number): number {
  return round4(stake * 2);
}
/** 10% of the pot skimmed to the project treasury. */
export function pvpFee(stake: number): number {
  return round4(pvpPot(stake) * PVP_RAKE_PCT);
}
/** Net GRAM credited to the winner: `pot - fee`. */
export function pvpPayout(stake: number): number {
  return round4(pvpPot(stake) - pvpFee(stake));
}

/** Rating gained on a win / lost on a defeat, scaled by the odds you beat. */
export function pvpRatingDelta(won: boolean, winChance: number): number {
  if (won) return Math.max(8, Math.round(30 * (1 - winChance)) + 12);
  return -Math.max(6, Math.round(18 * winChance));
}

/** Immutably advance a daily-quest counter (clamped to its goal). */
function bumpQuests(quests: Quest[], id: QuestId, n = 1): Quest[] {
  return quests.map((q) =>
    q.id === id && !q.claimed ? { ...q, progress: Math.min(q.goal, q.progress + n) } : q,
  );
}

// --- income math --------------------------------------------------------

/** True once a card has hit its lifetime farming cap (yields 0 from then on). */
export function isFarmCapped(c: MemeCharacter): boolean {
  return c.lifetimeEarned >= c.earnCap;
}

/** Sum of daily income across all tiers — capped cards contribute nothing. */
function totalIncome(tiers: TierRow[]): number {
  return round4(
    tiers.reduce(
      (sum, r) =>
        sum + r.characters.reduce((s, c) => s + (isFarmCapped(c) ? 0 : c.currentIncome), 0),
      0,
    ),
  );
}

function characterFromCard(card: GachaCard): MemeCharacter {
  return {
    id: newInstanceId(),
    name: card.name,
    memeType: card.memeType,
    rarity: card.rarity,
    level: 1,
    studyLevel: 0,
    baseIncome: card.incomePerDay,
    currentIncome: card.incomePerDay,
    basePower: card.power,
    power: card.power,
    imageUrl: '',
    lifetimeEarned: 0,
    earnCap: farmEarnCap(card.tier),
    tier: card.tier,
    cardSlot: card.slot,
  };
}

// --- seed data ---------------------------------------------------------

// Zero onboarding: a fresh account starts empty — no GRAM, no cards. Live mode
// mirrors the DB (balances default 0, no user_characters); mock mode matches.
const SEED_TIERS: TierRow[] = TIER_IDS.map((tier) => ({
  tier,
  costGram: TIER_COST[tier],
  discovered: [],
  characters: [],
}));

const INCOME_PER_DAY = totalIncome(SEED_TIERS);

// --- store -----------------------------------------------------------------

export interface RevealPayload {
  tier: TierId;
  card: GachaCard;
  character: MemeCharacter;
  isNewDiscovery: boolean;
  jackpot: boolean;
}

interface GameStore {
  mode: DataMode;
  status: LoadStatus;
  profile: ProfileData | null;
  /** Telegram avatar URL, or null (falls back to an initial-letter chip). */
  photoUrl: string | null;
  /** Display name for the avatar fallback (Telegram first_name / @username). */
  displayName: string;
  activeTab: NavTab;

  balanceGram: number;
  pendingGram: number;
  lockedGram: number;
  incomePerDay: number;
  xp: number;

  farm: FarmState;
  tiers: TierRow[];
  transactions: Transaction[];

  /** Non-null while the GachaRevealModal is showing a fresh pull. */
  reveal: RevealPayload | null;
  /** Non-null while the BattleModal is showing a fresh raid result. */
  battle: BattleResult | null;
  /** Non-null while the MergeModal is showing a fresh merge outcome. */
  mergeResult: MergeOutcome | null;

  // quests / streak
  quests: Quest[];
  questsResetAt: number;
  streakDay: number; // consecutive days claimed, 0..7
  lastCheckInAt: number | null;
  dailyBuffUntil: number; // epoch ms, 0 = none
  dailyBuffPct: number;

  // pvp wager arena — no tickets / energy, play as often as your balance allows
  pvpRating: number;
  /** Selected GRAM stake for the next duel. */
  pvpStake: StakeTier;
  /** Your open lobby waiting for an opponent (live mode), else null. */
  pvpLobby: { id: string; stake: number } | null;
  /** Other players' open lobbies you can join (live mode). */
  openLobbies: LobbyRow[];
  /** Real-players PvP leaderboard (live only). */
  leaderboard: LeaderRow[];

  // referrals
  referralCode: string;
  referralStats: ReferralStats;
  referralsList: ReferralFriend[];

  invites: number;

  /** admin panel overlay (only reachable when `profile.isAdmin`). */
  adminOpen: boolean;
  settingsOpen: boolean;
  /** Transient error/info banner (RPC failures etc). Auto-cleared by <Toast/>. */
  toast: { msg: string; kind: 'error' | 'info' } | null;
  notifPrefs: NotifPrefs;

  /** UI language; persisted to localStorage. `ar`/`fa` also flip the document to RTL. */
  lang: LangCode;

  /** epoch ms of the last withdrawal request (24h cooldown), or null. */
  lastWithdrawAt: number | null;

  setActiveTab: (tab: NavTab) => void;
  hydrate: () => Promise<void>;
  accrue: () => void;
  /** Refill raid tickets over time + roll daily quests over to a new UTC day. */
  tickDaily: () => void;
  claim: () => void;
  /** Optimistic PENDING deposit — credited to the balance only on confirmation. */
  deposit: (amount: number, txHash?: string | null) => void;
  /** PENDING withdrawal: locks `amount` from the balance now, `fee` + `netAmount` recorded. */
  requestWithdrawal: (amount: number, address: string) => void;

  /** Buy + weighted-roll one card from a tier's 5-card pool. */
  rollTier: (tier: TierId) => void;
  dismissReveal: () => void;

  /** Study: spend GRAM → +level, income ×2, power ×1.5. Live path: `study_upgrade_character`. */
  upgradeCharacter: (characterId: string) => Promise<void>;
  /** Risk/Reward merge of 2 same-name, same-level cards → sets `mergeResult`. Live: `merge_user_characters`. */
  mergeCharacters: (name: string, level: number) => void;
  dismissMergeResult: () => void;

  /** Claim today's streak reward and advance / reset the streak. Live: `claim_daily_streak`. */
  claimDailyCheckIn: () => Promise<void>;
  claimQuestReward: (questId: QuestId) => void;

  /** Pick the GRAM stake for the next duel. */
  setPvpStake: (stake: StakeTier) => void;
  /**
   * Fight a wager duel at `pvpStake`. Mock: resolve instantly vs a bot.
   * Live: join the oldest open lobby that isn't yours, or open one and wait.
   */
  startWagerBattle: () => Promise<void>;
  /** Load the real-players leaderboard (live only). */
  fetchLeaderboard: () => Promise<void>;
  /** Live: cancel your own open lobby and refund the stake. */
  cancelLobby: () => Promise<void>;
  /** Live: refresh the joinable-lobby list. */
  refreshLobbies: () => Promise<void>;
  /** Live: join a specific open lobby by id. */
  joinLobby: (lobbyId: string) => Promise<void>;
  dismissBattle: () => void;

  /** Move accrued referral commission into the main balance. Live: `claim_referral_rewards`. */
  claimReferralEarnings: () => void;

  setSettingsOpen: (open: boolean) => void;
  /** Show a transient banner. `clearToast` (or <Toast/>'s timer) dismisses it. */
  pushToast: (msg: string, kind?: 'error' | 'info') => void;
  clearToast: () => void;
  /** Toggle a push-notification preference (persists to Supabase in live mode). */
  setNotifPref: (key: keyof NotifPrefs, value: boolean) => void;
  /** Switch UI language: persist to localStorage + update <html dir/lang>. */
  setLang: (code: LangCode) => void;

  // --- admin (live only, requires profile.isAdmin) ---
  setAdminOpen: (open: boolean) => void;
  adminApproveWithdrawal: (txId: string, txHash: string) => Promise<void>;
  adminRejectWithdrawal: (txId: string) => Promise<void>;
  adminSetEmissionFactor: (factor: number) => Promise<number>;
  adminSetBanned: (userId: string, banned: boolean) => Promise<boolean>;
  adminGetSettings: () => Promise<WithdrawConfig>;
  adminToggleAutoWithdraw: (enabled: boolean, limit: number) => Promise<WithdrawConfig>;
  adminTriggerPayout: () => Promise<void>;
}

const bootTgUser = readTelegramUser();

/** Human-readable one-liner from a thrown RPC / PostgREST error. */
function rpcErr(err: unknown): string {
  const e = err as { message?: string; hint?: string; details?: string } | null;
  const raw = e?.message || e?.hint || e?.details || '';
  return (raw || 'Дію не виконано — спробуйте ще раз').slice(0, 140);
}

export const useGameStore = create<GameStore>()((set, get) => ({
  mode: 'mock',
  status: 'idle',
  profile: null,
  photoUrl: bootTgUser.photoUrl,
  displayName: bootTgUser.firstName ?? bootTgUser.username ?? 'Player',
  activeTab: 'farm',

  balanceGram: 0,
  pendingGram: 0,
  lockedGram: 0,
  incomePerDay: INCOME_PER_DAY,
  xp: 0,

  farm: {
    totalIncomePerDay: INCOME_PER_DAY,
    lastClaimAt: seedLastClaimAt,
    nextClaimAt: seedNextClaimAt,
    claimableGram: 0,
  },
  tiers: SEED_TIERS,
  // zero onboarding — empty history / streak / referrals until real activity
  transactions: [],

  reveal: null,
  battle: null,
  mergeResult: null,

  quests: DEFAULT_QUESTS.map((q) => ({ ...q })),
  questsResetAt: bootNow,
  streakDay: bootStreak.day,
  lastCheckInAt: bootStreak.at,
  dailyBuffUntil: 0,
  dailyBuffPct: 0,

  pvpRating: 0,
  pvpStake: 0.25,
  pvpLobby: null,
  openLobbies: [],
  leaderboard: [],

  referralCode: '', // real code arrives from the server on hydrate (live)
  referralStats: {
    l1Count: 0,
    l2Count: 0,
    l3Count: 0,
    l1Earned: 0,
    l2Earned: 0,
    l3Earned: 0,
    unclaimedGram: 0,
  },
  referralsList: [],

  invites: 0,
  adminOpen: false,
  settingsOpen: false,
  toast: null,
  notifPrefs: { ...DEFAULT_NOTIF_PREFS },
  lang: loadLang(),
  lastWithdrawAt: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  hydrate: async () => {
    if (get().status === 'loading') return;

    if (!isSupabaseConfigured) {
      set({ mode: 'mock', status: 'ready' });
      return;
    }

    set({ status: 'loading' });
    try {
      const [profile, farmData, txs] = await Promise.all([
        fetchUserProfile(),
        fetchFarmData(),
        fetchTransactions(),
      ]);

      // adopt a server-side language choice if it's a language we know
      const serverLang = profile.notifPrefs?.lang;
      if (isLang(serverLang) && serverLang !== get().lang) {
        saveLang(serverLang);
        applyDir(serverLang);
      }

      set((st) => ({
        mode: 'live',
        status: 'ready',
        profile,
        photoUrl: profile.photoUrl ?? st.photoUrl,
        displayName: profile.firstName ?? profile.username ?? st.displayName,
        notifPrefs: profile.notifPrefs ?? st.notifPrefs,
        lang: isLang(serverLang) ? serverLang : st.lang,
        referralCode: profile.referralCode ?? st.referralCode,
        balanceGram: farmData.balanceGram,
        pendingGram: farmData.pendingGram,
        lockedGram: farmData.lockedGram,
        incomePerDay: farmData.incomePerDay,
        farm: farmData.farm,
        tiers: farmData.tiers,
        transactions: txs,
      }));

      // referral dashboard — non-fatal if it fails
      try {
        const ref = await fetchReferralData();
        set((st) => ({
          referralStats: ref.stats,
          referralsList: ref.friends,
          referralCode: ref.code ?? st.referralCode,
        }));
      } catch (e) {
        console.warn('[store] referral fetch skipped:', e);
      }

      // pvp profile — rating / xp / streak from the server (non-fatal)
      try {
        const pvp = await fetchPvpProfile();
        set({
          xp: pvp.xp,
          pvpRating: pvp.rating,
          streakDay: pvp.streakDay,
          lastCheckInAt: pvp.lastCheckInAt,
        });
      } catch (e) {
        console.warn('[store] pvp profile fetch skipped:', e);
      }
    } catch (err) {
      console.warn('[store] Supabase hydrate failed — falling back to mock data:', err);
      set({ mode: 'mock', status: 'ready' });
    }
  },

  accrue: () =>
    set((s) => {
      const t = Date.now();
      const span = s.farm.nextClaimAt - s.farm.lastClaimAt || COOLDOWN_MS;
      const elapsed = Math.min(Math.max(t - s.farm.lastClaimAt, 0), span);
      const buff = s.dailyBuffUntil > t ? 1 + s.dailyBuffPct / 100 : 1;
      const claimable = round4(s.incomePerDay * buff * (elapsed / DAY_MS));
      if (claimable === s.farm.claimableGram) return s;
      return { farm: { ...s.farm, claimableGram: claimable } };
    }),

  tickDaily: () =>
    set((s) => {
      const now = Date.now();
      // daily quest rollover (no more raid-ticket refill — PvP is unlimited)
      if (isSameUtcDay(s.questsResetAt, now)) return s;
      return {
        quests: DEFAULT_QUESTS.map((q) => ({ ...q })),
        questsResetAt: now,
      };
    }),

  claim: async () => {
    const s = get();

    if (s.mode === 'live') {
      try {
        const res = await claimIncomeRPC();
        const t = Date.now();
        set((st) => ({
          balanceGram: res.newAvailableGram,
          farm: { ...st.farm, claimableGram: 0, lastClaimAt: t, nextClaimAt: res.nextClaimAt },
          transactions: [
            { id: `tx-${t}`, type: 'FARM_CLAIM', amount: res.earnedGram, status: 'COMPLETED', timestamp: t, txHash: null },
            ...st.transactions,
          ],
        }));
      } catch (err) {
        console.warn('[store] claim RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    set((st) => {
      const amount = st.farm.claimableGram;
      if (amount <= 0) return st;
      const t = Date.now();
      const tx: Transaction = { id: `tx-${t}`, type: 'FARM_CLAIM', amount, status: 'COMPLETED', timestamp: t, txHash: mockHash() };
      return {
        balanceGram: round4(st.balanceGram + amount),
        transactions: [tx, ...st.transactions],
        farm: { ...st.farm, claimableGram: 0, lastClaimAt: t, nextClaimAt: t + COOLDOWN_MS },
        quests: bumpQuests(st.quests, 'farm_claim'),
      };
    });
  },

  deposit: (amount, txHash = null) =>
    set((s) => {
      if (amount <= 0) return s;
      const t = Date.now();
      const tx: Transaction = {
        id: `tx-${t}`,
        type: 'DEPOSIT',
        amount,
        status: 'PENDING',
        timestamp: t,
        txHash,
        address: s.profile?.walletAddress ?? null,
      };
      // Balance is credited only when the on-chain deposit confirms; until then
      // the amount shows up in the "Pending" plate + confirmations tab.
      return { transactions: [tx, ...s.transactions] };
    }),

  requestWithdrawal: async (amount, address) => {
    const s = get();
    if (amount < WITHDRAW_MIN || amount > s.balanceGram) return;
    if (s.lastWithdrawAt && Date.now() - s.lastWithdrawAt < WITHDRAW_COOLDOWN_MS) return;

    const fee = withdrawalFee(amount);
    const net = round4(amount - fee);
    if (net <= 0) return;

    if (s.mode === 'live') {
      try {
        const res = await requestWithdrawalRPC(amount, address);
        const t = Date.now();
        set((st) => ({
          balanceGram: res.newAvailableGram,
          lockedGram: round4(st.lockedGram + amount),
          lastWithdrawAt: t,
          transactions: [
            { id: res.txId || `tx-${t}`, type: 'WITHDRAW', amount, fee: res.fee, netAmount: res.netAmount, address, status: 'PENDING', timestamp: t, txHash: null },
            ...st.transactions,
          ],
        }));
      } catch (err) {
        console.warn('[store] request_withdrawal RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    const t = Date.now();
    const tx: Transaction = {
      id: `tx-${t}`,
      type: 'WITHDRAW',
      amount,
      fee,
      netAmount: net,
      address,
      status: 'PENDING',
      timestamp: t,
      txHash: null,
    };
    set((st) => ({
      balanceGram: round4(st.balanceGram - amount),
      lockedGram: round4(st.lockedGram + amount),
      lastWithdrawAt: t,
      transactions: [tx, ...st.transactions],
    }));
  },

  rollTier: async (tier) => {
    const s = get();
    const row = s.tiers.find((r) => r.tier === tier);
    if (!row) return;
    const cost = row.costGram;
    if (s.balanceGram + 1e-9 < cost) return;

    if (s.mode === 'live') {
      try {
        const res = await rollTierRPC(tier);
        const card =
          tierPool(tier).find((c) => c.slot === res.cardSlot) ?? tierPool(tier)[0];
        const character: MemeCharacter = {
          ...characterFromCard(card),
          name: res.name || card.name,
          currentIncome: res.incomeDay || card.incomePerDay,
          baseIncome: res.incomeDay || card.incomePerDay,
        };
        applyRoll(set, { tier, card, character, balanceOverride: res.newBalanceGram });
      } catch (err) {
        console.warn('[store] rollTier RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    const card = rollTierCard(tier);
    const character = characterFromCard(card);
    applyRoll(set, { tier, card, character });
  },

  dismissReveal: () => set({ reveal: null }),

  upgradeCharacter: async (characterId) => {
    const s = get();
    const owner = s.tiers.find((r) => r.characters.some((c) => c.id === characterId));
    const target = owner?.characters.find((c) => c.id === characterId);
    if (!owner || !target) return;
    if (s.balanceGram + 1e-9 < studyFeeGram(target.studyLevel)) return;

    if (s.mode === 'live') {
      try {
        await studyUpgradeRPC(characterId);
        await refetchLive(set);
      } catch (err) {
        console.warn('[store] study_upgrade RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    set((st) => {
      const own = st.tiers.find((r) => r.characters.some((c) => c.id === characterId));
      const tgt = own?.characters.find((c) => c.id === characterId);
      if (!own || !tgt) return st;
      const fee = studyFeeGram(tgt.studyLevel);
      if (st.balanceGram + 1e-9 < fee) return st;

      // Study raises PvP power only — income (currentIncome) is never touched.
      const tiers = st.tiers.map((r) =>
        r.tier === own.tier
          ? {
              ...r,
              characters: r.characters.map((c) =>
                c.id === characterId
                  ? {
                      ...c,
                      studyLevel: c.studyLevel + 1,
                      power: characterPower(c.basePower, c.level, c.studyLevel + 1),
                    }
                  : c,
              ),
            }
          : r,
      );
      const t = Date.now();
      const tx: Transaction = {
        id: `tx-${t}`,
        type: 'STUDY_FEE',
        amount: fee,
        status: 'COMPLETED',
        timestamp: t,
        txHash: mockHash(),
      };
      return {
        balanceGram: round4(st.balanceGram - fee),
        tiers,
        transactions: [tx, ...st.transactions],
        quests: bumpQuests(st.quests, 'study_upgrade'),
      };
    });
  },

  mergeCharacters: async (name, level) => {
    const s = get();
    const owner = s.tiers.find(
      (r) => r.characters.filter((c) => c.name === name && c.level === level).length >= 2,
    );
    if (!owner) return;
    if (s.balanceGram + 1e-9 < mergeFee(owner.tier)) return;
    const sample = owner.characters.find((c) => c.name === name && c.level === level)!;

    if (s.mode === 'live') {
      try {
        const res = await mergeCharactersRPC(`t${sample.tier}_c${sample.cardSlot}`, level);
        await refetchLive(set);
        set({
          mergeResult: {
            status: res.status,
            delta: res.delta,
            roll: res.roll,
            fromLevel: level,
            newLevel: res.newLevel,
            name: sample.name,
            memeType: sample.memeType,
            rarity: sample.rarity,
            tier: sample.tier,
            fee: res.fee,
            incomeBefore: sample.currentIncome,
            incomeAfter: res.newIncomeDay,
            powerBefore: sample.power,
            powerAfter: res.newPower,
          },
        });
      } catch (err) {
        console.warn('[store] merge_user_characters RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    const outcome = rollMerge();

    set((st) => {
      const own = st.tiers.find(
        (r) => r.characters.filter((c) => c.name === name && c.level === level).length >= 2,
      );
      if (!own) return st;
      const fee = mergeFee(own.tier);
      if (st.balanceGram + 1e-9 < fee) return st;

      const dupes = own.characters.filter((c) => c.name === name && c.level === level);
      const survivor = dupes[0];
      const material = dupes[1];

      const isFail = outcome.status === 'FAIL';
      const newLevel = isFail ? level : Math.min(MERGE_LEVEL_CAP, level + outcome.delta);
      // Merge raises the merge level → income AND power both grow (deterministic
      // off the card's base; the survivor's Study points are preserved).
      const incomeAfter = isFail
        ? survivor.currentIncome
        : mergedIncome(survivor.baseIncome, newLevel);
      const powerAfter = isFail
        ? survivor.power
        : characterPower(survivor.basePower, newLevel, survivor.studyLevel);

      const tiers = st.tiers.map((r) => {
        if (r.tier !== own.tier) return r;
        const characters = r.characters
          .filter((c) => c.id !== material.id)
          .map((c) =>
            c.id === survivor.id && !isFail
              ? { ...c, level: newLevel, currentIncome: incomeAfter, power: powerAfter }
              : c,
          );
        return { ...r, characters };
      });

      const t = Date.now();
      const tx: Transaction = {
        id: `tx-${t}`,
        type: 'MERGE_FEE',
        amount: fee,
        status: 'COMPLETED',
        timestamp: t,
        txHash: mockHash(),
      };
      const incomePerDay = totalIncome(tiers);
      const gainedXp = isFail ? 0 : XP_MERGE_BASE + (newLevel - level) * XP_MERGE_PER_LEVEL;

      return {
        balanceGram: round4(st.balanceGram - fee),
        xp: st.xp + gainedXp,
        tiers,
        transactions: [tx, ...st.transactions],
        incomePerDay,
        farm: { ...st.farm, totalIncomePerDay: incomePerDay },
        mergeResult: {
          status: outcome.status,
          delta: isFail ? 0 : newLevel - level,
          roll: outcome.roll,
          fromLevel: level,
          newLevel,
          name: survivor.name,
          memeType: survivor.memeType,
          rarity: survivor.rarity,
          tier: own.tier,
          fee,
          incomeBefore: survivor.currentIncome,
          incomeAfter,
          powerBefore: survivor.power,
          powerAfter,
        },
      };
    });
  },

  dismissMergeResult: () => set({ mergeResult: null }),

  claimDailyCheckIn: async () => {
    const s = get();
    const now = Date.now();
    if (s.lastCheckInAt && isSameUtcDay(s.lastCheckInAt, now)) return;

    if (s.mode === 'live') {
      try {
        const res = await claimDailyStreakRPC();
        const pvp = await fetchPvpProfile();
        set({
          streakDay: res.streakDay,
          lastCheckInAt: pvp.lastCheckInAt ?? now,
          xp: pvp.xp,
          pvpRating: pvp.rating,
          balanceGram: res.newAvailableGram,
        });
      } catch (err) {
        console.warn('[store] claim_daily_streak failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    // ----- mock -----
    set((st) => {
      if (st.lastCheckInAt && isSameUtcDay(st.lastCheckInAt, now)) return st;
      const gap = st.lastCheckInAt == null ? 999 : utcDaysBetween(st.lastCheckInAt, now);
      const prevDay = gap === 1 ? st.streakDay : 0;
      const day = prevDay >= 7 ? 1 : prevDay + 1;
      saveStreak(day, now); // survive a reload — no re-claim of the same day
      return {
        ...grantRewards(st, STREAK_DAYS[day - 1].rewards),
        streakDay: day,
        lastCheckInAt: now,
      };
    });
  },

  claimQuestReward: (questId) =>
    set((s) => {
      const q = s.quests.find((x) => x.id === questId);
      if (!q || q.claimed || q.progress < q.goal) return s;
      return {
        ...grantRewards(s, [q.reward]),
        quests: s.quests.map((x) => (x.id === questId ? { ...x, claimed: true } : x)),
      };
    }),

  setPvpStake: (stake) => set({ pvpStake: stake }),

  // Find a match against a REAL player: join the oldest open lobby at this
  // stake, otherwise open one and wait for someone to join. No bots.
  startWagerBattle: async () => {
    const s = get();
    if (s.mode !== 'live') return; // PvP is online-only
    const stake = s.pvpStake;
    if (s.balanceGram + 1e-9 < stake) return;
    try {
      const open = (await fetchOpenLobbies()).filter((l) => l.stake === stake);
      if (open.length > 0) {
        await get().joinLobby(open[0].id);
        return;
      }
      const lobby = await createPvpLobbyRPC(stake);
      await refetchLive(set);
      set({ pvpLobby: { id: lobby.id, stake } });
    } catch (err) {
      console.warn('[store] create/join lobby failed:', err);
      set({ toast: { msg: rpcErr(err), kind: 'error' } });
    }
  },

  joinLobby: async (lobbyId) => {
    const s = get();
    if (s.mode !== 'live') return;
    try {
      const res = await joinPvpLobbyRPC(lobbyId);
      await refetchLive(set);
      const opponent: RaidOpponent = {
        id: lobbyId,
        name: 'Opponent',
        memeType: 'gigachad',
        power: res.opponentPower,
      };
      const rewards: Reward[] = [{ kind: 'xp', amount: res.won ? 150 : 50 }];
      set((st) => ({
        pvpLobby: null,
        openLobbies: st.openLobbies.filter((l) => l.id !== lobbyId),
        pvpRating: Math.max(0, res.newRating),
        quests: res.won ? bumpQuests(st.quests, 'raid_win') : st.quests,
        battle: {
          opponent,
          userPower: res.youPower,
          won: res.won,
          winChance: res.winChance,
          ratingDelta: res.ratingDelta,
          newRating: res.newRating,
          rewards,
          stake: res.stake,
          pot: res.pot,
          fee: res.feeAmount,
          payout: res.winnerPayout,
        },
      }));
    } catch (err) {
      console.warn('[store] join_pvp_lobby failed:', err);
      set({ toast: { msg: rpcErr(err), kind: 'error' } });
    }
  },

  cancelLobby: async () => {
    const s = get();
    const lobby = s.pvpLobby;
    if (!lobby) return;
    if (s.mode === 'live') {
      try {
        await cancelPvpLobbyRPC(lobby.id);
        await refetchLive(set);
      } catch (err) {
        console.warn('[store] cancel_pvp_lobby failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
    }
    set({ pvpLobby: null });
  },

  refreshLobbies: async () => {
    if (get().mode !== 'live') return;
    try {
      set({ openLobbies: await fetchOpenLobbies() });
    } catch (err) {
      console.warn('[store] fetchOpenLobbies failed:', err);
    }
  },

  fetchLeaderboard: async () => {
    if (get().mode !== 'live') return;
    try {
      const rows = await fetchPvpLeaderboard(20);
      set({
        leaderboard: rows.map((r) => ({
          name: r.name,
          memeType: (r.memeType as LeaderRow['memeType']) ?? 'gigachad',
          rating: r.rating,
          power: r.power,
          xp: r.xp,
        })),
      });
    } catch (err) {
      console.warn('[store] fetchPvpLeaderboard failed:', err);
    }
  },

  dismissBattle: () => set({ battle: null }),

  claimReferralEarnings: async () => {
    const s = get();
    const amount = s.referralStats.unclaimedGram;
    if (amount <= 0) return;

    if (s.mode === 'live') {
      try {
        const res = await claimReferralRewardsRPC();
        const t = Date.now();
        set((st) => ({
          balanceGram: res.newAvailableGram,
          referralStats: { ...st.referralStats, unclaimedGram: 0 },
          transactions: [
            { id: res.txId || `tx-${t}`, type: 'REFERRAL_REWARD', amount: res.claimedGram, status: 'COMPLETED', timestamp: t, txHash: null },
            ...st.transactions,
          ],
        }));
      } catch (err) {
        console.warn('[store] claim_referral_rewards RPC failed:', err);
        set({ toast: { msg: rpcErr(err), kind: 'error' } });
      }
      return;
    }

    const t = Date.now();
    set((st) => ({
      balanceGram: round4(st.balanceGram + amount),
      referralStats: { ...st.referralStats, unclaimedGram: 0 },
      transactions: [
        { id: `tx-${t}`, type: 'REFERRAL_REWARD', amount, status: 'COMPLETED', timestamp: t, txHash: mockHash() },
        ...st.transactions,
      ],
    }));
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  pushToast: (msg, kind = 'error') => set({ toast: { msg, kind } }),
  clearToast: () => set({ toast: null }),

  setLang: (code) => {
    saveLang(code);
    applyDir(code);
    set((s) => {
      const notifPrefs = { ...s.notifPrefs, lang: code };
      if (s.mode === 'live') {
        void updateNotifPrefs(notifPrefs).catch((err) =>
          console.warn('[store] setLang persist failed:', err),
        );
      }
      return {
        lang: code,
        notifPrefs,
        profile: s.profile ? { ...s.profile, notifPrefs } : s.profile,
      };
    });
  },

  setNotifPref: (key, value) =>
    set((s) => {
      const notifPrefs = { ...s.notifPrefs, [key]: value };
      if (s.mode === 'live') {
        void updateNotifPrefs(notifPrefs).catch((err) =>
          console.warn('[store] updateNotifPrefs failed:', err),
        );
      }
      return {
        notifPrefs,
        profile: s.profile ? { ...s.profile, notifPrefs } : s.profile,
      };
    }),

  // --- admin ---
  setAdminOpen: (open) => set({ adminOpen: open }),

  adminApproveWithdrawal: async (txId, txHash) => {
    await adminProcessWithdrawal(txId, 'APPROVE', txHash);
  },

  adminRejectWithdrawal: async (txId) => {
    await adminProcessWithdrawal(txId, 'REJECT');
  },

  adminSetEmissionFactor: async (factor) => {
    const res = await adminUpdateEmissionFactor(factor);
    return res.emissionFactor;
  },

  adminSetBanned: async (userId, banned) => {
    return adminBanUser(userId, banned);
  },

  adminGetSettings: async () => adminGetSettings(),
  adminToggleAutoWithdraw: async (enabled, limit) => adminToggleAutoWithdraw(enabled, limit),
  adminTriggerPayout: async () => adminTriggerPayout(),
}));

// --- rewards -----------------------------------------------------------

function grantRewards(st: GameStore, rewards: Reward[]): Partial<GameStore> {
  let { xp, balanceGram, dailyBuffUntil, dailyBuffPct, tiers } = st;

  for (const r of rewards) {
    switch (r.kind) {
      case 'xp':
        xp += r.amount;
        break;
      case 'gram':
        balanceGram = round4(balanceGram + r.amount);
        break;
      case 'buff':
        dailyBuffUntil = Date.now() + DAILY_BUFF_MS;
        dailyBuffPct = r.amount;
        break;
      case 'case': {
        const card = rollTierCard(1);
        const ch = characterFromCard(card);
        tiers = tiers.map((row) =>
          row.tier === 1
            ? {
                ...row,
                characters: [...row.characters, ch],
                discovered: row.discovered.includes(card.slot)
                  ? row.discovered
                  : ([...row.discovered, card.slot].sort((a, b) => a - b) as CardSlot[]),
              }
            : row,
        );
        break;
      }
    }
  }

  const incomePerDay = totalIncome(tiers);
  return {
    xp,
    balanceGram,
    dailyBuffUntil,
    dailyBuffPct,
    tiers,
    incomePerDay,
    farm: { ...st.farm, totalIncomePerDay: incomePerDay },
  };
}

// --- roll helper (shared by mock + live paths) --------------------------

type SetFn = (updater: (s: GameStore) => GameStore | Partial<GameStore>) => void;

function applyRoll(
  set: SetFn,
  args: { tier: TierId; card: GachaCard; character: MemeCharacter; balanceOverride?: number },
) {
  const { tier, card, character, balanceOverride } = args;
  set((s) => {
    const row = s.tiers.find((r) => r.tier === tier);
    if (!row) return s;
    const isNew = !row.discovered.includes(card.slot);
    const tiers = s.tiers.map((r) =>
      r.tier === tier
        ? {
            ...r,
            discovered: isNew
              ? ([...r.discovered, card.slot].sort((a, b) => a - b) as CardSlot[])
              : r.discovered,
            characters: [...r.characters, character],
          }
        : r,
    );
    const t = Date.now();
    const tx: Transaction = {
      id: `tx-${t}`,
      type: 'TIER_ROLL',
      amount: row.costGram,
      status: 'COMPLETED',
      timestamp: t,
      txHash: s.mode === 'live' ? null : mockHash(),
    };
    const incomePerDay = totalIncome(tiers);
    return {
      balanceGram: round4(balanceOverride ?? s.balanceGram - row.costGram),
      xp: s.xp + XP_PER_ROLL,
      tiers,
      transactions: [tx, ...s.transactions],
      incomePerDay,
      farm: { ...s.farm, totalIncomePerDay: incomePerDay },
      reveal: { tier, card, character, isNewDiscovery: isNew, jackpot: card.rarity === 'legendary' },
      quests: bumpQuests(s.quests, 'tier_roll'),
    };
  });
}

/** Pull the live farm slice + tx history and merge it into the store. */
async function refetchLive(set: SetFn) {
  const [data, txs] = await Promise.all([fetchFarmData(), fetchTransactions()]);
  set(() => ({
    balanceGram: data.balanceGram,
    pendingGram: data.pendingGram,
    lockedGram: data.lockedGram,
    incomePerDay: data.incomePerDay,
    farm: data.farm,
    tiers: data.tiers,
    transactions: txs,
  }));
}

// --- selectors --------------------------------------------------------

export const flattenCharacters = (tiers: TierRow[]): MemeCharacter[] =>
  tiers.flatMap((r) => r.characters);

/** Lifetime GRAM pulled off the farm (completed FARM_CLAIM entries). */
export const selectTotalEarned = (s: GameStore): number =>
  round4(
    s.transactions
      .filter((t) => t.type === 'FARM_CLAIM' && t.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.amount, 0),
  );

/** GRAM currently in flight — pending deposits + pending withdrawals. */
export const selectPendingGram = (s: GameStore): number =>
  round4(
    s.transactions
      .filter((t) => t.status === 'PENDING')
      .reduce((sum, t) => sum + t.amount, 0),
  );

export interface CollectionGroup {
  key: string;
  sample: MemeCharacter;
  count: number;
  /** Instances by level, e.g. { 1: 3, 2: 1 } — drives merge availability. */
  byLevel: Record<number, number>;
  /** Highest level with ≥2 instances (mergeable), or 0. */
  mergeableLevel: number;
  /** GRAM farmed so far, summed over every instance in the group. */
  farmed: number;
  /** Lifetime farm cap, summed over every instance in the group. */
  farmCap: number;
}

/** Owned characters grouped by name, richest first. */
export function groupCollection(tiers: TierRow[]): CollectionGroup[] {
  const map = new Map<string, CollectionGroup>();
  for (const c of flattenCharacters(tiers)) {
    let g = map.get(c.name);
    if (!g) {
      g = { key: c.name, sample: c, count: 0, byLevel: {}, mergeableLevel: 0, farmed: 0, farmCap: 0 };
      map.set(c.name, g);
    }
    g.count += 1;
    g.byLevel[c.level] = (g.byLevel[c.level] ?? 0) + 1;
    g.farmed = round4(g.farmed + c.lifetimeEarned);
    g.farmCap += c.earnCap;
    if (c.currentIncome > g.sample.currentIncome) g.sample = c;
  }
  for (const g of map.values()) {
    g.mergeableLevel = Object.entries(g.byLevel)
      .filter(([, n]) => n >= 2)
      .map(([lvl]) => Number(lvl))
      .reduce((max, lvl) => Math.max(max, lvl), 0);
  }
  return [...map.values()].sort((a, b) => b.sample.currentIncome - a.sample.currentIncome);
}

/** Distinct cards discovered across all six tiers (out of 60). */
export const selectDiscoveredCount = (s: GameStore): number =>
  s.tiers.reduce((sum, r) => sum + r.discovered.length, 0);

/** Sum of every owned instance's PvP power. */
export const selectFarmPower = (s: GameStore): number =>
  Math.round(flattenCharacters(s.tiers).reduce((sum, c) => sum + c.power, 0));

/** Daily income after the streak-7 buff, if active. */
export const selectEffectiveIncome = (s: GameStore): number =>
  round4(s.incomePerDay * (s.dailyBuffUntil > Date.now() ? 1 + s.dailyBuffPct / 100 : 1));

export const selectBuffActive = (s: GameStore): boolean => s.dailyBuffUntil > Date.now();

/** Can the player check in for the streak right now (new UTC day)? */
export const selectCanCheckIn = (s: GameStore): boolean =>
  s.lastCheckInAt == null || !isSameUtcDay(s.lastCheckInAt, Date.now());

/** Quests done vs total, plus how many rewards are waiting to be claimed. */
export const selectDailyProgress = (s: GameStore): { done: number; total: number; claimable: number } => ({
  done: s.quests.filter((q) => q.claimed).length,
  total: s.quests.length,
  claimable: s.quests.filter((q) => !q.claimed && q.progress >= q.goal).length,
});

/** Bottom-nav badge for the quests tab: pending check-in + claimable rewards. */
export const selectQuestBadge = (s: GameStore): number => {
  const p = selectDailyProgress(s);
  return (selectCanCheckIn(s) ? 1 : 0) + p.claimable;
};

/** Referral roll-ups for the invite dashboard. */
export const selectReferralTotals = (
  s: GameStore,
): { invites: number; lifetimeEarned: number } => {
  const r = s.referralStats;
  return {
    invites: r.l1Count + r.l2Count + r.l3Count,
    lifetimeEarned: round4(r.l1Earned + r.l2Earned + r.l3Earned + r.unclaimedGram),
  };
};
