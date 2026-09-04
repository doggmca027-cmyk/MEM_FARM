import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { CalendarDays, CheckCircle2, Check, Circle, ExternalLink, Flame, Gift, Megaphone, Sparkles, Tv } from 'lucide-react';
import type { Reward } from '../types/quests';
import {
  selectCanCheckIn,
  selectDailyProgress,
  useGameStore,
} from '../store/useGameStore';
import { STREAK_DAYS } from '../data/quests';
import { SOCIAL_TASKS } from '../data/social';
import { AD_NETWORKS, adsgramBlockIds, isAdNetworkConfigured, monetagZoneIds, type AdNetwork, type AdNetworkId } from '../data/ads';
import { fetchSocialClaims, createAdView } from '../services/api';
import { showAdsgram, showGigapub, showMonetag, showRichAds } from '../lib/adSdks';
import { openTelegramLink } from '../telegram/telegram';
import { fmtGram, fmtHMS } from '../lib/format';
import { msUntilUtcMidnight } from '../lib/time';
import { fireClaimConfetti, firePop } from '../lib/confetti';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { ProgressBar } from '../components/ui/ProgressBar';
import { GramIcon } from '../components/icons/Icons';
import { useT } from '../i18n/useT';

function rewardChip(r: Reward | undefined): { icon: ReactNode; text: string } {
  switch (r?.kind) {
    case 'xp':
      return { icon: <Sparkles className="h-3 w-3" strokeWidth={3} />, text: `${r.amount} XP` };
    case 'gram':
      return { icon: <GramIcon className="h-3 w-3" />, text: fmtGram(r.amount, 3) };
    case 'case':
      return { icon: <Gift className="h-3 w-3" strokeWidth={3} />, text: '📦' };
    case 'buff':
      return { icon: <Flame className="h-3 w-3" strokeWidth={3} />, text: `+${r.amount}% / 24h` };
    default:
      return { icon: null, text: '' };
  }
}

export function QuestsScreen() {
  const t = useT();
  const streakDay = useGameStore((s) => s.streakDay);
  const quests = useGameStore((s) => s.quests);
  const canCheckIn = useGameStore(selectCanCheckIn);
  // useShallow: selectDailyProgress returns a fresh object — without shallow
  // equality Zustand v5 re-renders every frame → "Maximum update depth" crash.
  const progress = useGameStore(useShallow(selectDailyProgress));

  const tickDaily = useGameStore((s) => s.tickDaily);
  const claimDailyCheckIn = useGameStore((s) => s.claimDailyCheckIn);
  const claimQuestReward = useGameStore((s) => s.claimQuestReward);

  const [msLeft, setMsLeft] = useState(() => msUntilUtcMidnight());

  useEffect(() => {
    tickDaily();
    const id = window.setInterval(() => {
      setMsLeft(msUntilUtcMidnight());
      tickDaily();
    }, 1000);
    return () => window.clearInterval(id);
  }, [tickDaily]);

  const nextDay = canCheckIn ? (streakDay >= 7 ? 1 : streakDay + 1) : -1;

  const onCheckIn = () => {
    if (!canCheckIn) return;
    void claimDailyCheckIn();
    fireClaimConfetti();
    haptic.notify('success');
  };

  return (
    <div className="space-y-5">
      {/* ===== STREAK CALENDAR ===== */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-yellow border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />

        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              {t('quests.streakTitle')}
            </div>
            <div className="flex items-center gap-2 font-display text-3xl text-stroke dir-ltr">
              <Flame className="h-7 w-7 text-neon-pink" strokeWidth={2.5} />
              {streakDay} / 7
            </div>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-white/50">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={3} />
              {canCheckIn ? t('quests.checkin') : t('quests.next')}
            </div>
            <div className="font-display text-lg tabular-nums text-stroke-sm dir-ltr">
              {canCheckIn ? t('quests.now') : fmtHMS(msLeft)}
            </div>
          </div>
        </div>

        {/* 7-day grid */}
        <div className="relative mt-3 grid grid-cols-7 gap-1.5">
          {(STREAK_DAYS ?? []).map((d) => {
            const claimed = d.day <= streakDay;
            const current = d.day === nextDay;
            return (
              <div
                key={d.day}
                className={[
                  'flex flex-col items-center gap-0.5 rounded-xl border-2 border-black px-0.5 py-1.5 text-center',
                  d.isSuper ? 'bg-neon-yellow/20' : 'bg-farm-deep',
                  claimed ? 'opacity-60' : '',
                  current ? 'ring-2 ring-neon-lime' : '',
                ].join(' ')}
              >
                <span className="text-[9px] font-extrabold uppercase text-white/45">
                  {d.isSuper ? t('quests.superDay') : `D${d.day}`}
                </span>
                <span className="text-base leading-none">
                  {claimed ? '✅' : d.isSuper ? '🎁' : current ? '🎯' : '🔒'}
                </span>
                <span className="text-[8px] font-bold leading-tight text-neon-lime">
                  {rewardChip(d.rewards?.[0]).text}
                </span>
              </div>
            );
          })}
        </div>

        <div className="relative mt-3">
          <GameButton accent="yellow" block disabled={!canCheckIn} onClick={onCheckIn}>
            {canCheckIn ? t('quests.claimDaily') : t('quests.alreadyGot', { t: fmtHMS(msLeft) })}
          </GameButton>
        </div>
      </motion.div>

      {/* ===== DAILY QUESTS ===== */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="font-display text-lg text-stroke">{t('quests.dailyTasks')}</h2>
          <span className="text-xs font-bold text-white/45">
            {t('quests.doneCount', { done: progress.done, total: progress.total })}
          </span>
        </div>

        <ul className="space-y-2">
          {(quests ?? []).map((q, i) => {
            const ready = !q.claimed && q.progress >= q.goal;
            const chip = rewardChip(q.reward);
            return (
              <motion.li
                key={q.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 p-3 backdrop-blur-md"
              >
                <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
                <div className="relative flex items-center gap-3">
                  {q.claimed ? (
                    <CheckCircle2 className="h-5 w-5 flex-none text-neon-lime" strokeWidth={2.6} />
                  ) : ready ? (
                    <Sparkles className="h-5 w-5 flex-none animate-pulse text-neon-yellow" strokeWidth={2.6} />
                  ) : (
                    <Circle className="h-5 w-5 flex-none text-white/30" strokeWidth={2.6} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-bold ${q.claimed ? 'text-white/40 line-through' : ''}`}>
                      {t(`quests.q_${q.id}`)}{' '}
                      <span className="text-white/35">
                        ({Math.min(q.progress, q.goal)}/{q.goal})
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={q.progress / q.goal} accent="#84CC16" full={q.progress >= q.goal} />
                    </div>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <span className="inline-flex items-center gap-1 rounded-md border-2 border-black bg-farm-deep px-1.5 text-[10px] font-extrabold leading-5 text-neon-cyan">
                      {chip.icon}
                      {chip.text}
                    </span>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        haptic.notify('success');
                        firePop();
                        claimQuestReward(q.id);
                      }}
                      className={[
                        'rounded-lg border-2 border-b-4 border-black px-2 py-0.5 text-[10px] font-extrabold uppercase',
                        'border-b-black/40 active:translate-y-0.5 active:border-b-2 disabled:opacity-40',
                        q.claimed ? 'bg-farm-deep text-neon-lime' : 'bg-neon-lime text-black',
                      ].join(' ')}
                    >
                      {q.claimed ? t('quests.reward') : t('quests.claimReward')}
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>
      </section>

      <SocialTasks />
      <AdsBlock />
    </div>
  );
}

// ===== REWARDED VIDEO ADS (Adsgram / Monetag / GigaPub / RichAds) =====
// No daily cap. Watching only opens a PENDING ad_views row — the reward is
// credited exclusively by the network's own server-side postback once it
// confirms the view; if that postback never arrives, nothing is paid.

async function showNetworkAd(net: AdNetworkId, clickId: string): Promise<void> {
  switch (net) {
    case 'adsgram':
      return showAdsgram(adsgramBlockIds());
    case 'monetag':
      return showMonetag(monetagZoneIds(), clickId);
    case 'gigapub':
      return showGigapub(import.meta.env.VITE_GIGAPUB_PROJECT_ID as string);
    case 'richads':
      return showRichAds();
  }
}

function AdsBlock() {
  const t = useT();
  const mode = useGameStore((s) => s.mode);
  const hydrate = useGameStore((s) => s.hydrate);
  const [busy, setBusy] = useState<AdNetworkId | null>(null);
  const [note, setNote] = useState<{ id: AdNetworkId; ok: boolean; limit?: boolean } | null>(null);
  const [limited, setLimited] = useState<Set<AdNetworkId>>(new Set());

  const watch = async (net: AdNetwork) => {
    if (mode !== 'live' || busy || limited.has(net.id)) return;
    setBusy(net.id);
    setNote(null);
    try {
      const clickId = await createAdView(net.id);
      await showNetworkAd(net.id, clickId);
      haptic.notify('success');
      setNote({ id: net.id, ok: true });
      // best-effort: reflect the reward the moment the postback lands,
      // without waiting for the next natural navigation/hydrate
      window.setTimeout(() => void hydrate(), 4000);
    } catch (e) {
      haptic.notify('error');
      const isLimit = String((e as Error)?.message ?? '').toLowerCase().includes('daily ad limit');
      if (isLimit) setLimited((s) => new Set(s).add(net.id));
      setNote({ id: net.id, ok: false, limit: isLimit });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h2 className="mb-2 font-display text-lg text-stroke">{t('ads.title')}</h2>
      <div className="mb-2 text-[11px] text-white/45">{t('ads.hint')}</div>
      <ul className="space-y-2">
        {AD_NETWORKS.map((net) => {
          const ready = isAdNetworkConfigured(net.id);
          const disabled = !ready || mode !== 'live' || busy !== null || limited.has(net.id);
          return (
            <li
              key={net.id}
              className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 p-3 backdrop-blur-md"
            >
              <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
              <div className="relative flex items-center gap-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep">
                  <Tv className="h-4 w-4 text-neon-cyan" strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{net.name}</div>
                  <div className="inline-flex items-center gap-1 text-[11px] font-bold text-neon-lime dir-ltr">
                    <GramIcon className="h-3 w-3" />+{fmtGram(net.reward, 3)}
                  </div>
                  {!ready && <div className="text-[10px] text-white/35">{t('ads.comingSoon')}</div>}
                  {note?.id === net.id && (
                    <div className={`text-[10px] font-bold ${note.ok ? 'text-neon-lime' : 'text-neon-pink'}`}>
                      {note.ok ? t('ads.pending') : note.limit ? t('errors.adLimit') : t('ads.failed')}
                    </div>
                  )}
                </div>
                <GameButton
                  accent="cyan"
                  disabled={disabled}
                  className="flex-none text-[11px]"
                  onClick={() => watch(net)}
                >
                  {busy === net.id ? t('ads.loading') : t('ads.watch')}
                </GameButton>
              </div>
            </li>
          );
        })}
      </ul>
      {mode !== 'live' && <div className="mt-1.5 text-[10px] text-neon-pink">{t('social.onlineOnly')}</div>}
    </section>
  );
}

// ===== ONE-TIME CHANNEL-SUBSCRIPTION TASKS =====

function SocialTasks() {
  const t = useT();
  const mode = useGameStore((s) => s.mode);
  const claimSocialTask = useGameStore((s) => s.claimSocialTask);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'live') return;
    fetchSocialClaims().then(setClaimed).catch(() => {});
  }, [mode]);

  const doClaim = async (id: string) => {
    setBusy(id);
    const ok = await claimSocialTask(id);
    if (ok) {
      setClaimed((c) => [...c, id]);
      haptic.notify('success');
      firePop();
    }
    setBusy(null);
  };

  return (
    <section>
      <h2 className="mb-2 font-display text-lg text-stroke">{t('social.title')}</h2>
      <div className="mb-2 text-[11px] text-white/45">{t('social.hint')}</div>
      <ul className="space-y-2">
        {SOCIAL_TASKS.map((task) => {
          const done = claimed.includes(task.id);
          return (
            <li
              key={task.id}
              className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 p-3 backdrop-blur-md"
            >
              <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
              <div className="relative flex items-center gap-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep">
                  <Megaphone className="h-4 w-4 text-neon-violet" strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-bold ${done ? 'text-white/40' : ''}`}>
                    {task.title}
                  </div>
                  <div className="dir-ltr truncate text-[10px] text-white/35">{task.handle}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-neon-lime dir-ltr">
                    <GramIcon className="h-3 w-3" />+{fmtGram(task.reward, 2)}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <button
                    onClick={() => {
                      haptic.select();
                      openTelegramLink(task.url);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-lg border-2 border-b-4 border-black border-b-black/40 bg-farm-deep text-white/70 active:translate-y-0.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={3} />
                  </button>
                  <GameButton
                    accent={done ? 'lime' : 'yellow'}
                    disabled={done || busy === task.id || mode !== 'live'}
                    className="text-[11px]"
                    onClick={() => doClaim(task.id)}
                  >
                    {done ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        {t('social.claimed')}
                      </span>
                    ) : (
                      t('social.claim')
                    )}
                  </GameButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {mode !== 'live' && (
        <div className="mt-1.5 text-[10px] text-neon-pink">{t('social.onlineOnly')}</div>
      )}
    </section>
  );
}
