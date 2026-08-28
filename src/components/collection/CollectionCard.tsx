import { motion } from 'framer-motion';
import { GraduationCap, Layers, Zap } from 'lucide-react';
import type { CollectionGroup } from '../../store/useGameStore';
import { characterArtPrompt, MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram, formatNum } from '../../lib/format';
import { GramIcon } from '../icons/Icons';
import { useT } from '../../i18n/useT';

interface Props {
  group: CollectionGroup;
  index: number;
  onStudy: (characterId: string) => void;
  onMerge: (name: string, level: number) => void;
}

export function CollectionCard({ group, index, onStudy, onMerge }: Props) {
  const t = useT();
  const c = group.sample;
  const hex = RARITY_HEX[c.rarity];
  const canMerge = group.mergeableLevel > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.03, type: 'spring', stiffness: 260, damping: 20 }}
      title={characterArtPrompt(c.name, c.memeType, c.rarity)}
      className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black bg-farm-card/80 p-3 backdrop-blur-md"
      style={{ borderColor: hex, borderBottomColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />

      <div className="relative flex items-center justify-between">
        <span
          className="rounded-md border-2 border-black px-1 text-[9px] font-extrabold uppercase leading-4 text-black"
          style={{ backgroundColor: hex }}
        >
          {RARITY_LABEL[c.rarity]}
        </span>
        <span className="rounded-md border-2 border-black bg-farm-deep px-1 text-[9px] font-extrabold leading-4 text-white/80">
          x{group.count}
        </span>
      </div>

      {/* art */}
      <div className="relative mx-auto my-2 grid h-16 w-16 place-items-center">
        <div
          className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl"
          style={{ boxShadow: `0 0 14px ${hex}99` }}
        >
          <span className="animate-floaty drop-shadow-[1px_2px_0_rgba(0,0,0,0.5)]">
            {MEME_EMOJI[c.memeType]}
          </span>
        </div>
        <span className="absolute -bottom-1.5 rounded-md border-2 border-black bg-neon-yellow px-1 text-[9px] font-extrabold leading-4 text-black dir-ltr">
          Lv. {c.level}
        </span>
      </div>

      <div className="relative text-center">
        <div className="truncate font-display text-sm leading-tight text-stroke-sm">{c.name}</div>
        <div className="mt-0.5 flex items-center justify-center gap-2 text-[10px] font-bold dir-ltr">
          <span className="inline-flex items-center gap-0.5 text-neon-lime">
            <GramIcon className="h-3 w-3" />+{fmtGram(c.currentIncome, 3)}
          </span>
          <span className="inline-flex items-center gap-0.5 text-neon-cyan">
            <Zap className="h-3 w-3" strokeWidth={3} />
            {formatNum(c.power)}
          </span>
        </div>
      </div>

      {/* actions */}
      <div className="relative mt-2 flex gap-1.5">
        <button
          onClick={() => onStudy(c.id)}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl border-2 border-b-4 border-black border-b-black/40 bg-neon-cyan py-1 text-[10px] font-extrabold uppercase text-black active:translate-y-0.5 active:border-b-2"
        >
          <GraduationCap className="h-3.5 w-3.5" strokeWidth={3} />
          {t('farm.study')}
        </button>
        {canMerge && (
          <button
            onClick={() => onMerge(group.key, group.mergeableLevel)}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl border-2 border-b-4 border-black border-b-black/40 bg-neon-purple py-1 text-[10px] font-extrabold uppercase text-white active:translate-y-0.5 active:border-b-2"
          >
            <Layers className="h-3.5 w-3.5" strokeWidth={3} />
            {t('merge.merge')}
          </button>
        )}
      </div>
    </motion.div>
  );
}
