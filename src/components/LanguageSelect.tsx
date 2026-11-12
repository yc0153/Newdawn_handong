'use client';
import { useI18n } from './I18nProvider';
import { LANGS, type Lang } from '@/lib/i18n/langs';

/** 화면 언어 고르기(15개 언어). 언어 이름은 그 언어로 쓴 이름이라 바꾸지 않는다. */
export default function LanguageSelect({ variant = 'header' }: { variant?: 'header' | 'player' }) {
  const { t, lang, setLang } = useI18n();
  return (
    <span className={`lang-select lang-select--${variant}`}>
      <svg className="lang-select__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9s1.2-6.4 3.8-9z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <select id={`lang-${variant}`} className="lang-select__control" value={lang} aria-label={t('nav.language')} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
      </select>
    </span>
  );
}
