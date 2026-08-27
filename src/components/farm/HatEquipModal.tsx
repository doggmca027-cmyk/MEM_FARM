import { motion } from 'framer-motion';
import { BadgeCheck, Ban, HardHat } from 'lucide-react';
import type { TierId } from '../../types/game';
import { useGameStore } from '../../store/useGameStore';
import { hatArtPrompt, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  tier: TierId | null;
}

export function HatEquipModal({ open, onClose, tier }: Props) {
  const hats = useGameStore((s) => s.hats);
  const equipHat = useGameStore((s) => s.equipHat);
  const key = tier != null ? `tier-${tier}` : null;

  const pick = (hatId: string | null) => {
    if (tier == null) return;
    equipHat(tier, hatId);
    haptic.notify('success');
    if (hatId) firePop();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#FACC15"
      title={
        <span className="inline-flex items-center gap-2">
          <HardHat className="h-5 w-5 text-neon-yellow" strokeWidth={2.5} />
          Буст {tier != null ? `· Tier ${tier}` : ''}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => pick(null)}
          className="flex flex-col items-center gap-1 rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card p-3 text-white/60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl border-2 border-black bg-farm-deep">
            <Ban className="h-5 w-5 text-white/50" strokeWidth={2.5} />
          </span>
          <span className="text-xs font-extrabold uppercase">Порожньо</span>
        </button>

        {hats.map((hat) => {
          const here = hat.equippedTierId === key;
          const elsewhere = hat.equippedTierId != null && !here;
          const otherTier = elsewhere ? hat.equippedTierId?.replace('tier-', '') : null;
          return (
            <motion.button
              key={hat.id}
              whileTap={{ scale: 0.96 }}
              onClick={() => pick(hat.id)}
              title={hatArtPrompt(hat.name)}
              className="relative flex flex-col items-center gap-1 rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card p-3 text-center"
              style={{ borderColor: RARITY_HEX[hat.rarity], borderBottomColor: 'rgba(0,0,0,0.4)' }}
            >
              {here && (
                <BadgeCheck className="absolute right-1.5 top-1.5 h-4 w-4 text-neon-lime" strokeWidth={3} />
              )}
              <span
                className="grid h-12 w-12 place-items-center rounded-xl border-2 border-black bg-farm-deep text-2xl"
                style={{ boxShadow: `inset 0 0 0 2px ${RARITY_HEX[hat.rarity]}` }}
              >
                {hat.emoji}
              </span>
              <span className="text-xs font-extrabold leading-tight text-white">{hat.name}</span>
              <span className="rounded-md border-2 border-black bg-neon-yellow px-1.5 text-[10px] font-extrabold leading-4 text-black">
                +{hat.bonusPct}%
              </span>
              <span className="text-[9px] font-bold uppercase text-white/40">
                {elsewhere ? `Зайнято · Tier ${otherTier}` : RARITY_LABEL[hat.rarity]}
              </span>
            </motion.button>
          );
        })}
      </div>
    </Modal>
  );
}
