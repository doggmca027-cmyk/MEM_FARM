import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Dice5, Lock, Plus } from 'lucide-react';
import type { CardSlot, TierId, TierRow } from '../../types/game';
import { SLOT_RARITY, tierPool } from '../../data/tiers';
import { useGameStore } from '../../store/useGameStore';
import { MEME_EMOJI, RARITY_HEX } from '../../lib/meme';
import { fmtGram } from '../../lib/format';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';

const TIER_HEX: Record<TierId, string> = {
  1: '#84CC16',
  2: '#06B6D4',
  3: '#8B5CF6',
  4: '#EC4899',
  5: '#FACC15',
  6: '#F97316',
};

const TIER_ACCENT: Record<TierId, 'lime' | 'cyan' | 'violet' | 'pink' | 'yellow'> = {
  1: 'lime',
  2: 'cyan',
  3: 'violet',
  4: 'pink',
  5: 'yellow',
  6: 'yellow',
};

interface Props {
  row: TierRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenHat: (tier: TierId) => void;
  onRoll: (tier: TierId) => void;
}

export function TierSlotRow({ row, index, expanded, onToggle, onOpenHat, onRoll }: Props) {
  const balanceGram = useGameStore((s) => s.balanceGram);
  const hats = useGameStore((s) => s.hats);

  const hex = TIER_HEX[row.tier];
  const pool = tierPool(row.tier);
  const discovered = row.discovered.length;
  const equippedHat = hats.find((h) => h.equippedTierId === `tier-${row.tier}`) ?? null;
  const canRoll = balanceGram + 1e-9 >= row.costGram;

  const slotIncome = (slot: CardSlot) =>
    row.characters.filter((c) => c.cardSlot === slot).reduce((sum, c) => sum + c.currentIncome, 0);
  const slotCount = (slot: CardSlot) => row.characters.filter((c) => c.cardSlot === slot).length;

  return (
    <motion.div
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, type: 'spring', stiffness: 240, damping: 22 }}
      className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black bg-farm-card/80 backdrop-blur-md"
      style={{ borderColor: hex, borderBottomColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />

      {/* header — tap to collapse/expand */}
      <button
        type="button"
        onClick={onToggle}
        className="relative flex w-full items-center gap-2 p-3 text-left"
      >
        <motion.span animate={{ rotate: expanded ? 0 : -90 }} className="flex-none text-white/60">
          <ChevronDown className="h-4 w-4" strokeWidth={3} />
        </motion.span>

        <span
          className="flex-none rounded-lg border-2 border-black px-2 py-0.5 font-display text-xs uppercase leading-none text-black"
          style={{ backgroundColor: hex }}
        >
          Tier {row.tier}
        </span>

        {/* rarity dots */}
        <span className="flex flex-none items-center gap-1">
          {pool.map((c) => (
            <span
              key={c.slot}
              className="h-2 w-2 rounded-full border border-black"
              style={{
                backgroundColor: row.discovered.includes(c.slot) ? RARITY_HEX[c.rarity] : '#00000055',
              }}
            />
          ))}
        </span>

        <span className="ml-auto flex-none font-display text-sm text-stroke-sm">{discovered}/5</span>
        <span className="flex-none inline-flex items-center gap-1 rounded-lg border-2 border-black bg-farm-deep px-1.5 py-0.5 text-[11px] font-bold leading-none text-neon-cyan">
          <GramIcon className="h-3.5 w-3.5" />
          {fmtGram(row.costGram)}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative overflow-hidden"
          >
            <div className="flex items-stretch gap-2 px-3 pb-1">
              {/* hat / boost slot */}
              <button
                type="button"
                onClick={() => onOpenHat(row.tier)}
                className="flex w-14 flex-none flex-col items-center justify-center gap-1 rounded-2xl border-2 border-black bg-farm-deep py-2"
                style={equippedHat ? { boxShadow: `0 0 14px ${hex}, inset 0 0 0 2px ${hex}` } : undefined}
              >
                {equippedHat ? (
                  <>
                    <span className="text-xl leading-none">{equippedHat.emoji}</span>
                    <span className="rounded-md border border-black bg-neon-yellow px-1 text-[9px] font-extrabold leading-3 text-black">
                      +{equippedHat.bonusPct}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-dashed border-white/40 text-white/50">
                      <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="text-[9px] font-bold uppercase text-white/40">Boost</span>
                  </>
                )}
              </button>

              {/* the five tier cards */}
              <div className="flex flex-1 items-start gap-1.5 overflow-x-auto pb-1">
                {pool.map((card) => {
                  const owned = row.discovered.includes(card.slot);
                  const rHex = RARITY_HEX[SLOT_RARITY[card.slot]];
                  const n = slotCount(card.slot);
                  return (
                    <div key={card.slot} className="flex flex-none flex-col items-center gap-0.5">
                      <div
                        className="relative grid h-12 w-12 place-items-center rounded-xl border-2 border-black text-xl"
                        style={
                          owned
                            ? { borderColor: rHex, backgroundColor: '#1E1035', boxShadow: `0 0 10px ${rHex}88` }
                            : { backgroundColor: 'rgba(0,0,0,0.45)' }
                        }
                        title={owned ? card.name : `${card.name} · ${card.weight}%`}
                      >
                        {owned ? (
                          <span className="drop-shadow-[1px_2px_0_rgba(0,0,0,0.5)]">
                            {MEME_EMOJI[card.memeType]}
                          </span>
                        ) : (
                          <Lock className="h-4 w-4 text-white/30" strokeWidth={2.5} />
                        )}
                        {n > 1 && (
                          <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-black bg-neon-pink px-1 text-[8px] font-extrabold leading-3 text-white">
                            x{n}
                          </span>
                        )}
                      </div>
                      <span
                        className="text-[9px] font-bold leading-none"
                        style={{ color: owned ? '#84CC16' : 'rgba(255,255,255,0.3)' }}
                      >
                        {owned ? `+${fmtGram(slotIncome(card.slot), 3)}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-3 pb-3 pt-1">
              <GameButton
                accent={TIER_ACCENT[row.tier]}
                block
                disabled={!canRoll}
                onClick={() => onRoll(row.tier)}
                className="text-sm"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Dice5 className="h-4 w-4" strokeWidth={3} />
                  Крутити за {fmtGram(row.costGram)} GRAM
                </span>
              </GameButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
