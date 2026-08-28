import type { Quest, StreakDay } from '../types/quests';

/** 7-day daily check-in ladder. Day 7 is the super reward. */
export const STREAK_DAYS: StreakDay[] = [
  { day: 1, rewards: [{ kind: 'xp', amount: 150 }] },
  { day: 2, rewards: [{ kind: 'gram', amount: 0.05 }] },
  { day: 3, rewards: [{ kind: 'xp', amount: 220 }] },
  { day: 4, rewards: [{ kind: 'xp', amount: 300 }] },
  { day: 5, rewards: [{ kind: 'gram', amount: 0.03 }] },
  { day: 6, rewards: [{ kind: 'gram', amount: 0.12 }] },
  {
    day: 7,
    isSuper: true,
    rewards: [
      { kind: 'case', amount: 1 },
      { kind: 'buff', amount: 10 }, // +10% income for 24h
      { kind: 'xp', amount: 500 },
    ],
  },
];

/** Daily quests — reset each UTC day. */
export const DEFAULT_QUESTS: Quest[] = [
  {
    id: 'farm_claim',
    label: 'Зібрати дохід з ферми',
    goal: 1,
    progress: 0,
    claimed: false,
    reward: { kind: 'xp', amount: 120 },
  },
  {
    id: 'tier_roll',
    label: 'Зробити 1 ролл у будь-якому тирі',
    goal: 1,
    progress: 0,
    claimed: false,
    reward: { kind: 'gram', amount: 0.03 },
  },
  {
    id: 'raid_win',
    label: 'Перемогти у 2 рейдах',
    goal: 2,
    progress: 0,
    claimed: false,
    reward: { kind: 'xp', amount: 250 },
  },
  {
    id: 'study_upgrade',
    label: 'Покращити 1 персонажа',
    goal: 1,
    progress: 0,
    claimed: false,
    reward: { kind: 'xp', amount: 200 },
  },
];

/** Bonus chest for completing every daily quest. */
export const DAILY_CHEST_REWARD = { kind: 'gram', amount: 0.1 } as const;
