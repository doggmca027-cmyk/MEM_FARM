import { useState } from 'react';
import { TonConnectButton } from '@tonconnect/ui-react';
import { Crown, Settings, Star, User } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { fmtGram, formatNum } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { GramIcon } from '../icons/Icons';
import { Chip } from '../ui/Chip';
import { useT } from '../../i18n/useT';

/** Telegram avatar with the level badge overlaid; falls back to an initial. */
function AvatarBadge({ level }: { level: number }) {
  const photoUrl = useGameStore((s) => s.photoUrl);
  const displayName = useGameStore((s) => s.displayName);
  const [errored, setErrored] = useState(false);
  const initial = displayName.trim().charAt(0).toUpperCase();
  const showImg = photoUrl && !errored;

  return (
    <div className="relative h-9 w-9 flex-none">
      {showImg ? (
        <img
          src={photoUrl}
          alt="Avatar"
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          className="h-8 w-8 rounded-full border border-purple-500/40 object-cover shadow-sm"
        />
      ) : (
        <div className="grid h-8 w-8 place-items-center rounded-full border border-purple-500/40 bg-neon-violet/80 text-xs font-display text-stroke-sm shadow-sm">
          {initial || <User className="h-4 w-4" strokeWidth={2.75} />}
        </div>
      )}
      <span className="absolute -bottom-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-md border border-black bg-neon-violet px-0.5 text-[9px] font-display leading-none text-stroke-sm">
        {level}
      </span>
    </div>
  );
}

export function TopBar({ level = 7 }: { level?: number }) {
  const t = useT();
  const balanceGram = useGameStore((s) => s.balanceGram);
  const xp = useGameStore((s) => s.xp);
  const activeTab = useGameStore((s) => s.activeTab);
  const isAdmin = useGameStore((s) => s.profile?.isAdmin ?? false);
  const setAdminOpen = useGameStore((s) => s.setAdminOpen);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);

  return (
    <header className="safe-t sticky top-0 z-30 bg-farm-deep/85 px-4 pb-3 backdrop-blur-md">
      {/* row 1 — identity + stats + controls */}
      <div className="flex items-center gap-2">
        <AvatarBadge level={level} />
        <Chip icon={<GramIcon className="h-4 w-4" />} className="min-w-0 bg-farm-card text-neon-cyan">
          <span className="dir-ltr">{fmtGram(balanceGram)}</span>
        </Chip>
        <Chip
          icon={<Star className="h-3.5 w-3.5 fill-neon-yellow" strokeWidth={2.5} />}
          className="min-w-0 bg-farm-card text-neon-yellow"
        >
          <span className="dir-ltr">{formatNum(xp)} XP</span>
        </Chip>

        <div className="ml-auto flex flex-none items-center gap-2">
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
        </div>
      </div>

      {/* row 2 — screen title + wallet connect (its own line so it never clips) */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <h1 className="min-w-0 truncate font-display text-xl leading-none text-stroke">
          {t(`tabTitle.${activeTab}`)}
        </h1>
        <div className="flex-none overflow-hidden [&>*]:!max-w-[52vw]">
          <TonConnectButton />
        </div>
      </div>
    </header>
  );
}
