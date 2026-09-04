// Supabase Edge Function — Monetag rewarded-interstitial postback.
//
// ⚠️ The `ymid` query param name below is the client-side passthrough param
// (confirmed: show_XXX({ ymid: '<click_id>' })). Monetag's *postback* URL
// macro for echoing it back may use a different literal name — check the
// exact macro in your Monetag dashboard → Postbacks → "Macro Reference"
// before wiring the real URL, and adjust MACRO_PARAM if needed.
//
//   GET /functions/v1/monetag-postback?ymid={ymid}&secret=<MONETAG_POSTBACK_SECRET>
//
// `ymid` must be set (client-side) to the click_id returned by create_ad_view.
//
// Secrets: MONETAG_POSTBACK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
// Deploy:  supabase functions deploy monetag-postback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('MONETAG_POSTBACK_SECRET') ?? '';
const MACRO_PARAM = 'ymid';

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

  const clickId = (url.searchParams.get(MACRO_PARAM) ?? '').trim();
  if (!isUuid(clickId)) {
    return new Response('bad ' + MACRO_PARAM, { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await db.rpc('credit_ad_view', {
    p_click_id: clickId,
    p_network: 'monetag',
    p_network_ref: url.searchParams.get('reward_event_type') ?? null,
  });
  if (error) {
    console.error('[monetag-postback]', error);
    return new Response('error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
});
