import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Layers, Sparkles } from 'lucide-react';
import { flattenCharacters, mergeFee, mergedIncome, useGameStore } from '../../store/useGameStore';
import { MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram } from '../../lib/format';
import { fireJackpot, firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  name: string | null;
  level: number;
}

type Phase = 'ready' | 'playing' | 'result';

export function MergeModal({ open, onClose, name, level }: Props) {
  const tiers = useGameStore((s) => s.tiers);
  const balanceGram = useGameStore((s) => s.balanceGram);
  const mergeCharacters = useGameStore((s) => s.mergeCharacters);

  const sample = useMemo(
    () => flattenCharacters(tiers).find((c) => c.name === name && c.level === level) ?? null,
    [tiers, name, level],
  );

  const [phase, setPhase] = useState<Phase>('ready');

  useEffect(() => {
    if (open) setPhase('ready');
  }, [open, name, level]);

  if (!sample) return <Modal open={open} onClose={onClose} title="Злиття" accent="#A855F7"><div /></Modal>;

  const hex = RARITY_HEX[sample.rarity];
  const fee = mergeFee(sample.tier);
  const canAfford = balanceGram + 1e-9 >= fee;
  const afterIncome = mergedIncome(sample.baseIncome, level + 1);
  const afterPower = Math.round(sample.power * 1.75);

  const run = () => {
    if (!canAfford || phase !== 'ready') return;
    setPhase('playing');
    haptic.impact('heavy');
    window.setTimeout(() => {
      mergeCharacters(sample.name, level);
      firePop();
      window.setTimeout(fireJackpot, 120);
      haptic.notify('success');
      setPhase('result');
    }, 850);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#A855F7"
      title={
        <span className="inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-neon-purple" strokeWidth={2.5} />
          Злиття · {sample.name}
        </span>
      }
    >
      <div className="relative grid min-h-[160px] place-items-center py-2">
        <AnimatePresence mode="wait">
          {phase !== 'result' ? (
            <motion.div key="pair" className="relative flex items-center gap-6" exit={{ opacity: 0 }}>
              {[-1, 1].map((dir) => (
                <motion.div
                  key={dir}
                  initial={{ x: dir * 70, rotate: dir * 8, opacity: 0 }}
                  animate={
                    phase === 'playing'
                      ? { x: 0, rotate: 0, opacity: 1, scale: 0.9 }
                      : { x: dir * 8, rotate: dir * 6, opacity: 1 }
                  }
                  transition={{ type: 'spring', stiffness: 200, damping: 18 }}
                  className="grid h-20 w-20 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl"
                  style={{ borderColor: hex, boxShadow: `0 0 14px ${hex}88` }}
                >
                  {MEME_EMOJI[sample.memeType]}
                  <span className="absolute -bottom-2 rounded-md border-2 border-black bg-farm-card px-1 text-[9px] font-extrabold text-white">
                    Lv.{level}
                  </span>
                </motion.div>
              ))}
              {phase === 'playing' && (
                <motion.div
                  className="pointer-events-none absolute inset-0 -m-10"
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 0.9, 0], scale: 1.6 }}
                  transition={{ duration: 0.85 }}
                  style={{ background: `radial-gradient(circle, ${hex}, transparent 65%)` }}
                />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ scale: 0.5, opacity: 0, rotateY: 140 }}
              animate={{ scale: 1, opacity: 1, rotateY: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="grid h-24 w-24 place-items-center rounded-3xl border-2 border-black bg-farm-deep text-4xl"
              style={{ borderColor: hex, boxShadow: `0 0 34px ${hex}` }}
            >
              {MEME_EMOJI[sample.memeType]}
              <span className="absolute -bottom-2 rounded-md border-2 border-black bg-neon-purple px-1.5 text-[10px] font-extrabold text-white">
                Lv.{level + 1}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* before -> after */}
      <div className="rounded-2xl border-2 border-black bg-farm-card/70 p-3">
        <Row
          label="Рівень"
          from={`Lv.${level} ×2`}
          to={`Lv.${level + 1}`}
        />
        <Row
          label="Дохід"
          from={`${fmtGram(sample.currentIncome, 3)} /d`}
          to={`${fmtGram(afterIncome, 3)} /d`}
        />
        <Row label="Сила" from={String(sample.power)} to={String(afterPower)} />
        <div className="mt-1 text-[10px] text-white/40">
          Формула: base × 1.75^(рівень−1)
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-xs font-bold text-white/60">
          Комісія:
          <span className={canAfford ? 'text-neon-yellow' : 'text-neon-pink'}>
            <GramIcon className="mb-0.5 mr-0.5 inline h-3.5 w-3.5" />
            {fmtGram(fee)}
          </span>
        </div>
        {phase === 'result' ? (
          <GameButton accent="lime" onClick={onClose}>
            Забрати
          </GameButton>
        ) : (
          <GameButton accent="violet" disabled={!canAfford || phase === 'playing'} onClick={run}>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" strokeWidth={3} />
              Злити
            </span>
          </GameButton>
        )}
      </div>

      <div className="mt-2 text-center text-[10px] uppercase tracking-wide text-white/35">
        {RARITY_LABEL[sample.rarity]} · Tier {sample.tier}
      </div>
    </Modal>
  );
}

function Row({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="font-bold text-white/45">{label}</span>
      <span className="flex items-center gap-1.5 font-display text-stroke-sm">
        <span className="text-white/60">{from}</span>
        <ArrowRight className="h-3.5 w-3.5 text-neon-lime" strokeWidth={3} />
        <span className="text-neon-lime">{to}</span>
      </span>
    </div>
  );
}
