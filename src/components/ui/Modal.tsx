import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { haptic } from '../../lib/haptics';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Optional accent for the top border, hex. */
  accent?: string;
}

/** Bottom-sheet modal — backdrop blur, spring slide-up, safe-area aware. */
export function Modal({ open, onClose, title, children, accent = '#84CC16' }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              haptic.select();
              onClose();
            }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="safe-b relative z-10 w-full max-w-md rounded-t-4xl border-2 border-b-0 border-black bg-farm-bg px-4 pb-4 pt-3"
            style={{ borderTopWidth: 4, borderTopColor: accent }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/25" />
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-xl text-stroke">{title}</h3>
              <button
                onClick={() => {
                  haptic.select();
                  onClose();
                }}
                className="grid h-8 w-8 place-items-center rounded-xl border-2 border-black bg-farm-card text-white/70 active:translate-y-0.5"
              >
                <X className="h-4 w-4" strokeWidth={3} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
