'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { format, messages, type Lang, type MessageKey } from '@/lib/i18n/messages';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: MessageKey, v?: Record<string, string | number>) => string };
const I18nContext = createContext<Ctx | null>(null);
const STORAGE_KEY = 'pohang-ui-lang';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ko') setLangState(saved);
    } catch { /* storage unavailable: keep Korean */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: (k, v) => format(messages[lang][k], v),
  }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nProvider missing');
  return ctx;
}
