import uk from './locales/uk.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import kk from './locales/kk.json';
import id from './locales/id.json';
import es from './locales/es.json';
import tr from './locales/tr.json';
import ar from './locales/ar.json';
import fa from './locales/fa.json';

export type LangCode = 'uk' | 'en' | 'ru' | 'kk' | 'id' | 'es' | 'tr' | 'ar' | 'fa';

export interface LangMeta {
  code: LangCode;
  label: string;
  flag: string;
  rtl: boolean;
}

/** All supported languages, in switcher order. */
export const LANGS: LangMeta[] = [
  { code: 'uk', label: 'Українська', flag: '🇺🇦', rtl: false },
  { code: 'en', label: 'English', flag: '🇬🇧', rtl: false },
  { code: 'ru', label: 'Русский', flag: '🇷🇺', rtl: false },
  { code: 'kk', label: 'Қазақша', flag: '🇰🇿', rtl: false },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩', rtl: false },
  { code: 'es', label: 'Español', flag: '🇪🇸', rtl: false },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷', rtl: false },
  { code: 'ar', label: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'fa', label: 'فارسی', flag: '🇮🇷', rtl: true },
];

export const DEFAULT_LANG: LangCode = 'uk';
export const RTL_LANGS: LangCode[] = ['ar', 'fa'];

const STORAGE_KEY = 'memefarm:lang';

type Dict = Record<string, unknown>;
const DICTS: Record<LangCode, Dict> = { uk, en, ru, kk, id, es, tr, ar, fa };

export function isLang(v: unknown): v is LangCode {
  return typeof v === 'string' && LANGS.some((l) => l.code === v);
}

/** Persisted language, or the default. */
export function loadLang(): LangCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLang(v)) return v;
  } catch {
    /* private mode */
  }
  return DEFAULT_LANG;
}

export function saveLang(code: LangCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
}

function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Translate `key` for `lang`, falling back to Ukrainian, then the key itself. */
export function translate(
  lang: LangCode,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let out = lookup(DICTS[lang], key) ?? lookup(DICTS[DEFAULT_LANG], key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return out;
}

/** Set <html dir> + lang for the active language. */
export function applyDir(lang: LangCode): void {
  const rtl = RTL_LANGS.includes(lang);
  const el = document.documentElement;
  el.dir = rtl ? 'rtl' : 'ltr';
  el.lang = lang;
}
