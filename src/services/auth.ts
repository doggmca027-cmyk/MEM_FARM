import WebApp from '@twa-dev/sdk';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getReferrerCode } from '../telegram/telegram';

const FN_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/telegram-auth`
  : '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let inFlight: Promise<boolean> | null = null;

/** Last authentication outcome — surfaced in Settings for debugging. */
export let lastAuthError: string | null = null;

/**
 * Exchange the Telegram `initData` for a Supabase session via the
 * `telegram-auth` Edge Function, then install it on the client so the store
 * can switch to `live` mode.
 *
 * Returns `true` when a session is active. No-ops (returns `false`) when
 * Supabase isn't configured or the app isn't running inside Telegram.
 */
export function authenticateWithTelegram(): Promise<boolean> {
  if (!inFlight) inFlight = run();
  return inFlight;
}

async function run(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !FN_URL) {
    lastAuthError = 'supabase not configured';
    return false;
  }

  let initData = '';
  try {
    initData = WebApp.initData ?? '';
  } catch {
    initData = '';
  }
  if (!initData) {
    lastAuthError = 'no initData (not launched inside Telegram)';
    return false;
  }

  // Already signed in (persisted session)?
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) {
    lastAuthError = null;
    return true;
  }

  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ initData, referrer_code: getReferrerCode() ?? undefined }),
    });

    if (!res.ok) {
      const txt = await safeText(res);
      lastAuthError = `telegram-auth ${res.status}: ${txt.slice(0, 1400)}`;
      console.warn('[auth]', lastAuthError);
      return false;
    }

    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) {
      lastAuthError = 'telegram-auth: no tokens in response';
      return false;
    }

    const { error } = await supabase.auth.setSession({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
    });
    if (error) {
      lastAuthError = `setSession: ${error.message}`;
      console.warn('[auth]', lastAuthError);
      return false;
    }
    lastAuthError = null;
    return true;
  } catch (err) {
    lastAuthError = `telegram-auth error: ${String(err).slice(0, 120)}`;
    console.warn('[auth]', lastAuthError);
    return false;
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return '';
  }
}
