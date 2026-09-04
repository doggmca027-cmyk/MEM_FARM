// Supabase Edge Function — Adsgram rewarded-ad postback.
//
// Adsgram's own server calls this after a user finishes watching a "Reward"
// block, with a GET request carrying only the Telegram user id (no custom
// passthrough param is supported by their reward-URL macro):
//
//   GET /functions/v1/adsgram-postback?userid=[userId]&secret=<ADSGRAM_POSTBACK_SECRET>
//
// Configure this exact URL as the "Reward URL" on the Adsgram Ad Unit
// (block type = Reward). Docs: https://docs.adsgram.ai/publisher/get-block-id
// "After user gets reward on client side, we send GET request with user
// telegramId to your reward url."
//
// Since there's no click_id round-trip, we settle the OLDEST still-PENDING
// ad_views row for (telegram_id, 'adsgram') — see credit_oldest_pending_ad_view.
//
// Secrets: ADSGRAM_POSTBACK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
// Deploy:  supabase functions deploy adsgram-postback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('ADSGRAM_POSTBACK_SECRET') ?? '';

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE || !SECRET) {
    return new Response('not configured', { status: 500 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== SECRET) {
    return new Response('forbidden', { status: 401 });
  }

  const raw = url.searchParams.get('userid') ?? '';
  const telegramId = Number(raw.replace(/\D+/g, ''));
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    return new Response('bad userid', { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await db.rpc('credit_oldest_pending_ad_view', {
    p_telegram_id: telegramId,
    p_network: 'adsgram',
    p_network_ref: null,
  });
  if (error) {
    console.error('[adsgram-postback]', error);
    return new Response('error', { status: 500 });
  }

  // credited:false (no matching PENDING row — replay, or the user never
  // actually opened the ad from us) is not an error: just ack either way.
  return new Response('OK', { status: 200 });
});
