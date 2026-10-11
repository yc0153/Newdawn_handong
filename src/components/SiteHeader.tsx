'use client';
import Link from 'next/link';
import { useI18n } from './I18nProvider';

export const LIP_URL = 'https://lip.center';

export default function SiteHeader({ active }: { active: 'map' | 'submit' | 'none' }) {
  const { t, lang, setLang } = useI18n();
  const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL;
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/map" className="brand">
          <span className="brand__mark" aria-hidden="true">P</span>
          <span className="brand__text">
            <span className="brand__title">{t('site.title')}</span>
            <span className="brand__sub">{t('site.subtitle')}</span>
          </span>
        </Link>
        {envLabel ? <span className="env-badge" title={t('env.badge')}>{envLabel}</span> : null}
        <nav className="site-nav" aria-label={t('nav.main')}>
          <Link href="/map" className="site-nav__link" aria-current={active === 'map' ? 'page' : undefined}>{t('nav.map')}</Link>
          <Link href="/submit" className="site-nav__link" aria-current={active === 'submit' ? 'page' : undefined}>{t('nav.submit')}</Link>
          <a href="/player" target="_blank" rel="noopener" className="site-nav__link site-nav__link--ext">{t('nav.player')}<span aria-hidden="true"> ↗</span></a>
          <button type="button" className="lang-toggle" lang={lang === 'ko' ? 'en' : 'ko'} aria-label={t('nav.langLabel')} onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>
            {t('nav.lang')}
          </button>
          <a href={LIP_URL} className="site-nav__link site-nav__link--ext">{t('nav.lip')}<span aria-hidden="true"> ↗</span></a>
        </nav>
      </div>
    </header>
  );
}
