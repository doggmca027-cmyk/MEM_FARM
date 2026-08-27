import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, CheckCircle2, Circle, Flame, Gift, Lock, Sparkles } from 'lucide-react';
import type { Reward } from '../types/quests';
import {
  selectCanCheckIn,
  selectDailyProgress,
  useGameStore,
} from '../store/useGameStore';
import { STREAK_DAYS } from '../data/quests';
import { fmtGram, fmtHMS } from '../lib/format';
import { msUntilUtcMidnight } from '../lib/time';
import { fireClaimConfetti, firePop } from '../lib/confetti';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { ProgressBar } from '../components/ui/ProgressBar';
import { GramIcon } from '../components/icons/Icons';

function rewardChip(r: Reward): { icon: ReactNode; text: string } {
  switch (r.kind) {
    case 'xp':
      return { icon: <Sparkles className="h-3 w-3" strokeWidth={3} />, text: `${r.amount} XP` };
    case 'gram':
      return { icon: <GramIcon className="h-3 w-3" />, text: fmtGram(r.amount, 3) };
    case 'tickets':
      return { icon: <span className="text-[10px]">⚡</span>, text: `×${r.amount}` };
    case 'fragments':
      return { icon: <span className="text-[10px]">◆</span>, text: `×${r.amount}` };
    case 'case':
      return { icon: <Gift className="h-3 w-3" strokeWidth={3} />, text: 'Кейс' };
    case 'buff':
      return { icon: <Flame className="h-3 w-3" strokeWidth={3} />, text: `+${r.amount}% / 24г` };
    default:
      return { icon: null, text: '' };
  }
}

export function QuestsScreen() {
  const streakDay = useGameStore((s) => s.streakDay);
  const quests = useGameStore((s) => s.quests);
  const fragments = useGameStore((s) => s.fragments);
  const dailyChestClaimed = useGameStore((s) => s.dailyChestClaimed);
  const canCheckIn = useGameStore(selectCanCheckIn);
  const progress = useGameStore(selectDailyProgress);

  const tickDaily = useGameStore((s) => s.tickDaily);
  const claimDailyCheckIn = useGameStore((s) => s.claimDailyCheckIn);
  const claimQuestReward = useGameStore((s) => s.claimQuestReward);
  const claimDailyChest = useGameStore((s) => s.claimDailyChest);

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
  const chestReady = progress.done === progress.total && progress.total > 0 && !dailyChestClaimed;

  const onCheckIn = () => {
    if (!canCheckIn) return;
    claimDailyCheckIn();
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
              Щоденний стрік
            </div>
            <div className="flex items-center gap-2 font-display text-3xl text-stroke">
              <Flame className="h-7 w-7 text-neon-pink" strokeWidth={2.5} />
              {streakDay} / 7
            </div>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-white/50">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={3} />
              {canCheckIn ? 'Чекін' : 'Наступний'}
            </div>
            <div className="font-display text-lg tabular-nums text-stroke-sm">
              {canCheckIn ? 'зараз' : fmtHMS(msLeft)}
            </div>
          </div>
        </div>

        {/* 7-day grid */}
        <div className="relative mt-3 grid grid-cols-7 gap-1.5">
          {STREAK_DAYS.map((d) => {
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
                  {d.isSuper ? 'СУПЕР' : `Д${d.day}`}
                </span>
                <span className="text-base leading-none">
                  {claimed ? '✅' : d.isSuper ? '🎁' : current ? '🎯' : '🔒'}
                </span>
                <span className="text-[8px] font-bold leading-tight text-neon-lime">
                  {rewardChip(d.rewards[0]).text}
                </span>
              </div>
            );
          })}
        </div>

        <div className="relative mt-3">
          <GameButton accent="yellow" block disabled={!canCheckIn} onClick={onCheckIn}>
            {canCheckIn ? 'Забрати щоденну нагороду' : `Вже отримано · ${fmtHMS(msLeft)}`}
          </GameButton>
        </div>
      </motion.div>

      {/* ===== DAILY QUESTS ===== */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="font-display text-lg text-stroke">Щоденні завдання</h2>
          <span className="text-xs font-bold text-white/45">
            {progress.done}/{progress.total} виконано · ◆ {fragments}
          </span>
        </div>

        <ul className="space-y-2">
          {quests.map((q, i) => {
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
                      {q.label}{' '}
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
                      {q.claimed ? 'Отримано' : 'Забрати'}
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>

        {/* bonus chest */}
        <div
          className={[
            'mt-3 flex items-center justify-between gap-3 rounded-3xl border-2 border-b-4 border-black border-b-black/50 p-3 backdrop-blur-md',
            chestReady ? 'border-neon-yellow bg-neon-yellow/10' : 'bg-farm-card/60',
          ].join(' ')}
        >
          <div className="flex items-center gap-2">
            {chestReady ? (
              <Gift className="h-7 w-7 text-neon-yellow" strokeWidth={2.5} />
            ) : (
              <Lock className="h-6 w-6 text-white/35" strokeWidth={2.5} />
            )}
            <div>
              <div className="font-display text-sm text-stroke-sm">Бонусний сундук</div>
              <div className="text-[10px] text-white/45">За всі завдання дня</div>
            </div>
          </div>
          <GameButton
            accent="yellow"
            disabled={!chestReady}
            onClick={() => {
              haptic.notify('success');
              firePop();
              claimDailyChest();
            }}
          >
            {dailyChestClaimed ? 'Відкрито' : 'Відкрити'}
          </GameButton>
        </div>
      </section>
    </div>
  );
}
