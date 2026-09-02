import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore, type NavTab } from '../../store/useGameStore';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '../ErrorBoundary';
import { Toast } from '../ui/Toast';
import { FarmHubScreen } from '../../screens/FarmHubScreen';
import { QuestsScreen } from '../../screens/QuestsScreen';
import { RaidScreen } from '../../screens/RaidScreen';
import { InviteScreen } from '../../screens/InviteScreen';
import { WalletScreen } from '../../screens/WalletScreen';
import { AmbassadorScreen } from '../../screens/AmbassadorScreen';
import { AdminScreen } from '../../screens/AdminScreen';
import { SettingsModal } from '../settings/SettingsModal';

const SCREENS: Record<NavTab, () => ReactNode> = {
  quests: () => <QuestsScreen />,
  farm: () => <FarmHubScreen />,
  raid: () => <RaidScreen />,
  invite: () => <InviteScreen />,
  ambassador: () => <AmbassadorScreen />,
  wallet: () => <WalletScreen />,
};

export function AppLayout() {
  const activeTab = useGameStore((s) => s.activeTab);
  const adminOpen = useGameStore((s) => s.adminOpen);
  const isAdmin = useGameStore((s) => s.profile?.isAdmin ?? false);
  const settingsOpen = useGameStore((s) => s.settingsOpen);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);

  return (
    <div className="relative mx-auto flex min-h-full max-w-md flex-col bg-gradient-to-b from-purple-700 via-pink-600/70 to-indigo-900 text-white">
      {/* ambient glow blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-farm-deep">
        <div className="absolute -left-20 top-6 h-56 w-56 rounded-full bg-neon-pink/25 blur-3xl" />
        <div className="absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-neon-cyan/20 blur-3xl" />
        <div className="absolute bottom-6 left-1/4 h-56 w-56 rounded-full bg-neon-violet/25 blur-3xl" />
      </div>

      <TopBar />

      <main className="flex-1 overflow-x-hidden px-4 pb-6 pt-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <ErrorBoundary resetKey={activeTab} label={activeTab}>
              {SCREENS[activeTab]()}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {adminOpen && isAdmin && <AdminScreen />}
      <Toast />
    </div>
  );
}
