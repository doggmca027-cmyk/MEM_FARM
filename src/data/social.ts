/** One-time channel-subscription tasks. No subscription check — the reward is
 *  claimable once opening the channel link. Reward is enforced server-side by
 *  `claim_social_task` (0.05 GRAM per task, once ever). */
export interface SocialTask {
  /** Must match the id in claim_social_task(). */
  id: string;
  channel: string;
  url: string;
  reward: number;
}

export const SOCIAL_TASKS: SocialTask[] = [
  {
    id: 'sub_meme_farm_trans',
    channel: '@MEME_FARM_trans',
    url: 'https://t.me/MEME_FARM_trans',
    reward: 0.05,
  },
  {
    id: 'sub_meme_farm_anonce',
    channel: '@MEME_FARM_ANONCE',
    url: 'https://t.me/MEME_FARM_ANONCE',
    reward: 0.05,
  },
];
