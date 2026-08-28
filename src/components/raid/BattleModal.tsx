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
import { useT } from '../../i18n/useT';

type Stage = 'vs' | 'result';
type TFn = (key: string, vars?: Record<string, string | number>) => string;

function rewardText(r: Reward, t: TFn): string {
  if (r.kind === 'xp') return t('battle.xpTop10', { n: r.amount });
  if (r.kind === 'gram') return `+${r.amount} GRAM`;
  return `+${r.amount}`;
}

export function BattleModal() {
  const t = useT();
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
                <Fighter emoji={MEME_EMOJI[userMeme]} label={t('battle.you')} power={battle.userPower} from={-40} />
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
                  {battle.won ? t('battle.victory') : t('battle.defeat')}
                </div>
                <div className="mt-1 text-xs font-bold text-white/50">
                  {t('battle.winChanceWas', { n: Math.round(battle.winChance * 100) })}
                </div>

                <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border-2 border-black bg-farm-deep px-3 py-1 font-display text-sm text-stroke-sm">
                  <Trophy className="h-4 w-4 text-neon-yellow" strokeWidth={3} />
                  <span className="dir-ltr">
                    {t('battle.ratingLine', {
                      delta: `${battle.ratingDelta >= 0 ? '+' : ''}${battle.ratingDelta}`,
                      total: battle.newRating,
                    })}
                  </span>
                </div>

                {/* pot breakdown */}
                <div className="mx-auto mt-3 w-full max-w-[240px] space-y-1 rounded-2xl border-2 border-black bg-farm-card/70 p-3 text-[11px] font-bold">
                  <div className="flex items-center justify-between">
                    <span className="text-white/45">{t('battle.pot')}</span>
                    <span className="dir-ltr text-white/80">{battle.pot.toFixed(2)} GRAM</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/45">{t('battle.commission')}</span>
                    <span className="dir-ltr text-neon-pink">−{battle.fee.toFixed(2)} GRAM</span>
                  </div>
                  <div className="flex items-center justify-between border-t-2 border-white/10 pt-1">
                    <span className="text-white/45">{t('battle.netWin')}</span>
                    <span className="dir-ltr text-neon-lime">
                      {battle.won ? `+${battle.payout.toFixed(2)}` : `−${battle.stake.toFixed(2)}`} GRAM
                    </span>
                  </div>
                </div>

                <ul className="mt-3 space-y-1 text-sm font-bold text-neon-lime">
                  {battle.rewards.map((r, i) => (
                    <li key={i}>{rewardText(r, t)}</li>
                  ))}
                </ul>

                <div className="mt-4">
                  <GameButton accent={battle.won ? 'lime' : 'cyan'} block onClick={dismiss}>
                    {battle.won ? t('common.take') : t('battle.rematch')}
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
