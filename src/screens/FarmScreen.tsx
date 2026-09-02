import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Swords } from 'lucide-react';
import type { TierId } from '../types/game';
import { useGameStore } from '../store/useGameStore';
import { useCountdown } from '../hooks/useCountdown';
import { fmtGram } from '../lib/format';
import { fireClaimConfetti } from '../lib/confetti';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { ProgressBar } from '../components/ui/ProgressBar';
import { GramIcon } from '../components/icons/Icons';
import { TierSlotRow } from '../components/farm/TierSlotRow';
import { CollectionStrip } from '../components/farm/CollectionStrip';
import { StudyModal } from '../components/farm/StudyModal';
import { GachaRevealModal } from '../components/farm/GachaRevealModal';
import { useT } from '../i18n/useT';

export function FarmScreen() {
  const t = useT();
  const farm = useGameStore((s) => s.farm);
  const tiers = useGameStore((s) => s.tiers);
  const incomePerDay = useGameStore((s) => s.incomePerDay);
  const accrue = useGameStore((s) => s.accrue);
  const claim = useGameStore((s) => s.claim);
  const rollTier = useGameStore((s) => s.rollTier);
  const balanceGram = useGameStore((s) => s.balanceGram);
  const setActiveTab = useGameStore((s) => s.setActiveTab);

  const { label, done } = useCountdown(farm.nextClaimAt);

  const [expanded, setExpanded] = useState<TierId | null>(1);
  const [studyOpen, setStudyOpen] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    accrue();
    const id = window.setInterval(accrue, 1000);
    return () => window.clearInterval(id);
  }, [accrue]);

  const cycle = farm.nextClaimAt - farm.lastClaimAt || 1;
  const progress = Math.min(1, Math.max(0, (Date.now() - farm.lastClaimAt) / cycle));
  // The server only settles a claim once the 8h cycle is complete
  // (claim_farm_income raises "not ready" before next_claim_at), so the button
  // must wait for `done` too — not just for something to have accrued.
  const canClaim = done && farm.claimableGram > 0;

  const onClaim = () => {
    if (!canClaim) return;
    fireClaimConfetti();
    haptic.notify('success');
    claim();
    setPulse(true);
    window.setTimeout(() => setPulse(false), 500);
  };

  const onRoll = (tier: TierId) => {
    const cost = tiers.find((t) => t.tier === tier)?.costGram ?? 0;
    if (balanceGram + 1e-9 < cost) {
      haptic.notify('error');
      return;
    }
    haptic.impact('medium');
    rollTier(tier);
  };

  return (
    <div className="space-y-5">
      {/* ================= HEADER ================= */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-yellow border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
        {pulse && (
          <div className="pointer-events-none absolute -inset-10 animate-pulse bg-[radial-gradient(circle,rgba(250,204,21,0.35),transparent_70%)]" />
        )}

        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">{t('farm.accrued')}</div>
            <motion.div
              key={Math.floor(farm.claimableGram * 1000)}
              initial={{ scale: 0.97 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1.5 font-display text-3xl text-neon-yellow text-stroke"
            >
              <GramIcon className="h-7 w-7" />
              <span className="dir-ltr">{fmtGram(farm.claimableGram, 3)}</span>
            </motion.div>
            <div className="mt-0.5 text-[11px] font-semibold text-neon-lime dir-ltr">
              {t('farm.incomePerDay', { n: fmtGram(incomePerDay, 3) })}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              {done ? t('farm.ready') : t('farm.cycle8h')}
            </div>
            <div className="font-display text-2xl tabular-nums text-stroke dir-ltr">{label}</div>
          </div>
        </div>

        <div className="relative mt-3">
          <ProgressBar value={progress} accent="#FACC15" full={done} />
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <GameButton
            accent="pink"
            className="text-xs"
            onClick={() => {
              haptic.impact('medium');
              setActiveTab('raid');
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Swords className="h-4 w-4" strokeWidth={3} />
              {t('farm.hunt')}
            </span>
          </GameButton>
          <GameButton
            accent="cyan"
            className="text-xs"
            onClick={() => {
              haptic.impact('medium');
              setStudyOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <GraduationCap className="h-4 w-4" strokeWidth={3} />
              {t('farm.study')}
            </span>
          </GameButton>
        </div>

        <div className="relative mt-2">
          <GameButton accent="yellow" block disabled={!canClaim} onClick={onClaim}>
            {farm.claimableGram > 0
              ? t('farm.collect', { n: fmtGram(farm.claimableGram, 3) })
              : t('farm.nothingToCollect')}
          </GameButton>
        </div>
      </motion.div>

      {/* ================= TIER LIST ================= */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="font-display text-lg text-stroke">{t('farm.tiersTitle')}</h2>
          <span className="text-xs font-bold text-white/40">{t('farm.tiersSub')}</span>
        </div>
        <div className="space-y-3">
          {tiers.map((row, i) => (
            <TierSlotRow
              key={row.tier}
              row={row}
              index={i}
              expanded={expanded === row.tier}
              onToggle={() => {
                haptic.select();
                setExpanded((cur) => (cur === row.tier ? null : row.tier));
              }}
              onRoll={onRoll}
            />
          ))}
        </div>
      </section>

      {/* ================= COLLECTION ================= */}
      <CollectionStrip />

      {/* ================= MODALS ================= */}
      <StudyModal open={studyOpen} onClose={() => setStudyOpen(false)} />
      <GachaRevealModal />
    </div>
  );
}
