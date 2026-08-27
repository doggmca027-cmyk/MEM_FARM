/** ms from now until the next 00:00 UTC. */
export function msUntilUtcMidnight(from: number = Date.now()): number {
  const d = new Date(from);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next - from);
}

/** True when the two epoch-ms values fall on the same UTC calendar day. */
export function isSameUtcDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

/** Whole UTC days between two epoch-ms values (b - a), floored. */
export function utcDaysBetween(a: number, b: number): number {
  const da = Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), new Date(a).getUTCDate());
  const db = Date.UTC(new Date(b).getUTCFullYear(), new Date(b).getUTCMonth(), new Date(b).getUTCDate());
  return Math.floor((db - da) / 86_400_000);
}
