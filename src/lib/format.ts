/** Compact number formatting: 1234 -> "1.23K", 2_500_000 -> "2.5M". */
export function formatNum(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return trim(v / 1_000_000) + 'M';
  if (Math.abs(v) >= 1_000) return trim(v / 1_000) + 'K';
  return String(v);
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** GRAM amounts. Defaults to 2 dp; pass 3 for small per-day yields (0.025). */
export function fmtGram(n: number, dp = 2): string {
  return n.toFixed(dp);
}

/** Round to 4 decimals to keep mock GRAM math clean. */
export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** ms -> "HH:MM:SS" (clamped at 0). */
export function fmtHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
}

/** epoch ms -> "DD.MM.YY · HH:MM". */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Middle-truncate a wallet address: "UQBY...Ipk". */
export function shortAddress(addr: string, head = 4, tail = 3): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}
