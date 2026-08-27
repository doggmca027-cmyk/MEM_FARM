import { useEffect, useState } from 'react';
import { fmtHMS } from '../lib/format';

/** Ticks once a second toward `target` (epoch ms). */
export function useCountdown(target: number) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ms = Math.max(0, target - nowMs);
  return { ms, done: ms <= 0, label: fmtHMS(ms) };
}
