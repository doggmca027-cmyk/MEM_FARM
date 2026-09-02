// Supabase Edge Function — partner completion check for Meme Farm.
//
// Lets another app verify that a given Telegram user has done something in
// Meme Farm (registered / deposited / claimed farm income), so they can gate
// a "join Meme Farm" task with an API check.
//
//   GET /functions/v1/partner-check?telegram_id=<id>[&metric=<name>]
//   Header:  X-Partner-Key: <PARTNER_CHECK_KEY>   (or ?key=<...> for GET-only clients)
//
// Response (200):
//   {
//     "ok": true,
//     "telegram_id": 123,
//     "registered": true,
//     "deposited": true,
//     "deposit_total": 5.5,
//     "deposit_count": 2,
//     "farm_claimed": true,
//     "first_seen": "2026-09-01T10:00:00Z"
//   }
//   When metric is given, also: { "result": <bool for that metric> }
//   Unknown user -> 200 { ok:true, registered:false, ... all false / 0 }
//
// Secrets:  PARTNER_CHECK_KEY  +  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
// Deploy:   supabase functions deploy partner-check --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const PARTNER_KEY = Deno.env.get('PARTNER_CHECK_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** Minimum COMPLETED deposit total (GRAM) to count `deposited` as true. */
const DEPOSIT_MIN = Number(Deno.env.get('PARTNER_DEPOSIT_MIN') ?? '1');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-partner-key, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!PARTNER_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ ok: false, error: 'not configured' }, 500);
  }

  const url = new URL(req.url);
  const key =
    req.headers.get('x-partner-key') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('key') ??
    '';
  if (key !== PARTNER_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  const raw = url.searchParams.get('telegram_id') ?? url.searchParams.get('tg') ?? '';
  const telegramId = Number(String(raw).replace(/\D+/g, ''));
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    return json({ ok: false, error: 'missing telegram_id' }, 400);
  }
  const metric = (url.searchParams.get('metric') ?? '').trim();

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: prof } = await db
    .from('profiles')
    .select('id, created_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  const base = {
    ok: true,
    telegram_id: telegramId,
    registered: false,
    deposited: false,
    deposit_total: 0,
    deposit_count: 0,
    farm_claimed: false,
    first_seen: null as string | null,
  };

  if (!prof) {
    return json(metric ? { ...base, result: false } : base);
  }

  const [{ data: deps }, { data: claims }] = await Promise.all([
    db
      .from('transactions')
      .select('amount')
      .eq('user_id', prof.id)
      .eq('type', 'DEPOSIT')
      .eq('status', 'COMPLETED'),
    db
      .from('transactions')
      .select('id')
      .eq('user_id', prof.id)
      .eq('type', 'FARM_CLAIM')
      .limit(1),
  ]);

  const depositTotal = (deps ?? []).reduce((s, r) => s + Number((r as { amount: unknown }).amount ?? 0), 0);
  const out = {
    ...base,
    registered: true,
    deposited: depositTotal >= DEPOSIT_MIN,
    deposit_total: Number(depositTotal.toFixed(6)),
    deposit_count: (deps ?? []).length,
    farm_claimed: (claims ?? []).length > 0,
    first_seen: prof.created_at ?? null,
  };

  const metrics: Record<string, boolean> = {
    registered: out.registered,
    deposited: out.deposited,
    farm_claimed: out.farm_claimed,
  };
  return json(metric ? { ...out, result: metrics[metric] ?? false } : out);
});
