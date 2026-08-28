// Supabase Edge Function — automatic GRAM deposits from TON Memo transfers.
//
// Poll mode (GET, or POST {}):
//   Reads recent transactions of the treasury address from toncenter, treats
//   each incoming transfer's text comment as the sender's Telegram ID, and
//   credits `+value` GRAM (1 TON == 1 GRAM) via process_auto_deposit().
//   Idempotent — process_auto_deposit dedupes on tx_hash.
//
// Gate: DEPOSIT_WEBHOOK_SECRET via `x-webhook-secret` or `Authorization: Bearer`.
//
// Secrets:
//   TREASURY_ADDRESS            – the hot-wallet address funds arrive at
//   TONCENTER_API_KEY           – optional, raises the toncenter rate limit
//   DEPOSIT_WEBHOOK_SECRET      – shared secret protecting this endpoint
//   BOT_TOKEN                   – Telegram bot token (deposit DM)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – auto-injected
//
// Deploy: supabase functions deploy ton-deposit-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const TREASURY_ADDRESS = Deno.env.get('TREASURY_ADDRESS') ?? '';
const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('DEPOSIT_WEBHOOK_SECRET') ?? '';
const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TONCENTER = 'https://toncenter.com/api/v2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authorized(req: Request): boolean {
  if (!WEBHOOK_SECRET) return true;
  const h =
    req.headers.get('x-webhook-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return h === WEBHOOK_SECRET;
}

interface TcTx {
  transaction_id?: { hash?: string; lt?: string };
  in_msg?: { source?: string; value?: string; message?: string; msg_data?: { text?: string } };
  out_msgs?: unknown[];
}

async function fetchTreasuryTxs(limit = 30): Promise<TcTx[]> {
  const url = new URL(`${TONCENTER}/getTransactions`);
  url.searchParams.set('address', TREASURY_ADDRESS);
  url.searchParams.set('limit', String(limit));
  if (TONCENTER_API_KEY) url.searchParams.set('api_key', TONCENTER_API_KEY);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.result) ? (data.result as TcTx[]) : [];
}

async function sendDepositDm(chatId: number | string, amount: number): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `💎 *Депозит зараховано!*\n\nНа ваш баланс нараховано +${amount.toFixed(2)} GRAM.`,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    /* non-fatal */
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!TREASURY_ADDRESS || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'not configured' }, 500);
  }
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let txs: TcTx[];
  try {
    txs = await fetchTreasuryTxs();
  } catch (e) {
    return json({ error: String(e) }, 502);
  }

  let credited = 0;
  let skipped = 0;

  for (const tx of txs) {
    const inMsg = tx.in_msg;
    const hash = tx.transaction_id?.hash;
    if (!inMsg?.source || !hash) {
      skipped += 1;
      continue;
    }
    // an incoming transfer (deposit) — ignore internal / outgoing-heavy txs
    const nano = Number(inMsg.value ?? '0');
    if (!Number.isFinite(nano) || nano <= 0) {
      skipped += 1;
      continue;
    }

    const comment = (inMsg.message ?? inMsg.msg_data?.text ?? '').trim();
    const tgId = comment.replace(/\D+/g, '');
    if (!tgId) {
      skipped += 1;
      continue;
    }

    const { data: prof } = await db
      .from('profiles')
      .select('id, telegram_id')
      .eq('telegram_id', Number(tgId))
      .maybeSingle();
    if (!prof?.id) {
      skipped += 1;
      continue;
    }

    const amount = nano / 1e9; // 1 TON == 1 GRAM
    const { data, error } = await db.rpc('process_auto_deposit', {
      p_user_id: prof.id,
      p_amount: amount,
      p_tx_hash: hash,
    });
    if (error) {
      skipped += 1;
      continue;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.credited) {
      credited += 1;
      if (prof.telegram_id) await sendDepositDm(prof.telegram_id, amount);
    } else {
      skipped += 1; // already credited
    }
  }

  return json({ scanned: txs.length, credited, skipped });
});
