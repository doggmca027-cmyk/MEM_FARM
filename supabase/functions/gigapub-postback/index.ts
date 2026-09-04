// Supabase Edge Function — GigaPub rewarded-ad postback.
//
// Confirmed by GigaPub support (chat, no public docs page for this):
//   GET request, example callback: https://your-server.com/callback?uid={user_id}&event=ad_shown
//   "мы будем слать GET реквесты, вам всегда надо будет отвечать 200"
//   — always reply 200 to anything that looks like their own call, so they
//   never retry/flag a legitimate delivery. The only thing that does NOT
//   get an automatic 200 is a missing/wrong secret (not their traffic).
//
// Give GigaPub this exact URL as your postback:
//   GET /functions/v1/gigapub-postback?uid={user_id}&event=ad_shown&secret=<GIGAPUB_POSTBACK_SECRET>
//
// No custom click_id passthrough is documented, so — same as Adsgram —
// this settles the OLDEST still-PENDING ad_views row for that telegram id
// (credit_oldest_pending_ad_view). `{user_id}` is assumed to be the
// Telegram user id GigaPub reads from the Mini App's own Telegram context;
// if it turns out to be something else, this needs a lookup table instead.
//
// Secrets: GIGAPUB_POSTBACK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
// Deploy:  supabase functions deploy gigapub-postback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('GIGAPUB_POSTBACK_SECRET') ?? '';

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE || !SECRET) {
    return new Response('not configured', { status: 500 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== SECRET) {
    return new Response('forbidden', { status: 401 }); // not GigaPub's own traffic
  }

  const raw = url.searchParams.get('uid') ?? '';
  const telegramId = Number(raw.replace(/\D+/g, ''));
  const event = url.searchParams.get('event') ?? null;

  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    console.error('[gigapub-postback] bad uid:', raw);
    return new Response('OK', { status: 200 }); // still ack — GigaPub asked for always-200
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('credit_oldest_pending_ad_view', {
    p_telegram_id: telegramId,
    p_network: 'gigapub',
    p_network_ref: event,
  });
  if (error) {
    console.error('[gigapub-postback]', error);
  } else {
    const row = Array.isArray(data) ? data[0] : data;
    console.log('[gigapub-postback] settled:', { telegramId, event, credited: row?.credited });
  }

  return new Response('OK', { status: 200 });
});
