import type { ComponentType } from 'react';
import { motion } from 'framer-motion';
import { selectQuestBadge, useGameStore, type NavTab } from '../../store/useGameStore';
import { haptic } from '../../lib/haptics';
import {
  FarmIcon,
  InviteIcon,
  QuestsIcon,
  RaidIcon,
  WalletIcon,
} from '../icons/NavIcons';
import { useT } from '../../i18n/useT';

interface IconProps {
  className?: string;
}

interface TabDef {
  id: NavTab;
  Icon: ComponentType<IconProps>;
}

const TABS: TabDef[] = [
  { id: 'quests', Icon: QuestsIcon },
  { id: 'farm', Icon: FarmIcon },
  { id: 'raid', Icon: RaidIcon },
  { id: 'invite', Icon: InviteIcon },
  { id: 'wallet', Icon: WalletIcon },
];

export function BottomNav() {
  const t = useT();
  const activeTab = useGameStore((s) => s.activeTab);
  const setActiveTab = useGameStore((s) => s.setActiveTab);
  const questBadge = useGameStore(selectQuestBadge);
  const invites = useGameStore((s) => s.invites);

  const badgeFor = (id: NavTab): string | number | null => {
    if (id === 'quests') return questBadge > 0 ? questBadge : null;
    if (id === 'invite') return invites > 0 ? invites : null;
    return null;
  };

  const select = (id: NavTab) => {
    if (id === activeTab) return;
    haptic.impact('medium');
    setActiveTab(id);
  };

  return (
    <nav className="safe-b sticky bottom-0 z-30 border-t-2 border-black bg-farm-bg/90 px-2 pt-2 backdrop-blur-md">
      <ul className="flex items-stretch justify-between gap-1">
        {TABS.map(({ id, Icon }) => {
          const on = id === activeTab;
          const badge = badgeFor(id);
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => select(id)}
                aria-current={on ? 'page' : undefined}
                className="relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-1.5"
              >
                {on && (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-2xl border-2 border-black border-b-4 border-b-black/40 bg-neon-lime"
                  />
                )}

                <span className="relative">
                  <Icon
                    className={[
                      'h-6 w-6 transition-transform',
                      on ? 'scale-110 drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]' : 'opacity-70',
                    ].join(' ')}
                  />
                  {badge != null && (
                    <span className="absolute -right-2.5 -top-2 min-w-[16px] rounded-full border-2 border-black bg-neon-pink px-1 text-[9px] font-extrabold leading-4 text-white">
                      {badge}
                    </span>
                  )}
                </span>

                <span
                  className={[
                    'relative text-[10px] font-extrabold uppercase leading-none tracking-wide',
                    on ? 'text-black' : 'text-white/45',
                  ].join(' ')}
                >
                  {t(`nav.${id}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
