import { useState } from 'react';
import { motion } from 'framer-motion';
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

const TIER_META: Record<ReferralTier, { rate: number; label: string; hex: string }> = {
  1: { rate: 5, label: 'Прямі друзі', hex: '#84CC16' },
  2: { rate: 2, label: 'Друзі друзів', hex: '#06B6D4' },
  3: { rate: 1, label: 'Суб-мережа', hex: '#A855F7' },
};

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) {
    const h = Math.max(1, Math.floor((Date.now() - ts) / 3_600_000));
    return `${h} год тому`;
  }
  return `${d} дн тому`;
}

export function InviteScreen() {
  const code = useGameStore((s) => s.referralCode);
  const stats = useGameStore((s) => s.referralStats);
  const friends = useGameStore((s) => s.referralsList);
  const claimReferralEarnings = useGameStore((s) => s.claimReferralEarnings);
  const totals = useGameStore(selectReferralTotals);

  const [copied, setCopied] = useState(false);
  const link = referralLink(code);

  const copy = () => {
    haptic.impact('medium');
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const share = () => {
    haptic.impact('medium');
    openTelegramShare(link, 'Заходь на Meme Farm — фарми GRAM з мемами! 🧪 +5% за реєстрацію по цьому лінку');
  };

  const onClaim = () => {
    if (stats.unclaimedGram <= 0) return;
    fireClaimConfetti();
    haptic.notify('success');
    claimReferralEarnings();
  };

  const tierRow = (tier: ReferralTier, count: number, earned: number) => {
    const m = TIER_META[tier];
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
            {m.label}
          </div>
          <div className="mt-1 inline-block rounded-md border-2 border-black bg-neon-yellow px-1.5 text-[10px] font-extrabold leading-4 text-black">
            {m.rate}%
          </div>
          <div className="mt-1.5 text-xs font-bold text-white">{count} друзів</div>
          <div className="inline-flex items-center gap-0.5 text-[11px] font-bold text-neon-lime">
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
          Реферальна програма
        </div>
        <p className="relative mt-0.5 text-[11px] text-white/50">
          Отримуй <span className="font-bold text-neon-lime">5% / 2% / 1%</span> з комісій друзів
          трьох рівнів — назавжди.
        </p>

        <div className="relative mt-3 rounded-2xl border-2 border-black bg-farm-deep p-2.5 text-center">
          <div className="text-[9px] font-extrabold uppercase tracking-widest text-white/40">
            Твій код
          </div>
          <div className="font-display text-2xl tracking-[0.2em] text-neon-yellow text-stroke">
            {code}
          </div>
          <div className="mt-1 truncate text-[10px] text-white/40">
            t.me/{BOT_USERNAME}?start=ref_{code}
          </div>
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <GameButton accent={copied ? 'lime' : 'cyan'} onClick={copy} className="text-xs">
            <span className="inline-flex items-center gap-1.5">
              {copied ? <Check className="h-4 w-4" strokeWidth={3} /> : <Copy className="h-4 w-4" strokeWidth={3} />}
              {copied ? 'Скопійовано' : 'Скопіювати посилання'}
            </span>
          </GameButton>
          <GameButton accent="lime" onClick={share} className="text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Share2 className="h-4 w-4" strokeWidth={3} />
              Поділитися
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
              Доступно до виведення
            </div>
            <div className="flex items-center gap-1.5 font-display text-3xl text-neon-yellow text-stroke">
              <GramIcon className="h-7 w-7" />
              {fmtGram(stats.unclaimedGram)}
            </div>
          </div>
          <GameButton accent="yellow" disabled={stats.unclaimedGram <= 0} onClick={onClaim}>
            Забрати нагороду
          </GameButton>
        </div>
      </div>

      {/* ===== 3-TIER DASHBOARD ===== */}
      <section>
        <h2 className="mb-2 font-display text-lg text-stroke">Три лінії</h2>
        <div className="grid grid-cols-3 gap-2">
          {tierRow(1, stats.l1Count, stats.l1Earned)}
          {tierRow(2, stats.l2Count, stats.l2Earned)}
          {tierRow(3, stats.l3Count, stats.l3Earned)}
        </div>
        <div className="mt-2 flex gap-2">
          <div className="flex-1 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-center">
            <div className="font-display text-xl text-stroke-sm">{totals.invites}</div>
            <div className="text-[9px] font-extrabold uppercase text-white/40">Всього запрошено</div>
          </div>
          <div className="flex-1 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-center">
            <div className="inline-flex items-center gap-1 font-display text-xl text-neon-lime text-stroke-sm">
              <GramIcon className="h-4 w-4" />
              {fmtGram(totals.lifetimeEarned)}
            </div>
            <div className="text-[9px] font-extrabold uppercase text-white/40">Всього зароблено</div>
          </div>
        </div>
      </section>

      {/* ===== FRIENDS LIST ===== */}
      <section>
        <h2 className="mb-2 font-display text-lg text-stroke">Запрошені друзі</h2>
        {friends.length === 0 ? (
          <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 px-4 py-10 text-center">
            <div className="text-4xl">🫂</div>
            <div className="mt-2 max-w-[30ch] text-xs text-white/50">
              У вас ще немає рефералів. Запросіть першого друга та отримуйте{' '}
              <span className="font-bold text-neon-lime">5% пасивного доходу</span>!
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {friends.map((f, i) => (
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
                      style={{ backgroundColor: TIER_META[f.tier].hex }}
                    >
                      L{f.tier}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/40">{ago(f.joinedAt)}</div>
                </div>
                <div className="relative inline-flex flex-none items-center gap-0.5 font-display text-sm text-neon-lime text-stroke-sm">
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
