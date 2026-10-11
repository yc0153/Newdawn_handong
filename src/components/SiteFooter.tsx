'use client';
import { useI18n } from './I18nProvider';
export default function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <span>{t('footer.note')}</span>
      <span>{t('footer.anon')}</span>
    </footer>
  );
}
