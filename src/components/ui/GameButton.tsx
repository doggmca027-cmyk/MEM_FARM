import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { haptic } from '../../lib/haptics';

type Accent = 'lime' | 'yellow' | 'cyan' | 'pink' | 'violet';

const SKIN: Record<Accent, string> = {
  lime: 'bg-neon-lime text-black',
  yellow: 'bg-neon-yellow text-black',
  cyan: 'bg-neon-cyan text-black',
  pink: 'bg-neon-pink text-white',
  violet: 'bg-neon-violet text-white',
};

interface Props {
  accent?: Accent;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Chunky mobile-game button: rounded-2xl, 2px black border, a solid
 * bottom "ledge" (`border-b-4 border-black/40`) that collapses on press
 * (`active:border-b-0 active:translate-y-1`). Fires a medium haptic on tap.
 */
export function GameButton({
  accent = 'lime',
  block = false,
  disabled = false,
  title,
  className = '',
  onClick,
  children,
}: Props) {
  return (
    <motion.button
      type="button"
      title={title}
      disabled={disabled}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      onClick={() => {
        if (disabled) return;
        haptic.impact('medium');
        onClick?.();
      }}
      className={[
        'relative select-none rounded-2xl border-2 border-black border-b-4 border-b-black/40',
        'px-4 py-2.5 font-display uppercase leading-none tracking-wide text-stroke-sm',
        'transition-all duration-75 active:translate-y-1 active:border-b-0',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale',
        SKIN[accent],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {children}
    </motion.button>
  );
}
