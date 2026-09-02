// Supabase Edge Function — Telegram Bot webhook.
//
// Telegram POSTs every update here (set once via setWebhook). We only act on
// `/start [payload]`: reply with the welcome card + an inline button that opens
// the Mini App. A `ref_<code>` payload (from t.me/<bot>?start=ref_<code>) is
// forwarded into the app as ?startapp=ref_<code> so the referral survives.
//
// Secrets (supabase secrets set ...):
//   BOT_TOKEN                     – Telegram bot token
//   TG_WEBHOOK_SECRET             – matches setWebhook's secret_token
//   BOT_USERNAME                  – bot @username without @  (default MeM_FARMbot)
//   WELCOME_GIF_URL              – optional animation/GIF URL for the welcome card
//   COMMUNITY_URL / CHAT_URL     – optional extra inline buttons
//
// Deploy:  supabase functions deploy telegram-bot --no-verify-jwt
// Wire up: curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//            -d url=https://<ref>.supabase.co/functions/v1/telegram-bot \
//            -d secret_token=<TG_WEBHOOK_SECRET> \
//            -d 'allowed_updates=["message"]'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('TG_WEBHOOK_SECRET') ?? '';
const BOT_USERNAME = (Deno.env.get('BOT_USERNAME') ?? 'MeM_FARMbot').replace(/^@+/, '').trim();
const WELCOME_GIF_URL = (Deno.env.get('WELCOME_GIF_URL') ?? '').trim();
const COMMUNITY_URL = (Deno.env.get('COMMUNITY_URL') ?? '').trim();
const CHAT_URL = (Deno.env.get('CHAT_URL') ?? '').trim();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type Lang = 'uk' | 'ru' | 'en' | 'kk' | 'id' | 'es' | 'tr' | 'ar' | 'fa';

const COPY: Record<Lang, { text: string; play: string; community: string; chat: string }> = {
  uk: {
    text:
      '🧠 *Meme Farm — ферма мемів на TON*\n\n' +
      'Заводь свою мем-ферму: збирай GRAM щовісім годин, прокачуй карти, ' +
      'бийся в PvP на ставки й тягни друзів у реферальну мережу.\n\n' +
      'Тисни «Грати» — і поїхали! 🚜',
    play: '🚜 Грати',
    community: '📣 Спільнота',
    chat: '💬 Чат',
  },
  ru: {
    text:
      '🧠 *Meme Farm — ферма мемов на TON*\n\n' +
      'Заводи свою мем-ферму: собирай GRAM каждые восемь часов, прокачивай карты, ' +
      'дерись в PvP на ставки и веди друзей в реферальную сеть.\n\n' +
      'Жми «Играть» — погнали! 🚜',
    play: '🚜 Играть',
    community: '📣 Сообщество',
    chat: '💬 Чат',
  },
  en: {
    text:
      '🧠 *Meme Farm — a meme farm on TON*\n\n' +
      'Start your meme farm: harvest GRAM every eight hours, level up cards, ' +
      'fight wager PvP and pull friends into your referral network.\n\n' +
      'Hit “Play” and let’s go! 🚜',
    play: '🚜 Play',
    community: '📣 Community',
    chat: '💬 Chat',
  },
  kk: {
    text:
      '🧠 *Meme Farm — TON-дағы мем фермасы*\n\n' +
      'Өз мем-фермаңды баста: әр сегіз сағат сайын GRAM жина, карталарды соқ, ' +
      'ставкаға PvP ойна және достарыңды реферал желісіне тарт.\n\n' +
      '«Ойнау» батырмасын бас — кеттік! 🚜',
    play: '🚜 Ойнау',
    community: '📣 Қауымдастық',
    chat: '💬 Чат',
  },
  id: {
    text:
      '🧠 *Meme Farm — farm meme di TON*\n\n' +
      'Mulai meme farm-mu: panen GRAM tiap delapan jam, tingkatkan kartu, ' +
      'main PvP taruhan dan ajak teman ke jaringan referral.\n\n' +
      'Tekan «Main» — ayo! 🚜',
    play: '🚜 Main',
    community: '📣 Komunitas',
    chat: '💬 Chat',
  },
  es: {
    text:
      '🧠 *Meme Farm — una granja de memes en TON*\n\n' +
      'Empieza tu granja de memes: cosecha GRAM cada ocho horas, mejora cartas, ' +
      'juega PvP con apuestas y trae amigos a tu red de referidos.\n\n' +
      'Pulsa «Jugar» — ¡vamos! 🚜',
    play: '🚜 Jugar',
    community: '📣 Comunidad',
    chat: '💬 Chat',
  },
  tr: {
    text:
      '🧠 *Meme Farm — TON üzerinde meme çiftliği*\n\n' +
      'Meme çiftliğini kur: her sekiz saatte GRAM topla, kartları güçlendir, ' +
      'bahisli PvP oyna ve arkadaşlarını referans ağına çek.\n\n' +
      '«Oyna»ya bas — hadi! 🚜',
    play: '🚜 Oyna',
    community: '📣 Topluluk',
    chat: '💬 Sohbet',
  },
  ar: {
    text:
      '🧠 *Meme Farm — مزرعة ميمات على TON*\n\n' +
      'ابدأ مزرعة الميمات: اجمع GRAM كل ثماني ساعات، طوّر البطاقات، ' +
      'العب PvP بالرهانات وادعُ أصدقاءك إلى شبكة الإحالة.\n\n' +
      'اضغط «العب» — هيا بنا! 🚜',
    play: '🚜 العب',
    community: '📣 المجتمع',
    chat: '💬 الدردشة',
  },
  fa: {
    text:
      '🧠 *Meme Farm — مزرعهٔ میم روی TON*\n\n' +
      'مزرعهٔ میمت را شروع کن: هر هشت ساعت GRAM جمع کن، کارت‌ها را ارتقا بده، ' +
      'PvP شرطی بازی کن و دوستانت را به شبکهٔ معرفی بیاور.\n\n' +
      'روی «بازی» بزن — بزن بریم! 🚜',
    play: '🚜 بازی',
    community: '📣 انجمن',
    chat: '💬 چت',
  },
};

const KNOWN: Lang[] = ['uk', 'ru', 'en', 'kk', 'id', 'es', 'tr', 'ar', 'fa'];

function pickLang(code: unknown): Lang {
  const c = typeof code === 'string' ? code.slice(0, 2).toLowerCase() : '';
  if ((KNOWN as string[]).includes(c)) return c as Lang;
  if (c === 'be') return 'ru';
  return 'en';
}

/** The app language the user picked (profiles.notif_prefs.lang), by telegram id. */
async function storedLang(telegramId: number): Promise<Lang | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data } = await db
      .from('profiles')
      .select('notif_prefs')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    const l = (data?.notif_prefs as { lang?: string } | null)?.lang;
    return l && (KNOWN as string[]).includes(l) ? (l as Lang) : null;
  } catch {
    return null;
  }
}

/** `ref_ABC123` → validated code, else ''. */
function parseRef(payload: string): string {
  const m = payload.trim().match(/^ref_([A-Za-z0-9_-]{2,32})$/);
  return m ? m[1] : '';
}

async function tg(method: string, body: unknown): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* Telegram retries on non-200; a transient send failure is fine */
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!BOT_TOKEN) return new Response('not configured', { status: 500 });

  // Reject anything that isn't Telegram calling with the shared secret.
  if (
    WEBHOOK_SECRET &&
    req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET
  ) {
    return new Response('forbidden', { status: 401 });
  }

  let update: {
    message?: {
      chat?: { id?: number };
      text?: string;
      from?: { id?: number; language_code?: string };
    };
  };
  try {
    update = await req.json();
  } catch {
    return new Response('ok'); // ack malformed updates so Telegram stops retrying
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text ?? '').trim();

  // Only react to /start (optionally "/start <payload>"); ack everything else.
  if (chatId && /^\/start(@\w+)?(\s|$)/.test(text)) {
    const payload = text.replace(/^\/start(@\w+)?\s*/, '');
    const ref = parseRef(payload);
    const startApp = ref
      ? `https://t.me/${BOT_USERNAME}?startapp=ref_${ref}`
      : `https://t.me/${BOT_USERNAME}?startapp`;

    // prefer the language the user picked inside the app; fall back to their
    // Telegram client language for first-time contacts (no profile yet)
    const fromId = Number(msg?.from?.id);
    const lang =
      (Number.isFinite(fromId) && fromId > 0 ? await storedLang(fromId) : null) ??
      pickLang(msg?.from?.language_code);
    const c = COPY[lang];
    const rows: { text: string; url: string }[][] = [[{ text: c.play, url: startApp }]];
    const extra: { text: string; url: string }[] = [];
    if (COMMUNITY_URL) extra.push({ text: c.community, url: COMMUNITY_URL });
    if (CHAT_URL) extra.push({ text: c.chat, url: CHAT_URL });
    if (extra.length) rows.push(extra);

    const reply_markup = { inline_keyboard: rows };

    if (WELCOME_GIF_URL) {
      await tg('sendAnimation', {
        chat_id: chatId,
        animation: WELCOME_GIF_URL,
        caption: c.text,
        parse_mode: 'Markdown',
        reply_markup,
      });
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        text: c.text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup,
      });
    }
  }

  return new Response('ok');
});
