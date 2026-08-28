import { useCallback } from 'react';
import { useGameStore } from '../store/useGameStore';
import { translate, type LangCode } from './index';

/** `t('farm.collect', { n: '1.00' })` bound to the active language. */
export function useT() {
  const lang = useGameStore((s) => s.lang);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
}

export function useLang(): LangCode {
  return useGameStore((s) => s.lang);
}
