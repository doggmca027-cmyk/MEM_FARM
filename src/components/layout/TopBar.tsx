import { TonConnectButton } from '@tonconnect/ui-react';
import { Crown, Settings, Star } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { fmtGram, formatNum } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { GramIcon } from '../icons/Icons';
import { Chip } from '../ui/Chip';
import { useT } from '../../i18n/useT';

export function TopBar({ level = 7 }: { level?: number }) {
  const t = useT();
  const balanceGram = useGameStore((s) => s.balanceGram);
  const incomePerDay = useGameStore((s) => s.incomePerDay);
  const xp = useGameStore((s) => s.xp);
  const activeTab = useGameStore((s) => s.activeTab);
  const isAdmin = useGameStore((s) => s.profile?.isAdmin ?? false);
  const setAdminOpen = useGameStore((s) => s.setAdminOpen);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);

  return (
    <header className="safe-t sticky top-0 z-30 bg-farm-deep/85 px-4 pb-3 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black border-b-4 border-b-black/40 bg-neon-violet font-display text-sm text-stroke-sm">
            {level}
          </div>
          <Chip icon={<GramIcon className="h-4 w-4" />} className="bg-farm-card text-neon-cyan">
            <span className="dir-ltr">{fmtGram(balanceGram)}</span>
          </Chip>
          <Chip
            icon={<Star className="h-3.5 w-3.5 fill-neon-yellow" strokeWidth={2.5} />}
            className="bg-farm-card text-neon-yellow"
          >
            <span className="dir-ltr">{formatNum(xp)} XP</span>
          </Chip>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              haptic.select();
              setSettingsOpen(true);
            }}
            aria-label={t('settings.title')}
            className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black border-b-4 border-b-black/40 bg-farm-card text-white/70 active:translate-y-0.5"
          >
            <Settings className="h-4 w-4" strokeWidth={2.75} />
          </button>
          {isAdmin && (
            <button
              onClick={() => {
                haptic.impact('medium');
                setAdminOpen(true);
              }}
              aria-label="Admin"
              className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black border-b-4 border-b-black/40 bg-neon-yellow text-black active:translate-y-0.5"
            >
              <Crown className="h-4 w-4" strokeWidth={3} />
            </button>
          )}
          <Chip className="bg-farm-card text-neon-lime">
            <span className="dir-ltr">+{fmtGram(incomePerDay, 3)}/d</span>
          </Chip>
          <TonConnectButton />
        </div>
      </div>

      <h1 className="mt-2 font-display text-xl leading-none text-stroke">
        {t(`tabTitle.${activeTab}`)}
      </h1>
    </header>
  );
}
