import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { TierId } from '../../types/game';
import { useGameStore } from '../../store/useGameStore';
import { hatArtPrompt, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';

const TIERS: TierId[] = [1, 2, 3, 4, 5, 6];

export function HatInventory() {
  const hats = useGameStore((s) => s.hats);
  const equipHat = useGameStore((s) => s.equipHat);

  const equip = (tier: TierId, hatId: string | null) => {
    equipHat(tier, hatId);
    haptic.notify('success');
    if (hatId) firePop();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/45">
        Шапка додає буст до доходу всього тіру. Один слот на тір.
      </p>

      {hats.map((hat, i) => {
        const equippedTier = hat.equippedTierId
          ? (Number(hat.equippedTierId.replace('tier-', '')) as TierId)
          : null;
        return (
          <motion.div
            key={hat.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            title={hatArtPrompt(hat.name)}
            className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black bg-farm-card/80 p-3 backdrop-blur-md"
            style={{ borderColor: RARITY_HEX[hat.rarity], borderBottomColor: 'rgba(0,0,0,0.5)' }}
          >
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />

            <div className="relative flex items-center gap-3">
              <span
                className="grid h-12 w-12 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep text-2xl"
                style={{ boxShadow: `inset 0 0 0 2px ${RARITY_HEX[hat.rarity]}` }}
              >
                {hat.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm text-stroke-sm">{hat.name}</div>
                <div className="text-[10px] font-bold uppercase text-white/45">
                  {RARITY_LABEL[hat.rarity]} ·{' '}
                  <span className="text-neon-yellow">+{hat.bonusPct}% дохід</span>
                </div>
              </div>
              {equippedTier && (
                <button
                  onClick={() => equip(equippedTier, null)}
                  className="grid h-7 w-7 flex-none place-items-center rounded-lg border-2 border-black bg-farm-deep text-neon-pink active:translate-y-0.5"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
              )}
            </div>

            <div className="relative mt-2.5 grid grid-cols-6 gap-1.5">
              {TIERS.map((tier) => {
                const on = equippedTier === tier;
                return (
                  <button
                    key={tier}
                    onClick={() => equip(tier, on ? null : hat.id)}
                    className={[
                      'rounded-lg border-2 border-b-4 border-black py-1 text-[11px] font-extrabold active:translate-y-0.5 active:border-b-2',
                      on
                        ? 'border-b-black/40 bg-neon-lime text-black'
                        : 'border-b-black/40 bg-farm-deep text-white/55',
                    ].join(' ')}
                  >
                    T{tier}
                  </button>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
