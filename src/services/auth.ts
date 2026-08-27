import WebApp from '@twa-dev/sdk';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getReferrerCode } from '../telegram/telegram';

const FN_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/telegram-auth`
  : '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let inFlight: Promise<boolean> | null = null;

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
  if (!isSupabaseConfigured || !supabase || !FN_URL) return false;

  let initData = '';
  try {
    initData = WebApp.initData ?? '';
  } catch {
    initData = '';
  }
  if (!initData) return false; // launched outside Telegram

  // Already signed in (persisted session)?
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return true;

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
      console.warn('[auth] telegram-auth rejected:', res.status, await safeText(res));
      return false;
    }

    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) return false;

    const { error } = await supabase.auth.setSession({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
    });
    if (error) {
      console.warn('[auth] setSession failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[auth] telegram-auth error:', err);
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
