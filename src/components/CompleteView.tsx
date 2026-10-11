'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './I18nProvider';
import { peekReceipt } from '@/lib/client/receipt';

export default function CompleteView() {
  const { t } = useI18n();
  const [receipt, setReceiptState] = useState<{ reference: string } | null | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setReceiptState(peekReceipt());
  }, []);
  useEffect(() => { if (receipt !== undefined) heading.current?.focus(); }, [receipt]);
  if (receipt === undefined) return <div className="card complete-card" aria-busy="true" />;
  if (!receipt) {
    // 결과 없이 직접 들어온 경우: 등록 성공을 꾸며내지 않는다.
    return (
      <section className="card complete-card">
        <h2 ref={heading} tabIndex={-1}>{t('complete.none')}</h2>
        <p className="muted">{t('complete.noneBody')}</p>
        <div className="complete-actions">
          <Link href="/submit" className="btn btn--primary btn--block">{t('cta.write')}</Link>
          <Link href="/map" className="link-btn">{t('complete.toMap')}</Link>
        </div>
      </section>
    );
  }
  return (
    <section className="card complete-card" aria-labelledby="complete-title">
      <span className="complete-check" aria-hidden="true">✓</span>
      <h2 id="complete-title" ref={heading} tabIndex={-1}>{t('complete.title')}</h2>
      <p>{t('complete.body')}</p>
      <div className="reference-box">
        <span className="muted">{t('complete.reference')}</span>
        <strong className="reference">{receipt.reference}</strong>
        <span className="muted small">{t('complete.referenceNote')}</span>
      </div>
      <div className="complete-actions">
        <Link href="/map" className="btn btn--primary btn--block">{t('complete.toMap')} <span aria-hidden="true">→</span></Link>
        <Link href="/submit" className="link-btn">{t('complete.another')}</Link>
      </div>
    </section>
  );
}
