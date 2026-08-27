import { motion } from 'framer-motion';

interface Props {
  /** 0..1 */
  value: number;
  accent?: string;
  full?: boolean;
}

/** Neon-bordered fill bar with a diamond-grid texture on the fill. */
export function ProgressBar({ value, accent = '#84CC16', full = false }: Props) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="relative h-3.5 w-full overflow-hidden rounded-full border-2 border-black bg-black/40">
      <motion.div
        className="h-full rounded-full bg-diamond"
        style={{ backgroundColor: accent }}
        animate={{ width: `${pct}%` }}
        transition={{ ease: 'linear', duration: 0.25 }}
      />
      {full && <div className="absolute inset-0 animate-pulse bg-white/25" />}
    </div>
  );
}
