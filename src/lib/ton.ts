/**
 * Minimal, dependency-free helpers for building a TON Connect transaction
 * request. Enough for a text-comment deposit; not a general TON library.
 */

/**
 * Platform treasury (hot wallet) deposits are sent to. Set `VITE_TREASURY_ADDRESS`
 * in `.env` — must match the `TREASURY_ADDRESS` Supabase secret used by
 * `ton-deposit-webhook`. The placeholder below only lets the UI render.
 */
export const TREASURY_ADDRESS =
  import.meta.env.VITE_TREASURY_ADDRESS?.trim() ||
  'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ';

/** GRAM is priced 1:1 to TON for on-chain transfers in this demo. */
export function gramToNano(gram: number): string {
  return BigInt(Math.max(0, Math.round(gram * 1e9))).toString();
}

/** Seconds-since-epoch deadline for a tx request. */
export function validUntil(secondsFromNow = 300): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow;
}

/**
 * Base64 BoC of a standard text-comment message body (op = 0x00000000).
 * Single cell, bit-aligned — fine for short ASCII/UTF-8 comments (< 120 bytes).
 */
export function textCommentPayload(text: string): string {
  const body = new TextEncoder().encode(text);
  if (body.length > 120) throw new Error('comment too long for a single cell');

  const data = new Uint8Array(4 + body.length); // 4 zero bytes = op 0
  data.set(body, 4);

  const bits = data.length * 8;
  const d1 = 0; // 0 refs, not exotic, level 0
  const d2 = Math.floor(bits / 8) + Math.ceil(bits / 8); // bit-aligned -> 2 * bytes

  const cell = new Uint8Array(2 + data.length);
  cell[0] = d1;
  cell[1] = d2;
  cell.set(data, 2);

  const boc = new Uint8Array([
    0xb5, 0xee, 0x9c, 0x72, // BoC magic
    0x01, // flags = 0, ref-size = 1
    0x01, // offset-size = 1
    0x01, // cell count = 1
    0x01, // root count = 1
    0x00, // absent count = 0
    cell.length, // total cells size
    0x00, // root index
    ...cell,
  ]);

  let bin = '';
  for (const b of boc) bin += String.fromCharCode(b);
  return btoa(bin);
}
