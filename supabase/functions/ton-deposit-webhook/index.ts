// Supabase Edge Function — automatic GRAM deposits from TON Memo transfers.
//
// Two ways to feed it:
//   A) POST { "transactions": [{ "tx_hash": "...", "amount_nano": "1000000000",
//             "comment": "<telegram_id>" }, ...] }   ← toncenter/tonapi webhook
//             or an external scanner
//   B) GET / POST {}  ← self-poll: reads recent txs of TREASURY_ADDRESS from
//             toncenter and processes the incoming transfers
//
// For every incoming transfer it parses the numeric Telegram ID from the memo,
// finds the profile, and calls process_auto_deposit(user, amount_gram, tx_hash)
// (1 TON == 1 GRAM). The RPC is idempotent on tx_hash and enqueues a DEPOSIT
// notification event that notify-dispatcher turns into the Telegram DM.
//
// Gate: DEPOSIT_WEBHOOK_SECRET via `x-webhook-secret` / `Authorization: Bearer`.
//
// Secrets: TREASURY_ADDRESS, TONCENTER_API_KEY (opt), DEPOSIT_WEBHOOK_SECRET,
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// Deploy: supabase functions deploy ton-deposit-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const TREASURY_ADDRESS = Deno.env.get('TREASURY_ADDRESS') ?? '';
const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('DEPOSIT_WEBHOOK_SECRET') ?? '';
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

interface Incoming {
  tx_hash: string;
  amount_nano: string | number;
  comment: string;
}

interface TcTx {
  transaction_id?: { hash?: string };
  in_msg?: { source?: string; value?: string; message?: string; msg_data?: { text?: string } };
}

async function pollTreasury(limit = 30): Promise<Incoming[]> {
  const url = new URL(`${TONCENTER}/getTransactions`);
  url.searchParams.set('address', TREASURY_ADDRESS);
  url.searchParams.set('limit', String(limit));
  if (TONCENTER_API_KEY) url.searchParams.set('api_key', TONCENTER_API_KEY);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  const data = await res.json();
  const rows: TcTx[] = Array.isArray(data?.result) ? data.result : [];
  return rows
    .filter((t) => t.in_msg?.source && t.transaction_id?.hash && Number(t.in_msg?.value ?? 0) > 0)
    .map((t) => ({
      tx_hash: t.transaction_id!.hash!,
      amount_nano: t.in_msg!.value ?? '0',
      comment: (t.in_msg!.message ?? t.in_msg!.msg_data?.text ?? '').trim(),
    }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- gather incoming transfers ----
  let items: Incoming[] = [];
  if (req.method === 'POST') {
    let body: { transactions?: Incoming[] } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (Array.isArray(body.transactions)) items = body.transactions;
  }
  if (items.length === 0) {
    if (!TREASURY_ADDRESS) return json({ error: 'no transactions and TREASURY_ADDRESS unset' }, 400);
    try {
      items = await pollTreasury();
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  }

  let credited = 0;
  let skipped = 0;

  for (const it of items) {
    const hash = String(it.tx_hash ?? '').trim();
    const nano = Number(it.amount_nano ?? 0);
    const tgId = String(it.comment ?? '').replace(/\D+/g, '');
    if (!hash || !Number.isFinite(nano) || nano <= 0 || !tgId) {
      skipped += 1;
      continue;
    }

    const { data: prof } = await db
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(tgId))
      .maybeSingle();
    if (!prof?.id) {
      skipped += 1;
      continue;
    }

    const amountGram = nano / 1e9; // 1 TON == 1 GRAM
    const { data, error } = await db.rpc('process_auto_deposit', {
      p_user_id: prof.id,
      p_amount: amountGram,
      p_tx_hash: hash,
    });
    if (error) {
      skipped += 1;
      continue;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.credited) credited += 1;
    else skipped += 1; // already credited
  }

  // fire the notification drain so the DEPOSIT DM goes out promptly
  if (credited > 0) {
    try {
      await db.functions.invoke('notify-dispatcher', { body: { mode: 'cron' } });
    } catch {
      /* cron also drains it */
    }
  }

  return json({ received: items.length, credited, skipped });
});
