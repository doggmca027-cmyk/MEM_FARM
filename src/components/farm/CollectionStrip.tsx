import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { groupCollection, useGameStore } from '../../store/useGameStore';
import { characterArtPrompt, MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram } from '../../lib/format';
import { useT } from '../../i18n/useT';

export function CollectionStrip() {
  const t = useT();
  const tiers = useGameStore((s) => s.tiers);
  const groups = useMemo(() => groupCollection(tiers), [tiers]);

  if (groups.length === 0) {
    return (
      <section>
        <h2 className="mb-2 font-display text-lg text-stroke">{t('collection.title')}</h2>
        <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 py-8 text-center">
          <div className="text-4xl">🫙</div>
          <div className="mt-1 text-xs text-white/45">{t('collection.emptyHint')}</div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-end justify-between">
        <h2 className="font-display text-lg text-stroke">{t('collection.title')}</h2>
        <span className="text-xs font-bold text-white/40">{t('collection.uniques', { n: groups.length })}</span>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
        {groups.map((g, i) => {
          const hex = RARITY_HEX[g.sample.rarity];
          return (
            <motion.div
              key={g.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
              title={characterArtPrompt(g.sample.name, g.sample.memeType, g.sample.rarity)}
              className="relative w-28 flex-none overflow-hidden rounded-3xl border-2 border-b-4 border-black bg-farm-card/80 p-2.5 backdrop-blur-md"
              style={{ borderColor: hex, borderBottomColor: 'rgba(0,0,0,0.5)' }}
            >
              <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />

              <div className="relative flex items-center justify-between">
                <span
                  className="rounded-md border-2 border-black px-1 text-[9px] font-extrabold uppercase leading-4 text-black"
                  style={{ backgroundColor: hex }}
                >
                  {RARITY_LABEL[g.sample.rarity].slice(0, 4)}
                </span>
                <span className="rounded-md border-2 border-black bg-farm-deep px-1 text-[9px] font-extrabold leading-4 text-white/80">
                  x{g.count}
                </span>
              </div>

              <div className="relative mx-auto my-1.5 grid h-14 w-14 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl">
                <span className="animate-floaty drop-shadow-[1px_2px_0_rgba(0,0,0,0.5)]">
                  {MEME_EMOJI[g.sample.memeType]}
                </span>
              </div>

              <div className="relative text-center">
                <div className="truncate font-display text-xs leading-tight text-stroke-sm">
                  {g.sample.name}
                </div>
                <div className="text-[10px] font-bold text-neon-lime dir-ltr">
                  +{fmtGram(g.sample.currentIncome, 3)}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
