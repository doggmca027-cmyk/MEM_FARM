import type { MemeType } from '../types/game';
import type { RaidOpponent } from '../types/quests';

interface OpponentProfile {
  id: string;
  name: string;
  memeType: MemeType;
}

const PROFILES: OpponentProfile[] = [
  { id: 'op-doge', name: 'DogeMiner', memeType: 'doge' },
  { id: 'op-pepe', name: 'PepeKing', memeType: 'pepe' },
  { id: 'op-chad', name: 'CyberChad', memeType: 'gigachad' },
  { id: 'op-capy', name: 'CapyBaron', memeType: 'capybara' },
  { id: 'op-rug', name: 'RugPuller99', memeType: 'doge' },
  { id: 'op-moon', name: 'MoonBoi', memeType: 'pepe' },
  { id: 'op-whale', name: 'GigaWhale', memeType: 'gigachad' },
  { id: 'op-ape', name: 'ApeInAlways', memeType: 'capybara' },
];

/** Random opponent scaled to ~70–130% of the user's power. */
export function pickOpponent(userPower: number, excludeId?: string): RaidOpponent {
  const pool = PROFILES.filter((p) => p.id !== excludeId);
  const p = pool[Math.floor(Math.random() * pool.length)] ?? PROFILES[0];
  const factor = 0.7 + Math.random() * 0.6;
  const power = Math.max(50, Math.round(Math.max(userPower, 100) * factor));
  return { id: `${p.id}-${Date.now().toString(36)}`, name: p.name, memeType: p.memeType, power };
}

export interface LeaderRow {
  name: string;
  memeType: MemeType;
  rating: number;
  /** Total farm power (⚡). */
  power: number;
  /** All-time leaderboard XP (⭐). */
  xp: number;
}

/** Static top players — the local user is spliced in at render time. */
export const LEADERBOARD: LeaderRow[] = [
  { name: 'xX_Sigma_Xx', memeType: 'gigachad', rating: 2480, power: 41200, xp: 128400 },
  { name: 'PepeKing', memeType: 'pepe', rating: 2310, power: 37800, xp: 96300 },
  { name: 'DogeMiner', memeType: 'doge', rating: 2180, power: 33100, xp: 154900 },
  { name: 'CapyBaron', memeType: 'capybara', rating: 1990, power: 28700, xp: 61200 },
  { name: 'CyberChad', memeType: 'gigachad', rating: 1840, power: 24500, xp: 88700 },
  { name: 'MoonBoi', memeType: 'pepe', rating: 1620, power: 19800, xp: 43100 },
  { name: 'GigaWhale', memeType: 'gigachad', rating: 1470, power: 16400, xp: 72500 },
  { name: 'RugPuller99', memeType: 'doge', rating: 1290, power: 12900, xp: 21800 },
  { name: 'ApeInAlways', memeType: 'capybara', rating: 1130, power: 9600, xp: 33400 },
  { name: 'FrogWizard', memeType: 'pepe', rating: 1015, power: 7300, xp: 15900 },
];
