import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sprout, KeyRound } from 'lucide-react';
import { haptic } from '../lib/haptics';
import { FarmScreen } from './FarmScreen';
import { CollectionScreen } from './CollectionScreen';

type View = 'farm' | 'collection';

export function FarmHubScreen() {
  const [view, setView] = useState<View>('farm');

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Seg active={view === 'farm'} onClick={() => setView('farm')} icon={<Sprout className="h-4 w-4" strokeWidth={3} />}>
          Ферма
        </Seg>
        <Seg
          active={view === 'collection'}
          onClick={() => setView('collection')}
          icon={<KeyRound className="h-4 w-4" strokeWidth={3} />}
        >
          Колекція
        </Seg>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.16 }}
        >
          {view === 'farm' ? <FarmScreen /> : <CollectionScreen />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Seg({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={[
        'flex flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-b-4 border-black py-2 font-display text-sm uppercase',
        active ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-card text-white/50',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  );
}
