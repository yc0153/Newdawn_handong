'use client';
import { useI18n } from './I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

export default function PageHero({ title, lead }: { title: MessageKey; lead: MessageKey }) {
  const { t } = useI18n();
  const area = process.env.NEXT_PUBLIC_AREA_LABEL;
  return (
    <div className="hero">
      <div>
        <p className="hero__eyebrow">{t('eyebrow')}</p>
        <h1 className="hero__title">{t(title)}</h1>
        <p className="hero__lead">{t(lead)}</p>
      </div>
      {area ? (
        <div className="hero__area">
          <span className="hero__area-label">{t('map.region')}</span>
          <strong>{area}</strong>
        </div>
      ) : null}
    </div>
  );
}
