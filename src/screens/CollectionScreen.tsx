import { useMemo, useState, type ReactNode } from 'react';
import { Sparkles, Zap } from 'lucide-react';
import type { Rarity, TierId } from '../types/game';
import {
  groupCollection,
  selectBoostPct,
  selectDiscoveredCount,
  selectFarmPower,
  useGameStore,
} from '../store/useGameStore';
import { RARITY_HEX, RARITY_LABEL } from '../lib/meme';
import { formatNum } from '../lib/format';
import { GramIcon } from '../components/icons/Icons';
import { CollectionCard } from '../components/collection/CollectionCard';
import { HatInventory } from '../components/collection/HatInventory';
import { MergeModal } from '../components/collection/MergeModal';
import { StudyModal } from '../components/farm/StudyModal';

const TIERS: TierId[] = [1, 2, 3, 4, 5, 6];
const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const TOTAL_CARDS = 30;

export function CollectionScreen() {
  const tiers = useGameStore((s) => s.tiers);
  const discovered = useGameStore(selectDiscoveredCount);
  const power = useGameStore(selectFarmPower);
  const boost = useGameStore(selectBoostPct);

  const [sub, setSub] = useState<'cards' | 'hats'>('cards');
  const [tierF, setTierF] = useState<TierId | 'all'>('all');
  const [rarityF, setRarityF] = useState<Rarity | 'all'>('all');
  const [studyId, setStudyId] = useState<string | null>(null);
  const [merge, setMerge] = useState<{ name: string; level: number } | null>(null);

  const groups = useMemo(() => {
    let g = groupCollection(tiers);
    if (tierF !== 'all') g = g.filter((x) => x.sample.tier === tierF);
    if (rarityF !== 'all') g = g.filter((x) => x.sample.rarity === rarityF);
    return g;
  }, [tiers, tierF, rarityF]);

  return (
    <div className="space-y-4">
      {/* ===== HEADER STATS ===== */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black border-b-black/50 bg-farm-card/80 p-3 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
        <div className="relative grid grid-cols-3 gap-2 text-center">
          <Stat label="Відкрито" value={`${discovered} / ${TOTAL_CARDS}`} icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={3} />} tone="text-neon-yellow" />
          <Stat label="Сила ферми" value={formatNum(power)} icon={<Zap className="h-3.5 w-3.5" strokeWidth={3} />} tone="text-neon-cyan" />
          <Stat label="Буст доходу" value={`+${boost}%`} icon={<GramIcon className="h-3.5 w-3.5" />} tone="text-neon-lime" />
        </div>
      </div>

      {/* ===== SUBTAB ===== */}
      <div className="flex gap-2">
        {(['cards', 'hats'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={[
              'flex-1 rounded-2xl border-2 border-b-4 border-black px-2 py-2 text-[11px] font-extrabold uppercase',
              sub === k ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-card text-white/50',
            ].join(' ')}
          >
            {k === 'cards' ? 'Картки' : 'Спорядження'}
          </button>
        ))}
      </div>

      {sub === 'hats' ? (
        <HatInventory />
      ) : (
        <>
          {/* filters */}
          <div className="space-y-1.5">
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
              <FilterChip active={tierF === 'all'} onClick={() => setTierF('all')}>
                Всі
              </FilterChip>
              {TIERS.map((t) => (
                <FilterChip key={t} active={tierF === t} onClick={() => setTierF(t)}>
                  T{t}
                </FilterChip>
              ))}
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
              <FilterChip active={rarityF === 'all'} onClick={() => setRarityF('all')}>
                Всі
              </FilterChip>
              {RARITIES.map((r) => (
                <FilterChip
                  key={r}
                  active={rarityF === r}
                  onClick={() => setRarityF(r)}
                  color={RARITY_HEX[r]}
                >
                  {RARITY_LABEL[r]}
                </FilterChip>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 py-12 text-center text-xs text-white/45">
              Нічого не знайдено за фільтром
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {groups.map((g, i) => (
                <CollectionCard
                  key={g.key}
                  group={g}
                  index={i}
                  onStudy={setStudyId}
                  onMerge={(name, level) => setMerge({ name, level })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <StudyModal open={studyId != null} characterId={studyId} onClose={() => setStudyId(null)} />
      <MergeModal
        open={merge != null}
        name={merge?.name ?? null}
        level={merge?.level ?? 1}
        onClose={() => setMerge(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border-2 border-black bg-farm-deep px-1 py-2">
      <div className={`flex items-center justify-center gap-1 font-display text-sm text-stroke-sm ${tone}`}>
        {icon}
        {value}
      </div>
      <div className="mt-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white/40">
        {label}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-none rounded-xl border-2 border-black px-2.5 py-1 text-[10px] font-extrabold uppercase',
        active ? 'bg-neon-lime text-black' : 'bg-farm-card text-white/55',
      ].join(' ')}
      style={active && color ? { backgroundColor: color } : undefined}
    >
      {children}
    </button>
  );
}
