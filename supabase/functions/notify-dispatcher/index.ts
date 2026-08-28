// Supabase Edge Function — Telegram push notification dispatcher.
//
// Two modes:
//   1. CRON   — GET, or POST {}/{"mode":"cron"}. Drains `event_queue` and scans
//               `farm_states` for freshly-ready farms, sends messages, logs.
//   2. EVENT  — POST { type, telegram_id, metadata }. Sends one message.
//
// Gate: if NOTIFY_SECRET is set, requests must carry `x-notify-secret: <secret>`
//       or `Authorization: Bearer <secret>`.
//
// Secrets:
//   BOT_TOKEN                  – Telegram bot token
//   NOTIFY_SECRET             – shared secret protecting this endpoint
//   BOT_USERNAME              – bot @username (no @); inline button opens its Mini App
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – auto-injected
//
// Schedule (SQL, pg_cron):
//   select cron.schedule('notify', '*/5 * * * *',
//     $$ select net.http_post(
//          url := '<project>/functions/v1/notify-dispatcher',
//          headers := jsonb_build_object('x-notify-secret', '<secret>')) $$);
//
// Deploy: supabase functions deploy notify-dispatcher --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET') ?? '';
// Inline-button target — ALWAYS the bot's own Mini App via the `startapp` deep
// link. Never a t.me channel / group (that was the old bug: a stale TMA_URL
// pointed the button at a public channel). Built purely from the bot username.
const BOT_USERNAME = (Deno.env.get('BOT_USERNAME') ?? 'MeM_FARMbot').replace(/^@+/, '').trim();
const TMA_URL = `https://t.me/${BOT_USERNAME}?startapp`;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type NotifType = 'FARM_READY' | 'PVP_ATTACK' | 'REFERRAL_INCOME' | 'DEPOSIT';

const PREF_KEY: Record<NotifType, string> = {
  FARM_READY: 'farm_ready',
  PVP_ATTACK: 'pvp_attack',
  REFERRAL_INCOME: 'referral_income',
  DEPOSIT: 'deposit',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authorized(req: Request): boolean {
  if (!NOTIFY_SECRET) return true; // not configured → open (dev)
  const header =
    req.headers.get('x-notify-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return header === NOTIFY_SECRET;
}

function prefsAllow(prefs: Record<string, unknown> | null, type: NotifType): boolean {
  return prefs?.[PREF_KEY[type]] !== false;
}

type Lang = 'uk' | 'en' | 'ru' | 'kk' | 'id' | 'es' | 'tr' | 'ar' | 'fa';

/** Per-language push templates. `{amount}` / `{level}` are interpolated. Missing langs fall back to `uk`. */
const TEMPLATES: Record<Lang, Record<NotifType, { text: string; button: string }>> = {
  uk: {
    DEPOSIT: {
      text: '💎 *Депозит зараховано!*\n\nНа ваш баланс успішно зараховано +{amount} GRAM.',
      button: '💎 Відкрити',
    },
    FARM_READY: {
      text: '🌾 *Твоя ферма готова до збору!*\n\nНакопичено максимум GRAM. Заходь забрати свій прибуток!',
      button: '🌾 Забрати',
    },
    REFERRAL_INCOME: {
      text: '💸 *Реферальний дохід!*\n\nТобі нараховано `{amount}` GRAM (L{level}). Забери на вкладці «Frens».',
      button: '💸 Відкрити',
    },
    PVP_ATTACK: {
      text: '⚔️ *На тебе напали в рейді!*\n\nСуперник переміг у набігу. Час на реванш!',
      button: '⚔️ У бій',
    },
  },
  en: {
    DEPOSIT: {
      text: '💎 *Deposit credited!*\n\n+{amount} GRAM has been added to your balance.',
      button: '💎 Open',
    },
    FARM_READY: {
      text: '🌾 *Your farm is ready to harvest!*\n\nGRAM has maxed out. Come claim your income!',
      button: '🌾 Claim',
    },
    REFERRAL_INCOME: {
      text: '💸 *Referral income!*\n\nYou earned `{amount}` GRAM (L{level}). Claim it on the “Frens” tab.',
      button: '💸 Open',
    },
    PVP_ATTACK: {
      text: '⚔️ *You were raided!*\n\nAn opponent beat you in a raid. Time for a rematch!',
      button: '⚔️ Fight',
    },
  },
  ru: {
    DEPOSIT: {
      text: '💎 *Депозит зачислен!*\n\nНа ваш баланс зачислено +{amount} GRAM.',
      button: '💎 Открыть',
    },
    FARM_READY: {
      text: '🌾 *Твоя ферма готова к сбору!*\n\nНакопился максимум GRAM. Заходи забрать доход!',
      button: '🌾 Забрать',
    },
    REFERRAL_INCOME: {
      text: '💸 *Реферальный доход!*\n\nТебе начислено `{amount}` GRAM (L{level}). Забери на вкладке «Frens».',
      button: '💸 Открыть',
    },
    PVP_ATTACK: {
      text: '⚔️ *На тебя напали в рейде!*\n\nСоперник победил в набеге. Время для реванша!',
      button: '⚔️ В бой',
    },
  },
  kk: {
    DEPOSIT: {
      text: '💎 *Депозит есептелді!*\n\nБалансыңызға +{amount} GRAM қосылды.',
      button: '💎 Ашу',
    },
    FARM_READY: {
      text: '🌾 *Фермаң жинауға дайын!*\n\nGRAM максимумға жетті. Кіріп табысыңды ал!',
      button: '🌾 Жинау',
    },
    REFERRAL_INCOME: {
      text: '💸 *Реферал табысы!*\n\nСаған `{amount}` GRAM (L{level}) есептелді. «Frens» қойындысынан ал.',
      button: '💸 Ашу',
    },
    PVP_ATTACK: {
      text: '⚔️ *Рейдте саған шабуыл жасалды!*\n\nҚарсылас жеңіп кетті. Реванш кезі!',
      button: '⚔️ Шайқасқа',
    },
  },
  id: {
    DEPOSIT: {
      text: '💎 *Deposit masuk!*\n\n+{amount} GRAM telah ditambahkan ke saldo Anda.',
      button: '💎 Buka',
    },
    FARM_READY: {
      text: '🌾 *Farm kamu siap dipanen!*\n\nGRAM sudah maksimal. Ambil pendapatanmu!',
      button: '🌾 Ambil',
    },
    REFERRAL_INCOME: {
      text: '💸 *Pendapatan referral!*\n\nKamu memperoleh `{amount}` GRAM (L{level}). Ambil di tab “Frens”.',
      button: '💸 Buka',
    },
    PVP_ATTACK: {
      text: '⚔️ *Kamu diserang di raid!*\n\nLawan mengalahkanmu. Saatnya tanding ulang!',
      button: '⚔️ Bertarung',
    },
  },
  es: {
    DEPOSIT: {
      text: '💎 *¡Depósito acreditado!*\n\nSe han añadido +{amount} GRAM a tu saldo.',
      button: '💎 Abrir',
    },
    FARM_READY: {
      text: '🌾 *¡Tu granja está lista para cosechar!*\n\nEl GRAM llegó al máximo. ¡Ven a reclamar tus ingresos!',
      button: '🌾 Reclamar',
    },
    REFERRAL_INCOME: {
      text: '💸 *¡Ingresos por referidos!*\n\nGanaste `{amount}` GRAM (L{level}). Reclámalos en la pestaña «Frens».',
      button: '💸 Abrir',
    },
    PVP_ATTACK: {
      text: '⚔️ *¡Te asaltaron en un raid!*\n\nUn rival te venció. ¡Hora de la revancha!',
      button: '⚔️ Luchar',
    },
  },
  tr: {
    DEPOSIT: {
      text: '💎 *Depozito yatırıldı!*\n\nBakiyene +{amount} GRAM eklendi.',
      button: '💎 Aç',
    },
    FARM_READY: {
      text: '🌾 *Çiftliğin hasada hazır!*\n\nGRAM maksimuma ulaştı. Gel gelirini al!',
      button: '🌾 Al',
    },
    REFERRAL_INCOME: {
      text: '💸 *Referans geliri!*\n\n`{amount}` GRAM (L{level}) kazandın. “Frens” sekmesinden al.',
      button: '💸 Aç',
    },
    PVP_ATTACK: {
      text: '⚔️ *Bir akında saldırıya uğradın!*\n\nBir rakip seni yendi. Rövanş zamanı!',
      button: '⚔️ Savaş',
    },
  },
  ar: {
    DEPOSIT: {
      text: '💎 *تم إضافة الإيداع!*\n\nتمت إضافة +{amount} GRAM إلى رصيدك.',
      button: '💎 فتح',
    },
    FARM_READY: {
      text: '🌾 *مزرعتك جاهزة للحصاد!*\n\nبلغ GRAM حدّه الأقصى. تعال واستلم دخلك!',
      button: '🌾 استلام',
    },
    REFERRAL_INCOME: {
      text: '💸 *دخل الإحالة!*\n\nحصلت على `{amount}` GRAM (المستوى {level}). استلمه من تبويب «Frens».',
      button: '💸 فتح',
    },
    PVP_ATTACK: {
      text: '⚔️ *تعرّضت لهجوم في الغارة!*\n\nهزمك خصم في غارة. حان وقت الثأر!',
      button: '⚔️ قتال',
    },
  },
  fa: {
    DEPOSIT: {
      text: '💎 *واریز ثبت شد!*\n\n+{amount} GRAM به موجودی شما اضافه شد.',
      button: '💎 باز کردن',
    },
    FARM_READY: {
      text: '🌾 *مزرعه‌ات آمادهٔ برداشت است!*\n\nGRAM به سقف رسید. بیا و درآمدت را بگیر!',
      button: '🌾 دریافت',
    },
    REFERRAL_INCOME: {
      text: '💸 *درآمد معرفی!*\n\n`{amount}` GRAM (سطح {level}) کسب کردی. از تب «Frens» دریافت کن.',
      button: '💸 باز کردن',
    },
    PVP_ATTACK: {
      text: '⚔️ *در یک یورش به تو حمله شد!*\n\nحریفی تو را شکست داد. وقت انتقام است!',
      button: '⚔️ نبرد',
    },
  },
};

function pickLang(v: unknown): Lang {
  return typeof v === 'string' && v in TEMPLATES ? (v as Lang) : 'uk';
}

function buildMessage(
  type: NotifType,
  meta: Record<string, unknown>,
  lang: Lang = 'uk',
): { text: string; button: string } {
  const tpl = TEMPLATES[lang]?.[type] ?? TEMPLATES.uk[type];
  const text = tpl.text
    .replace(/\{amount\}/g, String(meta.amount ?? '?'))
    .replace(/\{level\}/g, String(meta.level ?? '?'));
  return { text, button: tpl.button };
}

async function sendTelegram(chatId: number | string, text: string, button: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: button, url: TMA_URL }]] },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'not configured' }, 500);
  }
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { mode?: string; type?: NotifType; telegram_id?: number; metadata?: Record<string, unknown> } = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  // ---------- EVENT MODE ----------
  if (body.type && body.telegram_id) {
    const meta = body.metadata ?? {};
    const { text, button } = buildMessage(body.type, meta, pickLang(meta.lang));
    const ok = await sendTelegram(body.telegram_id, text, button);
    return json({ mode: 'event', sent: ok });
  }

  // ---------- CRON MODE ----------
  let processed = 0;
  let farmNotified = 0;
  let failed = 0;

  // 1. drain the event queue
  const { data: events } = await db
    .from('event_queue')
    .select('id, user_id, type, metadata, profiles!inner(telegram_id, notif_prefs)')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  for (const e of events ?? []) {
    const prof = (e as Record<string, unknown>).profiles as { telegram_id: number | null; notif_prefs: Record<string, unknown> } | null;
    const type = (e as Record<string, unknown>).type as NotifType;
    const uid = (e as Record<string, unknown>).user_id as string;
    let ok = false;

    if (prof?.telegram_id && prefsAllow(prof.notif_prefs, type)) {
      const meta = ((e as Record<string, unknown>).metadata as Record<string, unknown>) ?? {};
      const lang = pickLang(meta.lang ?? prof.notif_prefs?.lang);
      const { text, button } = buildMessage(type, meta, lang);
      ok = await sendTelegram(prof.telegram_id, text, button);
      await db.from('notification_logs').insert({ user_id: uid, type, status: ok ? 'SENT' : 'FAILED' });
      if (ok) processed += 1;
      else failed += 1;
    }
    await db.from('event_queue').update({ processed_at: new Date().toISOString() }).eq('id', (e as Record<string, unknown>).id);
  }

  // 2. farm-ready scan
  const { data: farms } = await db
    .from('farm_states')
    .select('user_id, profiles!inner(telegram_id, notif_prefs)')
    .lte('next_claim_at', new Date().toISOString())
    .eq('is_claim_notified', false)
    .limit(500);

  for (const f of farms ?? []) {
    const prof = (f as Record<string, unknown>).profiles as { telegram_id: number | null; notif_prefs: Record<string, unknown> } | null;
    const uid = (f as Record<string, unknown>).user_id as string;

    if (prof?.telegram_id && prefsAllow(prof.notif_prefs, 'FARM_READY')) {
      const { text, button } = buildMessage('FARM_READY', {}, pickLang(prof.notif_prefs?.lang));
      const ok = await sendTelegram(prof.telegram_id, text, button);
      await db.from('notification_logs').insert({ user_id: uid, type: 'FARM_READY', status: ok ? 'SENT' : 'FAILED' });
      if (ok) farmNotified += 1;
      else failed += 1;
    }
    // flip the flag regardless so the farm isn't rescanned every tick
    await db.from('farm_states').update({ is_claim_notified: true }).eq('user_id', uid);
  }

  return json({ mode: 'cron', processed, farm_notified: farmNotified, failed });
});
