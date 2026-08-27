import { TonConnectButton } from '@tonconnect/ui-react';
import { useGameStore } from '../../store/useGameStore';
import { fmtGram } from '../../lib/format';
import { CoinIcon, GramIcon } from '../icons/Icons';
import { Chip } from '../ui/Chip';

const TAB_TITLE: Record<string, string> = {
  quests: 'Daily Quests',
  farm: 'Your Meme Farm',
  raid: 'Meme Raid',
  invite: 'Invite Frens',
  wallet: 'GRAM Wallet',
};

export function TopBar({ level = 7 }: { level?: number }) {
  const balanceGram = useGameStore((s) => s.balanceGram);
  const incomePerDay = useGameStore((s) => s.incomePerDay);
  const xp = useGameStore((s) => s.xp);
  const activeTab = useGameStore((s) => s.activeTab);

  return (
    <header className="safe-t sticky top-0 z-30 bg-farm-deep/85 px-4 pb-3 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black border-b-4 border-b-black/40 bg-neon-violet font-display text-sm text-stroke-sm">
            {level}
          </div>
          <Chip icon={<GramIcon className="h-4 w-4" />} className="bg-farm-card text-neon-cyan">
            {fmtGram(balanceGram)}
          </Chip>
          <Chip icon={<CoinIcon className="h-4 w-4" />} className="bg-farm-card text-neon-yellow">
            {xp}
          </Chip>
        </div>

        <div className="flex items-center gap-2">
          <Chip className="bg-farm-card text-neon-lime">+{fmtGram(incomePerDay, 3)}/d</Chip>
          <TonConnectButton />
        </div>
      </div>

      <h1 className="mt-2 font-display text-xl leading-none text-stroke">
        {TAB_TITLE[activeTab] ?? 'Meme Farm'}
      </h1>
    </header>
  );
}
