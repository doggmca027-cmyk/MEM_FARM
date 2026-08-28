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
 * Validate the Telegram WebApp initData string against every scheme any
 * Telegram client (old Login-Widget style, current WebApp style, desktop
 * quirks) has ever used. Accepts if ANY combination reproduces `hash`:
 *   parse:  decoded values | raw values
 *   fields: drop hash+signature | drop only hash
 *   secret: HMAC_SHA256("WebAppData", token) | SHA256(token)
 */
async function verifyInitData(
  initData: string,
): Promise<{ user: string; authDate: number } | { error: string; debug?: unknown }> {
  // split once; keep both a decoded and a raw view of every value
  let hash = '';
  const dec: Record<string, string> = {};
  const raw: Record<string, string> = {};
  for (const chunk of initData.split('&')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const key = chunk.slice(0, eq);
    const rv = chunk.slice(eq + 1);
    let dv: string;
    try {
      dv = decodeURIComponent(rv);
    } catch {
      dv = rv;
    }
    if (key === 'hash') { hash = dv; continue; }
    dec[key] = dv;
    raw[key] = rv;
  }
  if (!hash) return { error: 'no hash in initData', debug: { raw: initData.slice(0, 80) } };
  const want = hash.toLowerCase();

  const secretWebApp = await hmacSha256(new TextEncoder().encode('WebAppData'), BOT_TOKEN);
  const secretLogin = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOT_TOKEN)),
  );

  const build = (src: Record<string, string>, dropSig: boolean) =>
    Object.keys(src)
      .filter((k) => (dropSig ? k !== 'signature' : true))
      .sort()
      .map((k) => `${k}=${src[k]}`)
      .join('\n');

  let matched = false;
  const tried: string[] = [];
  for (const [pName, src] of [['dec', dec], ['raw', raw]] as const) {
    for (const dropSig of [true, false]) {
      const dcs = build(src, dropSig);
      for (const [sName, secret] of [['webapp', secretWebApp], ['login', secretLogin]] as const) {
        const got = toHex(await hmacSha256(secret, dcs));
        tried.push(`${pName}/${dropSig ? 'noSig' : 'sig'}/${sName}=${got.slice(0, 8)}`);
        if (timingSafeEqual(got, want)) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) break;
  }

  if (!matched) {
    return {
      error: 'hash mismatch (bot token vs initData)',
      debug: {
        keys: Object.keys(dec).sort(),
        recv: want.slice(0, 10),
        tried,
        botId: BOT_TOKEN.split(':')[0],
        // full string so it can be verified offline — contains only the
        // caller's own Telegram user object (id / name), nothing secret.
        initData,
      },
    };
  }

  const authDate = Number(dec['auth_date'] ?? '0');
  if (!authDate) return { error: 'no auth_date' };
  const ageSec = Math.floor(Date.now() / 1000 - authDate);
  if (ageSec > AUTH_DATE_MAX_AGE_SEC) {
    return { error: `initData too old (${Math.floor(ageSec / 86400)}d) — relaunch the app` };
  }

  return { user: dec['user'] ?? '{}', authDate };
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
  if ('error' in verified) {
    return json({ error: verified.error, debug: verified.debug }, 401);
  }

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
