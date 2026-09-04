// Supabase Edge Function — Monetag rewarded-interstitial postback.
//
// Confirmed against https://docs.monetag.com/docs/postbacks/ :
//   - GET request, macros: {ymid} {zone_id} {sub_zone_id} {event_type}
//     {reward_event_type} {estimated_price} {telegram_id}.
//   - event_type: "impression" | "click"
//   - reward_event_type: "valued" (real, payable) | "non_valued" (fraud /
//     fallback / unpaid traffic — must NOT be rewarded)
//   - Monetag offers no IP allowlist / HMAC on their side, so our own
//     `secret` query param is the only gate — keep it in the URL.
//
// Configure this exact URL as the Postback URL on every Monetag zone used
// (main SDK zone settings → Postback URL):
//
//   GET /functions/v1/monetag-postback
//     ?ymid={ymid}&event={event_type}&value={reward_event_type}&secret=<MONETAG_POSTBACK_SECRET>
//
// `ymid` is set client-side to the click_id returned by create_ad_view
// (show_XXX({ ymid })). credit_ad_view is idempotent per click_id, so it's
// safe if Monetag sends both an impression and a click postback for the
// same view — only the first one actually pays.
//
// Secrets: MONETAG_POSTBACK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
// Deploy:  supabase functions deploy monetag-postback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('MONETAG_POSTBACK_SECRET') ?? '';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE || !SECRET) {
    return new Response('not configured', { status: 500 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== SECRET) {
    return new Response('forbidden', { status: 401 });
  }

  const clickId = (url.searchParams.get('ymid') ?? '').trim();
  if (!isUuid(clickId)) {
    return new Response('bad ymid', { status: 400 });
  }

  const eventType = (url.searchParams.get('event') ?? '').trim();
  const rewardEventType = (url.searchParams.get('value') ?? '').trim();

  // Monetag's own fraud/validity verdict — "не начисляем, если проверка не
  // пройдена": non_valued (or an unrecognised value) never pays, no matter
  // what event_type it is.
  if (rewardEventType !== 'valued') {
    console.log('[monetag-postback] not valued, skipping:', { clickId, eventType, rewardEventType });
    return new Response('OK', { status: 200 }); // ack — nothing to retry
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('credit_ad_view', {
    p_click_id: clickId,
    p_network: 'monetag',
    p_network_ref: eventType || null,
  });
  if (error) {
    console.error('[monetag-postback]', error);
    return new Response('error', { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  console.log('[monetag-postback] settled:', { clickId, eventType, credited: row?.credited });
  return new Response('OK', { status: 200 });
});
