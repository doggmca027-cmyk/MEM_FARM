import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Flame, Layers, Skull, Sparkles, Zap } from 'lucide-react';
import { flattenCharacters, mergeFee, useGameStore } from '../../store/useGameStore';
import { MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram, formatNum } from '../../lib/format';
import { fireJackpot, firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';
import { useT } from '../../i18n/useT';

interface Props {
  open: boolean;
  onClose: () => void;
  name: string | null;
  level: number;
}

type Phase = 'ready' | 'crafting' | 'result';
const CRAFT_MS = 2000;

export function MergeModal({ open, onClose, name, level }: Props) {
  const t = useT();
  const tiers = useGameStore((s) => s.tiers);
  const balanceGram = useGameStore((s) => s.balanceGram);
  const mergeCharacters = useGameStore((s) => s.mergeCharacters);
  const mergeResult = useGameStore((s) => s.mergeResult);
  const dismissMergeResult = useGameStore((s) => s.dismissMergeResult);

  const sample = useMemo(
    () => flattenCharacters(tiers).find((c) => c.name === name && c.level === level) ?? null,
    [tiers, name, level],
  );

  const [phase, setPhase] = useState<Phase>('ready');

  useEffect(() => {
    if (open) {
      setPhase('ready');
      dismissMergeResult();
    }
  }, [open, name, level, dismissMergeResult]);

  // outcome landed → reveal it
  useEffect(() => {
    if (phase !== 'crafting' || !mergeResult) return;
    setPhase('result');
    if (mergeResult.status === 'FAIL') {
      haptic.notify('error');
    } else if (mergeResult.delta >= 2) {
      haptic.notify('success');
      fireJackpot();
    } else {
      haptic.notify('success');
      firePop();
    }
  }, [phase, mergeResult]);

  const display = mergeResult
    ? {
        name: mergeResult.name,
        memeType: mergeResult.memeType,
        rarity: mergeResult.rarity,
        tier: mergeResult.tier,
      }
    : sample;

  if (!display) {
    return (
      <Modal open={open} onClose={onClose} title={t('merge.merge')} accent="#A855F7">
        <div />
      </Modal>
    );
  }

  const hex = RARITY_HEX[display.rarity];
  const fee = mergeFee(display.tier);
  const canAfford = balanceGram + 1e-9 >= fee;

  const close = () => {
    dismissMergeResult();
    onClose();
  };

  const run = () => {
    if (!canAfford || phase !== 'ready' || !sample) return;
    setPhase('crafting');
    haptic.impact('heavy');
    window.setTimeout(() => mergeCharacters(sample.name, level), CRAFT_MS);
  };

  const isCrit = phase === 'result' && mergeResult && mergeResult.delta >= 2;
  const isFail = phase === 'result' && mergeResult?.status === 'FAIL';
  const glow = isCrit ? '#FACC15' : hex;

  return (
    <Modal
      open={open}
      onClose={close}
      accent="#A855F7"
      title={
        <span className="inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-neon-purple" strokeWidth={2.5} />
          {t('merge.title', { name: display.name })}
        </span>
      }
    >
      {/* ============ STAGE ============ */}
      <div className="relative grid min-h-[176px] place-items-center overflow-hidden py-2">
        {/* result flash */}
        {phase === 'result' && (
          <motion.div
            key={`flash-${mergeResult?.roll}`}
            className="pointer-events-none absolute inset-0 -m-8"
            initial={{ opacity: 0.85, scale: 0.4 }}
            animate={{ opacity: [0.85, 0.15, 0], scale: 1.6 }}
            transition={{ duration: 0.9 }}
            style={{
              background: `radial-gradient(circle, ${isFail ? '#EC4899' : glow}, transparent 65%)`,
            }}
          />
        )}

        <AnimatePresence mode="wait">
          {phase !== 'result' ? (
            <motion.div key="pair" className="relative flex items-center gap-5" exit={{ opacity: 0 }}>
              {[-1, 1].map((dir) => (
                <motion.div
                  key={dir}
                  initial={{ x: dir * 60, opacity: 0 }}
                  animate={
                    phase === 'crafting'
                      ? {
                          x: dir * 6,
                          opacity: 1,
                          scale: [1, 1.08, 0.94, 1],
                          rotate: [0, dir * -5, dir * 5, 0],
                        }
                      : { x: dir * 6, opacity: 1, rotate: dir * 5 }
                  }
                  transition={
                    phase === 'crafting'
                      ? { duration: 0.45, repeat: Infinity, ease: 'easeInOut' }
                      : { type: 'spring', stiffness: 200, damping: 18 }
                  }
                  className="relative grid h-20 w-20 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl"
                  style={{ borderColor: hex, boxShadow: `0 0 14px ${hex}88` }}
                >
                  {MEME_EMOJI[display.memeType]}
                  <span className="absolute -bottom-2 rounded-md border-2 border-black bg-farm-card px-1 text-[9px] font-extrabold text-white dir-ltr">
                    Lv.{level}
                  </span>
                </motion.div>
              ))}
              {phase === 'crafting' && (
                <>
                  <motion.div
                    className="pointer-events-none absolute inset-0 -m-12"
                    animate={{ opacity: [0.15, 0.6, 0.15], scale: [0.9, 1.25, 0.9] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    style={{ background: `radial-gradient(circle, ${hex}, transparent 60%)` }}
                  />
                  <motion.span
                    className="absolute -bottom-6 font-display text-sm uppercase tracking-widest text-neon-purple"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    {t('merge.crafting')}
                  </motion.span>
                </>
              )}
            </motion.div>
          ) : isFail ? (
            <motion.div key="fail" className="relative flex flex-col items-center">
              <motion.div
                initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                animate={{ opacity: 0, y: -34, scale: 1.1, filter: 'blur(10px)' }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="grid h-20 w-20 place-items-center rounded-2xl border-2 border-neon-pink bg-farm-deep text-3xl"
              >
                {MEME_EMOJI[display.memeType]}
              </motion.div>
              <Skull className="absolute top-3 h-10 w-10 text-neon-pink" strokeWidth={2.5} />
            </motion.div>
          ) : (
            <motion.div
              key="win"
              initial={{ scale: 0.5, opacity: 0, rotateY: 150 }}
              animate={{ scale: 1, opacity: 1, rotateY: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
              className="relative grid h-24 w-24 place-items-center rounded-3xl border-2 border-black bg-farm-deep text-4xl"
              style={{ borderColor: glow, boxShadow: `0 0 36px ${glow}` }}
            >
              {MEME_EMOJI[display.memeType]}
              <span
                className="absolute -bottom-2 rounded-md border-2 border-black px-1.5 text-[10px] font-extrabold text-white dir-ltr"
                style={{ backgroundColor: isCrit ? '#FACC15' : '#A855F7', color: isCrit ? '#000' : '#fff' }}
              >
                Lv.{mergeResult?.newLevel}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============ READY / CRAFTING ============ */}
      {phase !== 'result' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border-2 border-black bg-neon-lime/15 py-2 text-center">
              <div className="font-display text-xl text-neon-lime text-stroke-sm">70%</div>
              <div className="text-[9px] font-extrabold uppercase text-white/50">{t('merge.win')}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-neon-pink/15 py-2 text-center">
              <div className="inline-flex items-center gap-1 font-display text-xl text-neon-pink text-stroke-sm">
                <Flame className="h-4 w-4" strokeWidth={3} />
                30%
              </div>
              <div className="text-[9px] font-extrabold uppercase text-white/50">{t('merge.burnRisk')}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] font-bold text-white/50">
            <span>+1 · 55%</span>
            <span className="text-neon-cyan">
              <Zap className="mr-0.5 inline h-3 w-3" strokeWidth={3} />+2 · 10%
            </span>
            <span className="text-neon-yellow">🔥 +3 · 4%</span>
            <span className="text-neon-yellow">👑 +4 · 1%</span>
          </div>
        </>
      )}

      {/* ============ RESULT ============ */}
      {phase === 'result' && mergeResult && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {isFail ? (
            <div className="text-center">
              <div className="font-display text-2xl text-neon-pink text-stroke">💥 {t('merge.cardBurned')}</div>
              <div className="mt-1 text-xs font-bold text-white/50">
                {t('merge.materialLost', { n: mergeResult.fromLevel })}
              </div>
            </div>
          ) : (
            <>
              <div className="text-center">
                {isCrit ? (
                  <motion.div
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ repeat: 3, duration: 0.35 }}
                    className="font-display text-xl text-neon-yellow text-stroke"
                  >
                    <Sparkles className="mr-1 inline h-5 w-5" strokeWidth={3} />
                    {t('merge.criticalUpgrade', { n: mergeResult.delta })}
                  </motion.div>
                ) : (
                  <div className="font-display text-xl text-neon-lime text-stroke dir-ltr">
                    {t('merge.levelUp', { from: mergeResult.fromLevel, to: mergeResult.newLevel })}
                  </div>
                )}
              </div>
              <div className="mt-3 rounded-2xl border-2 border-black bg-farm-card/70 p-3">
                <Row
                  label={t('merge.income')}
                  from={`${fmtGram(mergeResult.incomeBefore, 3)} /d`}
                  to={`${fmtGram(mergeResult.incomeAfter, 3)} /d`}
                />
                <Row
                  label={t('merge.powerStat')}
                  from={formatNum(mergeResult.powerBefore)}
                  to={formatNum(mergeResult.powerAfter)}
                />
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* ============ FOOTER ============ */}
      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-xs font-bold text-white/60">
          {t('merge.fee')}
          <span className={canAfford ? 'text-neon-yellow' : 'text-neon-pink'}>
            <GramIcon className="mb-0.5 mr-0.5 inline h-3.5 w-3.5" />
            <span className="dir-ltr">{fmtGram(fee)}</span>
          </span>
        </div>
        {phase === 'result' ? (
          <GameButton accent={isFail ? 'pink' : 'lime'} onClick={close}>
            {isFail ? t('common.close') : t('common.take')}
          </GameButton>
        ) : (
          <GameButton
            accent="violet"
            disabled={!canAfford || phase === 'crafting' || !sample}
            onClick={run}
          >
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" strokeWidth={3} />
              {phase === 'crafting' ? t('merge.crafting') : t('merge.merge')}
            </span>
          </GameButton>
        )}
      </div>

      <div className="mt-2 text-center text-[10px] uppercase tracking-wide text-white/35">
        {RARITY_LABEL[display.rarity]} · {t('merge.tier', { n: display.tier })}
        {phase === 'result' && mergeResult ? ` · roll ${mergeResult.roll}` : ''}
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
