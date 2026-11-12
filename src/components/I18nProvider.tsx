'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { format, messages, type MessageKey } from '@/lib/i18n/messages';
import { RTL_LANGS, htmlLang, normalizeLang, type Lang } from '@/lib/i18n/langs';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: MessageKey, v?: Record<string, string | number>) => string };
const I18nContext = createContext<Ctx | null>(null);
const STORAGE_KEY = 'pohang-ui-lang';
// 다른 사이트(lip.center 등)에서 언어를 넘겨받는 주소 값: ?lang=vi (locale·hl도 받음)
const PARAMS = ['lang', 'locale', 'hl'];

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko');
  useEffect(() => {
    let fromUrl: Lang | null = null;
    try {
      const q = new URLSearchParams(window.location.search);
      for (const p of PARAMS) { fromUrl = normalizeLang(q.get(p)); if (fromUrl) break; }
    } catch { /* ignore */ }
    if (fromUrl) {
      setLangState(fromUrl);
      try { window.localStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* ignore */ }
      return;
    }
    try {
      const saved = normalizeLang(window.localStorage.getItem(STORAGE_KEY));
      if (saved) setLangState(saved);
    } catch { /* storage unavailable: keep Korean */ }
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = htmlLang(lang);
    root.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: (k, v) => format(messages[lang][k] ?? messages.en[k], v),
  }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nProvider missing');
  return ctx;
}
