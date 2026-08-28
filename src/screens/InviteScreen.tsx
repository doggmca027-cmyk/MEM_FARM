import { useState } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Check, Copy, Gift, Share2, Users } from 'lucide-react';
import type { ReferralTier } from '../types/referral';
import { selectReferralTotals, useGameStore } from '../store/useGameStore';
import { BOT_USERNAME, referralLink } from '../lib/config';
import { openTelegramShare } from '../telegram/telegram';
import { fmtGram } from '../lib/format';
import { MEME_EMOJI } from '../lib/meme';
import { fireClaimConfetti } from '../lib/confetti';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { GramIcon } from '../components/icons/Icons';
import { useT } from '../i18n/useT';

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const TIER_META: Record<ReferralTier, { rate: number; labelKey: string; hex: string }> = {
  1: { rate: 5, labelKey: 'invite.tier1Label', hex: '#84CC16' },
  2: { rate: 2, labelKey: 'invite.tier2Label', hex: '#06B6D4' },
  3: { rate: 1, labelKey: 'invite.tier3Label', hex: '#A855F7' },
};
const FALLBACK_TIER = TIER_META[3];
const tierMeta = (tier: number) => TIER_META[tier as ReferralTier] ?? FALLBACK_TIER;

const EMPTY_STATS = {
  l1Count: 0, l2Count: 0, l3Count: 0,
  l1Earned: 0, l2Earned: 0, l3Earned: 0,
  unclaimedGram: 0,
};

function ago(ts: number, t: TFn): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) {
    const h = Math.max(1, Math.floor((Date.now() - ts) / 3_600_000));
    return t('invite.agoHours', { n: h });
  }
  return t('invite.agoDays', { n: d });
}

export function InviteScreen() {
  const t = useT();
  const code = useGameStore((s) => s.referralCode);
  const stats = useGameStore((s) => s.referralStats) ?? EMPTY_STATS;
  const friends = useGameStore((s) => s.referralsList) ?? [];
  const claimReferralEarnings = useGameStore((s) => s.claimReferralEarnings);
  // useShallow: selectReferralTotals returns a fresh object every call — without
  // shallow equality Zustand v5 loops forever → "Maximum update depth" crash.
  const totals = useGameStore(useShallow(selectReferralTotals));

  const [copied, setCopied] = useState(false);
  const link = referralLink(code); // '' when the code isn't loaded yet

  const copy = () => {
    if (!link) return;
    haptic.impact('medium');
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const share = () => {
    if (!link) return;
    haptic.impact('medium');
    openTelegramShare(link, t('invite.programSub'));
  };

  const onClaim = () => {
    if ((stats.unclaimedGram ?? 0) <= 0) return;
    fireClaimConfetti();
    haptic.notify('success');
    claimReferralEarnings();
  };

  const tierRow = (tier: ReferralTier, count: number, earned: number) => {
    const m = tierMeta(tier);
    return (
      <div
        key={tier}
        className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black bg-farm-card/80 p-2.5 text-center backdrop-blur-md"
        style={{ borderColor: m.hex, borderBottomColor: 'rgba(0,0,0,0.5)' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
        <div className="relative">
          <div className="font-display text-lg text-stroke-sm" style={{ color: m.hex }}>
            L{tier}
          </div>
          <div className="text-[9px] font-extrabold uppercase leading-tight text-white/45">
            {t(m.labelKey)}
          </div>
          <div className="mt-1 inline-block rounded-md border-2 border-black bg-neon-yellow px-1.5 text-[10px] font-extrabold leading-4 text-black">
            {m.rate}%
          </div>
          <div className="mt-1.5 text-xs font-bold text-white">{t('invite.friendsCount', { n: count })}</div>
          <div className="inline-flex items-center gap-0.5 text-[11px] font-bold text-neon-lime dir-ltr">
            <GramIcon className="h-3 w-3" />
            {fmtGram(earned)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* ===== LINK CARD ===== */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-cyan border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
        <div className="relative flex items-center gap-2 text-sm font-bold text-white/70">
          <Users className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
          {t('invite.program')}
        </div>
        <p className="relative mt-0.5 text-[11px] text-white/50">{t('invite.programSub')}</p>

        <div className="relative mt-3 rounded-2xl border-2 border-black bg-farm-deep p-2.5 text-center">
          <div className="text-[9px] font-extrabold uppercase tracking-widest text-white/40">
            {t('invite.yourCode')}
          </div>
          <div className="font-display text-2xl tracking-[0.2em] text-neon-yellow text-stroke dir-ltr">
            {code || '— — —'}
          </div>
          {code ? (
            <div className="mt-1 truncate text-[10px] text-white/40 dir-ltr">
              t.me/{BOT_USERNAME || 'bot'}?startapp=ref_{code}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-neon-pink">{t('invite.codeAfterLogin')}</div>
          )}
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <GameButton accent={copied ? 'lime' : 'cyan'} onClick={copy} className="text-xs">
            <span className="inline-flex items-center gap-1.5">
              {copied ? <Check className="h-4 w-4" strokeWidth={3} /> : <Copy className="h-4 w-4" strokeWidth={3} />}
              {copied ? t('invite.copied') : t('invite.copyLink')}
            </span>
          </GameButton>
          <GameButton accent="lime" onClick={share} className="text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Share2 className="h-4 w-4" strokeWidth={3} />
              {t('invite.share')}
            </span>
          </GameButton>
        </div>
      </motion.div>

      {/* ===== UNCLAIMED EARNINGS ===== */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-yellow border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              {t('invite.unclaimed')}
            </div>
            <div className="flex items-center gap-1.5 font-display text-3xl text-neon-yellow text-stroke dir-ltr">
              <GramIcon className="h-7 w-7" />
              {fmtGram(stats.unclaimedGram ?? 0)}
            </div>
          </div>
          <GameButton accent="yellow" disabled={(stats.unclaimedGram ?? 0) <= 0} onClick={onClaim}>
            {t('invite.claimReward')}
          </GameButton>
        </div>
      </div>

      {/* ===== 3-TIER DASHBOARD ===== */}
      <section>
        <h2 className="mb-2 font-display text-lg text-stroke">{t('invite.threeLines')}</h2>
        <div className="grid grid-cols-3 gap-2">
          {tierRow(1, stats.l1Count ?? 0, stats.l1Earned ?? 0)}
          {tierRow(2, stats.l2Count ?? 0, stats.l2Earned ?? 0)}
          {tierRow(3, stats.l3Count ?? 0, stats.l3Earned ?? 0)}
        </div>
        <div className="mt-2 flex gap-2">
          <div className="flex-1 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-center">
            <div className="font-display text-xl text-stroke-sm dir-ltr">{totals.invites}</div>
            <div className="text-[9px] font-extrabold uppercase text-white/40">{t('invite.totalInvited')}</div>
          </div>
          <div className="flex-1 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-center">
            <div className="inline-flex items-center gap-1 font-display text-xl text-neon-lime text-stroke-sm dir-ltr">
              <GramIcon className="h-4 w-4" />
              {fmtGram(totals.lifetimeEarned)}
            </div>
            <div className="text-[9px] font-extrabold uppercase text-white/40">{t('invite.totalEarned')}</div>
          </div>
        </div>
      </section>

      {/* ===== FRIENDS LIST ===== */}
      <section>
        <h2 className="mb-2 font-display text-lg text-stroke">{t('invite.invitedFriends')}</h2>
        {(friends ?? []).length === 0 ? (
          <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 px-4 py-10 text-center">
            <div className="text-4xl">🫂</div>
            <div className="mt-2 max-w-[30ch] text-xs text-white/50">{t('invite.emptyState')}</div>
          </div>
        ) : (
          <ul className="space-y-2">
            {(friends ?? []).map((f, i) => (
              <motion.li
                key={f.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="relative flex items-center gap-3 overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 px-3 py-2.5 backdrop-blur-md"
              >
                <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
                <span className="relative grid h-10 w-10 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep text-lg">
                  {MEME_EMOJI[f.memeType]}
                </span>
                <div className="relative min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold">{f.handle}</span>
                    <span
                      className="rounded border-2 border-black px-1 text-[8px] font-extrabold leading-3 text-black"
                      style={{ backgroundColor: tierMeta(f.tier).hex }}
                    >
                      L{f.tier}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/40">{ago(f.joinedAt, t)}</div>
                </div>
                <div className="relative inline-flex flex-none items-center gap-0.5 font-display text-sm text-neon-lime text-stroke-sm dir-ltr">
                  <GramIcon className="h-3.5 w-3.5" />
                  {fmtGram(f.broughtGram)}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
