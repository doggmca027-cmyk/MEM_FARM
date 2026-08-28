import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Star } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram } from '../../lib/format';
import { fireJackpot, firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';
import { useT } from '../../i18n/useT';

export function GachaRevealModal() {
  const t = useT();
  const reveal = useGameStore((s) => s.reveal);
  const dismiss = useGameStore((s) => s.dismissReveal);

  useEffect(() => {
    if (!reveal) return;
    haptic.notify('success');
    if (reveal.jackpot) {
      fireJackpot();
      window.setTimeout(() => haptic.impact('heavy'), 120);
    } else {
      firePop();
    }
  }, [reveal]);

  const rHex = reveal ? RARITY_HEX[reveal.card.rarity] : '#94A3B8';
  const jackpot = reveal?.jackpot ?? false;

  return (
    <AnimatePresence>
      {reveal && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          {/* rarity flash */}
          <motion.div
            key={`flash-${reveal.character.id}`}
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 45%, ${rHex}, transparent 60%)` }}
            initial={{ opacity: 0.9, scale: 0.4 }}
            animate={{ opacity: [0.9, 0.25, 0.4], scale: 1.4 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />

          {/* card — flips in; jackpot also shakes */}
          <motion.div
            key={`card-${reveal.character.id}`}
            initial={{ rotateY: 180, scale: 0.6, opacity: 0, y: 24 }}
            animate={
              jackpot
                ? { rotateY: 0, scale: 1, opacity: 1, y: 0, x: [0, -10, 9, -7, 6, 0] }
                : { rotateY: 0, scale: 1, opacity: 1, y: 0 }
            }
            transition={{ type: 'spring', stiffness: 200, damping: 16, x: { duration: 0.5, delay: 0.25 } }}
            style={{ borderColor: rHex, boxShadow: `0 0 40px ${rHex}${jackpot ? 'cc' : '88'}` }}
            className="relative z-10 w-full max-w-[300px] rounded-4xl border-2 border-b-4 border-b-black/60 bg-farm-bg p-5 text-center"
          >
            <div className="pointer-events-none absolute inset-0 rounded-4xl bg-stripes opacity-40" />

            <div
              className="relative mx-auto mb-1 inline-flex items-center gap-1 rounded-full border-2 border-black px-2.5 py-0.5 text-[11px] font-extrabold uppercase leading-none text-black"
              style={{ backgroundColor: rHex }}
            >
              {jackpot ? <Star className="h-3 w-3" strokeWidth={3} /> : <Sparkles className="h-3 w-3" strokeWidth={3} />}
              {jackpot ? t('reveal.jackpot') : RARITY_LABEL[reveal.card.rarity]}
            </div>

            <div className="relative my-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
              {t('reveal.tierChance', { tier: reveal.tier, chance: reveal.card.weight })}
              {reveal.isNewDiscovery ? t('reveal.newCard') : ''}
            </div>

            <motion.div
              className="relative mx-auto grid h-28 w-28 place-items-center rounded-3xl border-2 border-black bg-farm-deep text-6xl"
              style={{ borderColor: rHex }}
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            >
              <span className="drop-shadow-[2px_3px_0_rgba(0,0,0,0.55)]">
                {MEME_EMOJI[reveal.character.memeType]}
              </span>
            </motion.div>

            <div className="relative mt-3 font-display text-2xl text-stroke">{reveal.character.name}</div>

            <div className="relative mt-1 inline-flex items-center gap-1.5 rounded-full border-2 border-black bg-neon-lime px-3 py-0.5 font-display text-sm text-black text-stroke-sm">
              <GramIcon className="h-4 w-4" />
              <span className="dir-ltr">
                {t('reveal.perDay', { n: fmtGram(reveal.character.currentIncome, 3) })}
              </span>
            </div>

            <div className="relative mt-4">
              <GameButton accent="yellow" block onClick={dismiss}>
                {t('reveal.takeToFarm')}
              </GameButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
