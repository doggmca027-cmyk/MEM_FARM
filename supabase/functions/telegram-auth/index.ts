// Supabase Edge Function — Telegram Mini App authentication.
//
// POST { initData: string, referrer_code?: string }
//   1. verifies the initData HMAC-SHA256 signature with BOT_TOKEN
//   2. finds / creates the matching Supabase Auth user (keyed by telegram_id)
//   3. binds the referral chain (bind_referrer) when a code is supplied
//   4. returns a Supabase session { access_token, refresh_token }
//
// Required secrets (supabase secrets set ...):
//   BOT_TOKEN                    – Telegram bot token from @BotFather
//   SUPABASE_URL                 – auto-injected
//   SUPABASE_ANON_KEY            – auto-injected
//   SUPABASE_SERVICE_ROLE_KEY    – auto-injected
//
// Deploy: supabase functions deploy telegram-auth --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Comma-separated Telegram IDs granted admin rights (re-checked every login). */
const ADMIN_IDS = new Set(
  (Deno.env.get('ADMIN_TELEGRAM_IDS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// initData is only as fresh as the user's last full Mini App launch — Telegram
// keeps it for the whole session (weeks on desktop). The HMAC already proves
// authenticity; auth_date is just a replay window, so keep it generous.
const AUTH_DATE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function hmacSha256(key: BufferSource, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validate the Telegram WebApp initData string.
 * Parsed manually (NOT via URLSearchParams — which turns "+" into a space and
 * would corrupt the check string). Per the spec: split on "&", split each on
 * the first "=", urldecode the value, drop `hash` (+ `signature`), sort by key,
 * join "key=value" with "\n", HMAC with a "WebAppData"-derived secret.
 */
async function verifyInitData(
  initData: string,
): Promise<{ user: string; authDate: number } | { error: string }> {
  let hash = '';
  const kv: Record<string, string> = {};
  for (const chunk of initData.split('&')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const key = chunk.slice(0, eq);
    let val: string;
    try {
      val = decodeURIComponent(chunk.slice(eq + 1));
    } catch {
      val = chunk.slice(eq + 1);
    }
    if (key === 'hash') { hash = val; continue; }
    if (key === 'signature') continue; // Ed25519 field — not in the HMAC check string
    kv[key] = val;
  }
  if (!hash) return { error: 'no hash in initData' };

  const dataCheckString = Object.keys(kv)
    .sort()
    .map((k) => `${k}=${kv[k]}`)
    .join('\n');

  // secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), BOT_TOKEN);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqual(computed, hash.toLowerCase())) {
    return { error: 'hash mismatch (bot token vs initData)' };
  }

  const authDate = Number(kv['auth_date'] ?? '0');
  if (!authDate) return { error: 'no auth_date' };
  const ageSec = Math.floor(Date.now() / 1000 - authDate);
  if (ageSec > AUTH_DATE_MAX_AGE_SEC) {
    return { error: `initData too old (${Math.floor(ageSec / 86400)}d) — relaunch the app` };
  }

  return { user: kv['user'] ?? '{}', authDate };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!BOT_TOKEN || !SERVICE_ROLE || !SUPABASE_URL) {
    return json({ error: 'edge function is not configured' }, 500);
  }

  let body: { initData?: string; referrer_code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const initData = (body.initData ?? '').trim();
  if (!initData) return json({ error: 'missing initData' }, 400);

  const verified = await verifyInitData(initData);
  if ('error' in verified) return json({ error: verified.error }, 401);

  let tgUser: { id?: number; username?: string; first_name?: string };
  try {
    tgUser = JSON.parse(verified.user);
  } catch {
    return json({ error: 'malformed user payload' }, 400);
  }

  const telegramId = Number(tgUser.id);
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    return json({ error: 'no telegram user' }, 400);
  }
  const username = tgUser.username ?? null;
  const firstName = tgUser.first_name ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Deterministic per-user credentials — computed from the bot token, never
  // leave the server. The email is a synthetic namespace, not a real inbox.
  const email = `tg_${telegramId}@telegram.memefarm`;
  const password = toHex(await hmacSha256(new TextEncoder().encode(BOT_TOKEN), `pw:${telegramId}`));

  // Locate the auth user via profiles.telegram_id (id === auth.users.id).
  const { data: prof } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  let userId = prof?.id as string | undefined;

  if (userId) {
    await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { telegram_id: telegramId, username, first_name: firstName },
    });
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { telegram_id: telegramId, username, first_name: firstName },
    });

    if (createErr || !created?.user) {
      // Auth user might already exist without a profile row — recover by email.
      const { data: list } = await admin.auth.admin.listUsers();
      const found = list?.users.find((u) => u.email === email);
      if (!found) {
        return json({ error: `could not create user: ${createErr?.message ?? 'unknown'}` }, 500);
      }
      userId = found.id;
      await admin.auth.admin.updateUserById(userId, { password });
    } else {
      userId = created.user.id;
    }
  }

  // Keep the profile fresh + (re)evaluate admin rights every login.
  const isAdmin = ADMIN_IDS.has(String(telegramId));
  await admin
    .from('profiles')
    .update({ username, first_name: firstName, is_admin: isAdmin })
    .eq('id', userId);

  // Refuse banned accounts.
  const { data: banRow } = await admin
    .from('profiles')
    .select('is_banned')
    .eq('id', userId)
    .maybeSingle();
  if (banRow?.is_banned) {
    return json({ error: 'account is banned' }, 403);
  }

  // Attach the referral chain — no-op if already bound or code unknown.
  const referrerCode = (body.referrer_code ?? '').trim();
  if (referrerCode) {
    await admin.rpc('bind_referrer', { p_user_id: userId, p_code: referrerCode });
  }

  // Mint a real session with the anon client.
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signIn.session) {
    return json({ error: `sign-in failed: ${signErr?.message ?? 'unknown'}` }, 500);
  }

  return json({
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
    expires_at: signIn.session.expires_at,
    user: { id: userId, telegram_id: telegramId, username, first_name: firstName, is_admin: isAdmin },
  });
});
