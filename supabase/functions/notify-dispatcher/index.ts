// Supabase Edge Function — Telegram push notification dispatcher.
//
// Two modes:
//   1. CRON   — GET, or POST {}/{"mode":"cron"}. Drains `event_queue` and scans
//               `farm_states` for freshly-ready farms, sends messages, logs.
//   2. EVENT  — POST { type, telegram_id, metadata }. Sends one message.
//
// Gate: if NOTIFY_SECRET is set, requests must carry `x-notify-secret: <secret>`
//       or `Authorization: Bearer <secret>`.
//
// Secrets:
//   BOT_TOKEN                  – Telegram bot token
//   NOTIFY_SECRET             – shared secret protecting this endpoint
//   TMA_URL                   – link the inline button opens (defaults to t.me/<bot>)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – auto-injected
//
// Schedule (SQL, pg_cron):
//   select cron.schedule('notify', '*/5 * * * *',
//     $$ select net.http_post(
//          url := '<project>/functions/v1/notify-dispatcher',
//          headers := jsonb_build_object('x-notify-secret', '<secret>')) $$);
//
// Deploy: supabase functions deploy notify-dispatcher --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET') ?? '';
const TMA_URL = Deno.env.get('TMA_URL') ?? 'https://t.me';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type NotifType = 'FARM_READY' | 'PVP_ATTACK' | 'REFERRAL_INCOME';

const PREF_KEY: Record<NotifType, string> = {
  FARM_READY: 'farm_ready',
  PVP_ATTACK: 'pvp_attack',
  REFERRAL_INCOME: 'referral_income',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authorized(req: Request): boolean {
  if (!NOTIFY_SECRET) return true; // not configured → open (dev)
  const header =
    req.headers.get('x-notify-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return header === NOTIFY_SECRET;
}

function prefsAllow(prefs: Record<string, unknown> | null, type: NotifType): boolean {
  return prefs?.[PREF_KEY[type]] !== false;
}

function buildMessage(type: NotifType, meta: Record<string, unknown>): { text: string; button: string } {
  switch (type) {
    case 'FARM_READY':
      return {
        text: '🌾 *Твоя ферма готова до збору!*\n\nНакопичено максимум GRAM. Заходь забрати свій прибуток!',
        button: '🌾 Забрати',
      };
    case 'REFERRAL_INCOME':
      return {
        text: `💸 *Реферальний дохід!*\n\nТобі нараховано \`${meta.amount ?? '?'}\` GRAM (L${meta.level ?? '?'}). Забери на вкладці «Frens».`,
        button: '💸 Відкрити',
      };
    case 'PVP_ATTACK':
      return {
        text: '⚔️ *На тебе напали в рейді!*\n\nСуперник переміг у набігу. Час на реванш!',
        button: '⚔️ У бій',
      };
  }
}

async function sendTelegram(chatId: number | string, text: string, button: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: button, url: TMA_URL }]] },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'not configured' }, 500);
  }
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { mode?: string; type?: NotifType; telegram_id?: number; metadata?: Record<string, unknown> } = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  // ---------- EVENT MODE ----------
  if (body.type && body.telegram_id) {
    const { text, button } = buildMessage(body.type, body.metadata ?? {});
    const ok = await sendTelegram(body.telegram_id, text, button);
    return json({ mode: 'event', sent: ok });
  }

  // ---------- CRON MODE ----------
  let processed = 0;
  let farmNotified = 0;
  let failed = 0;

  // 1. drain the event queue
  const { data: events } = await db
    .from('event_queue')
    .select('id, user_id, type, metadata, profiles!inner(telegram_id, notif_prefs)')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  for (const e of events ?? []) {
    const prof = (e as Record<string, unknown>).profiles as { telegram_id: number | null; notif_prefs: Record<string, unknown> } | null;
    const type = (e as Record<string, unknown>).type as NotifType;
    const uid = (e as Record<string, unknown>).user_id as string;
    let ok = false;

    if (prof?.telegram_id && prefsAllow(prof.notif_prefs, type)) {
      const { text, button } = buildMessage(type, ((e as Record<string, unknown>).metadata as Record<string, unknown>) ?? {});
      ok = await sendTelegram(prof.telegram_id, text, button);
      await db.from('notification_logs').insert({ user_id: uid, type, status: ok ? 'SENT' : 'FAILED' });
      if (ok) processed += 1;
      else failed += 1;
    }
    await db.from('event_queue').update({ processed_at: new Date().toISOString() }).eq('id', (e as Record<string, unknown>).id);
  }

  // 2. farm-ready scan
  const { data: farms } = await db
    .from('farm_states')
    .select('user_id, profiles!inner(telegram_id, notif_prefs)')
    .lte('next_claim_at', new Date().toISOString())
    .eq('is_claim_notified', false)
    .limit(500);

  for (const f of farms ?? []) {
    const prof = (f as Record<string, unknown>).profiles as { telegram_id: number | null; notif_prefs: Record<string, unknown> } | null;
    const uid = (f as Record<string, unknown>).user_id as string;

    if (prof?.telegram_id && prefsAllow(prof.notif_prefs, 'FARM_READY')) {
      const { text, button } = buildMessage('FARM_READY', {});
      const ok = await sendTelegram(prof.telegram_id, text, button);
      await db.from('notification_logs').insert({ user_id: uid, type: 'FARM_READY', status: ok ? 'SENT' : 'FAILED' });
      if (ok) farmNotified += 1;
      else failed += 1;
    }
    // flip the flag regardless so the farm isn't rescanned every tick
    await db.from('farm_states').update({ is_claim_notified: true }).eq('user_id', uid);
  }

  return json({ mode: 'cron', processed, farm_notified: farmNotified, failed });
});
