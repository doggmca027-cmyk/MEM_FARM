import WebApp from '@twa-dev/sdk';

type Inset = { top: number; bottom: number; left: number; right: number };

const REF_STORAGE_KEY = 'memefarm:referrer';
let referrerCode: string | null = null;

/**
 * Read `start_param` from the launch URL (Telegram deep link) and, when it
 * carries a `ref_<code>` prefix, remember the referrer's code so it can be
 * attached to the first Supabase sign-up. Falls back to a persisted value.
 */
export function captureReferrer(): void {
  try {
    const wa = WebApp as unknown as { initDataUnsafe?: { start_param?: string } };
    const raw = wa.initDataUnsafe?.start_param;
    if (raw && raw.startsWith('ref_') && raw.length > 4) {
      referrerCode = raw.slice(4);
      try {
        localStorage.setItem(REF_STORAGE_KEY, referrerCode);
      } catch {
        /* private mode */
      }
      return;
    }
  } catch {
    /* not in Telegram */
  }
  if (referrerCode == null) {
    try {
      referrerCode = localStorage.getItem(REF_STORAGE_KEY);
    } catch {
      referrerCode = null;
    }
  }
}

/** Referrer code captured from the deep link, or null. */
export function getReferrerCode(): string | null {
  if (referrerCode == null) captureReferrer();
  return referrerCode;
}

export interface TelegramUser {
  photoUrl: string | null;
  firstName: string | null;
  username: string | null;
}

/** The launching Telegram user's public fields (photo / name), all nullable. */
export function readTelegramUser(): TelegramUser {
  try {
    const wa = WebApp as unknown as {
      initDataUnsafe?: {
        user?: { photo_url?: string; first_name?: string; username?: string };
      };
    };
    const u = wa.initDataUnsafe?.user;
    return {
      photoUrl: u?.photo_url ?? null,
      firstName: u?.first_name ?? null,
      username: u?.username ?? null,
    };
  } catch {
    return { photoUrl: null, firstName: null, username: null };
  }
}

/**
 * Open the Telegram share sheet for an invite link. Uses the native
 * `openTelegramLink` inside Telegram, a new tab otherwise.
 */
export function openTelegramShare(url: string, text: string): void {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  try {
    const wa = WebApp as unknown as { openTelegramLink?: (u: string) => void };
    if (typeof wa.openTelegramLink === 'function') {
      wa.openTelegramLink(share);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(share, '_blank', 'noopener');
}

/** Open a t.me link (channel / chat) natively inside Telegram, else a new tab. */
export function openTelegramLink(url: string): void {
  try {
    const wa = WebApp as unknown as { openTelegramLink?: (u: string) => void };
    if (typeof wa.openTelegramLink === 'function') {
      wa.openTelegramLink(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
}

function applyInsets(inset: Partial<Inset> | undefined) {
  if (!inset) return;
  const root = document.documentElement.style;
  if (typeof inset.top === 'number') root.setProperty('--safe-top', `${inset.top}px`);
  if (typeof inset.bottom === 'number') root.setProperty('--safe-bottom', `${inset.bottom}px`);
}

/**
 * Boot the Telegram Mini App shell: mark ready, expand to full height,
 * lock theme colors, disable pull-to-close, and mirror the safe-area
 * insets into CSS vars (`--safe-top` / `--safe-bottom`). All guarded —
 * safe to call in a normal browser.
 */
export function initTelegram(): void {
  try {
    WebApp.ready();
    WebApp.expand();
    captureReferrer();

    if (typeof WebApp.setHeaderColor === 'function') WebApp.setHeaderColor('#120924');
    if (typeof WebApp.setBackgroundColor === 'function') WebApp.setBackgroundColor('#120924');

    // Bot API 7.7+ — optional chaining keeps older clients happy.
    WebApp.disableVerticalSwipes?.();

    const wa = WebApp as unknown as {
      contentSafeAreaInset?: Inset;
      safeAreaInset?: Inset;
      onEvent?: (e: string, cb: () => void) => void;
    };

    const sync = () => {
      const c = wa.contentSafeAreaInset;
      const s = wa.safeAreaInset;
      applyInsets({
        top: (s?.top ?? 0) + (c?.top ?? 0) || undefined,
        bottom: (s?.bottom ?? 0) + (c?.bottom ?? 0) || undefined,
      });
    };

    sync();
    wa.onEvent?.('safeAreaChanged', sync);
    wa.onEvent?.('contentSafeAreaChanged', sync);
  } catch (err) {
    console.warn('[telegram] running outside Telegram, init skipped:', err);
  }
}
