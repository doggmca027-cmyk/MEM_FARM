import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, GraduationCap, Sparkles } from 'lucide-react';
import {
  characterPower,
  flattenCharacters,
  studyFeeGram,
  useGameStore,
} from '../../store/useGameStore';
import { characterArtPrompt, MEME_EMOJI, RARITY_HEX, RARITY_LABEL } from '../../lib/meme';
import { fmtGram, formatNum } from '../../lib/format';
import { firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';
import { useT } from '../../i18n/useT';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Preselect this instance (when opened from a collection card). */
  characterId?: string | null;
}

export function StudyModal({ open, onClose, characterId = null }: Props) {
  const t = useT();
  const tiers = useGameStore((s) => s.tiers);
  const balanceGram = useGameStore((s) => s.balanceGram);
  const upgradeCharacter = useGameStore((s) => s.upgradeCharacter);

  const roster = useMemo(() => flattenCharacters(tiers), [tiers]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (characterId && roster.some((c) => c.id === characterId)) {
      setSelectedId(characterId);
      return;
    }
    setSelectedId((cur) => (cur && roster.some((c) => c.id === cur) ? cur : roster[0]?.id ?? null));
  }, [open, characterId, roster]);

  const selected = roster.find((c) => c.id === selectedId) ?? null;
  const fee = selected ? studyFeeGram(selected.studyLevel) : 0;
  const canAfford = selected ? balanceGram + 1e-9 >= fee : false;
  const nextPower = selected
    ? characterPower(selected.basePower, selected.level, selected.studyLevel + 1)
    : 0;

  const doUpgrade = async () => {
    if (!selected || !canAfford || busy) return;
    setBusy(true);
    try {
      await upgradeCharacter(selected.id);
      firePop();
      haptic.notify('success');
      setFlash(true);
      window.setTimeout(() => setFlash(false), 700);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#06B6D4"
      title={
        <span className="inline-flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
          {t('study.title')}
        </span>
      }
    >
      {/* roster picker */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {roster.map((c) => {
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => {
                haptic.select();
                setSelectedId(c.id);
              }}
              className={[
                'flex flex-none flex-col items-center gap-1 rounded-2xl border-2 p-2 transition-all',
                on ? 'border-black bg-neon-cyan text-black' : 'border-black/40 bg-farm-card text-white/70',
              ].join(' ')}
            >
              <span
                className="grid h-11 w-11 place-items-center rounded-xl border-2 border-black bg-farm-deep text-xl"
                style={{ borderColor: RARITY_HEX[c.rarity] }}
              >
                {MEME_EMOJI[c.memeType]}
              </span>
              <span className="text-[10px] font-extrabold leading-none dir-ltr">
                {t('study.lvl', { n: c.level })}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <motion.div
          key={selected.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border-2 border-b-4 border-black border-b-black/50 bg-farm-card/80 p-4"
          title={characterArtPrompt(selected.name, selected.memeType, selected.rarity)}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg text-stroke">{selected.name}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                {RARITY_LABEL[selected.rarity]} · {selected.memeType}
              </div>
            </div>
            <motion.span
              animate={flash ? { scale: [1, 1.35, 1] } : {}}
              className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl"
              style={{ borderColor: RARITY_HEX[selected.rarity] }}
            >
              {MEME_EMOJI[selected.memeType]}
            </motion.span>
          </div>

          {/* Study raises PvP power only — income is unaffected */}
          <div className="mt-3 flex items-center gap-3">
            <StatBlock
              label={t('study.power')}
              value={formatNum(selected.power)}
            />
            <ArrowRight className="h-5 w-5 flex-none text-neon-lime dir-ltr" strokeWidth={3} />
            <StatBlock label={t('study.after')} value={formatNum(nextPower)} highlight />
          </div>
          <div className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-white/35">
            {t('study.incomeNote')}
          </div>

          {/* cost + action */}
          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-1 text-xs font-bold text-white/60">
              {t('study.cost')}
              <span className={canAfford ? 'text-neon-yellow' : 'text-neon-pink'}>
                <GramIcon className="mb-0.5 mr-0.5 inline h-3.5 w-3.5" />
                <span className="dir-ltr">{fmtGram(fee, 3)}</span>
              </span>
              <span className="text-white/35 dir-ltr">· {t('study.balance', { n: fmtGram(balanceGram) })}</span>
            </div>
            <GameButton accent="lime" disabled={!canAfford} onClick={doUpgrade}>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" strokeWidth={3} />
                {t('study.improve')}
              </span>
            </GameButton>
          </div>
        </motion.div>
      )}
    </Modal>
  );
}

function StatBlock({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        'flex-1 rounded-2xl border-2 border-black px-3 py-2 text-center',
        highlight ? 'bg-neon-lime/20' : 'bg-farm-deep',
      ].join(' ')}
    >
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-white/45">{label}</div>
      <div className="font-display text-sm text-stroke-sm">{value}</div>
    </div>
  );
}
