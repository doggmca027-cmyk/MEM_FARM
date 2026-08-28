import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Swords, Trophy, X, Zap } from 'lucide-react';
import { flattenCharacters, useGameStore } from '../../store/useGameStore';
import type { Reward } from '../../types/quests';
import { MEME_EMOJI } from '../../lib/meme';
import { formatNum } from '../../lib/format';
import { fireClaimConfetti, fireJackpot, firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { GameButton } from '../ui/GameButton';

type Stage = 'vs' | 'result';

function rewardText(r: Reward): string {
  if (r.kind === 'xp') return `+${r.amount} XP`;
  if (r.kind === 'gram') return `+${r.amount} GRAM`;
  if (r.kind === 'tickets') return `+${r.amount} ⚡`;
  return `+${r.amount}`;
}

export function BattleModal() {
  const battle = useGameStore((s) => s.battle);
  const dismiss = useGameStore((s) => s.dismissBattle);
  const userMeme = useGameStore((s) => {
    const top = [...flattenCharacters(s.tiers)].sort((a, b) => b.power - a.power)[0];
    return top?.memeType ?? 'gigachad';
  });

  const [stage, setStage] = useState<Stage>('vs');

  useEffect(() => {
    if (!battle) return;
    setStage('vs');
    haptic.impact('heavy');
    const id = window.setTimeout(() => {
      setStage('result');
      if (battle.won) {
        haptic.notify('success');
        if (battle.winChance < 0.4) fireJackpot();
        else fireClaimConfetti();
      } else {
        haptic.notify('error');
        firePop();
      }
    }, 1100);
    return () => window.clearTimeout(id);
  }, [battle]);

  return (
    <AnimatePresence>
      {battle && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button aria-label="Close" onClick={dismiss} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
            animate={stage === 'vs' ? { x: [0, -9, 8, -6, 5, 0] } : {}}
            transition={{ duration: 0.5, repeat: 1 }}
            className="relative z-10 w-full max-w-[320px] overflow-hidden rounded-4xl border-2 border-b-4 border-black border-b-black/60 bg-farm-bg p-5"
          >
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />

            {stage === 'vs' ? (
              <div className="relative flex items-center justify-between">
                <Fighter emoji={MEME_EMOJI[userMeme]} label="ТИ" power={battle.userPower} from={-40} />
                <motion.div
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: [0, 1.4, 1], rotate: 0 }}
                  transition={{ duration: 0.5 }}
                  className="font-display text-3xl text-neon-pink text-stroke"
                >
                  <Swords className="h-9 w-9" strokeWidth={3} />
                </motion.div>
                <Fighter
                  emoji={MEME_EMOJI[battle.opponent.memeType]}
                  label={battle.opponent.name}
                  power={battle.opponent.power}
                  from={40}
                />
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative text-center"
              >
                <button
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-lg border-2 border-black bg-farm-card text-white/60"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={3} />
                </button>

                <div
                  className={`font-display text-3xl text-stroke ${
                    battle.won ? 'text-neon-lime' : 'text-neon-pink'
                  }`}
                >
                  {battle.won ? 'ПЕРЕМОГА' : 'ПОРАЗКА'}
                </div>
                <div className="mt-1 text-xs font-bold text-white/50">
                  Шанс перемоги був {Math.round(battle.winChance * 100)}%
                </div>

                <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border-2 border-black bg-farm-deep px-3 py-1 font-display text-sm text-stroke-sm">
                  <Trophy className="h-4 w-4 text-neon-yellow" strokeWidth={3} />
                  {battle.ratingDelta >= 0 ? '+' : ''}
                  {battle.ratingDelta} рейтингу · {battle.newRating}
                </div>

                <ul className="mt-3 space-y-1 text-sm font-bold text-neon-lime">
                  {battle.rewards.map((r, i) => (
                    <li key={i}>{rewardText(r)}</li>
                  ))}
                </ul>

                <div className="mt-4">
                  <GameButton accent={battle.won ? 'lime' : 'cyan'} block onClick={dismiss}>
                    {battle.won ? 'Забрати' : 'Реванш'}
                  </GameButton>
                </div>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Fighter({
  emoji,
  label,
  power,
  from,
}: {
  emoji: string;
  label: string;
  power: number;
  from: number;
}) {
  return (
    <motion.div
      initial={{ x: from, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 16 }}
      className="flex flex-col items-center gap-1"
    >
      <span className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl">
        {emoji}
      </span>
      <span className="max-w-[72px] truncate text-[10px] font-extrabold uppercase">{label}</span>
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-neon-cyan">
        <Zap className="h-3 w-3" strokeWidth={3} />
        {formatNum(power)}
      </span>
    </motion.div>
  );
}
