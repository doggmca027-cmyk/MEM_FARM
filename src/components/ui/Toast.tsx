import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Info } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';

/**
 * Transient bottom banner for RPC failures / notices. Reads `toast` from the
 * store and auto-dismisses after a few seconds (or on tap).
 */
export function Toast() {
  const toast = useGameStore((s) => s.toast);
  const clearToast = useGameStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clearToast, 4000);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  const isErr = toast?.kind === 'error';

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          type="button"
          onClick={clearToast}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-[calc(100%-2rem)] max-w-sm items-start gap-2 rounded-2xl border-2 border-b-4 border-black bg-farm-card px-3 py-2.5 text-left shadow-lg backdrop-blur-md"
          style={{ borderColor: isErr ? '#EC4899' : '#06B6D4' }}
        >
          {isErr ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-neon-pink" strokeWidth={3} />
          ) : (
            <Info className="mt-0.5 h-4 w-4 flex-none text-neon-cyan" strokeWidth={3} />
          )}
          <span className="text-[11px] font-bold leading-snug text-white/85">{toast.msg}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
