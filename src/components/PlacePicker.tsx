'use client';
import { useI18n } from './I18nProvider';
import type { AddressItem } from '@/lib/map/kakaoPlaces';

export type AddressList = { status: 'loading' | 'ready' | 'error'; items: AddressItem[] };

/** 지도에서 누른 곳 주변 상세주소 목록과 검색. 고른 주소는 로드뷰로 이어진다. */
export default function PlacePicker(props: {
  list: AddressList;
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onSelect: (item: AddressItem) => void;
  onSkip: () => void;
  isAllowed: (item: AddressItem) => boolean;
  selectedId?: string | null;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const { t } = useI18n();
  const { list } = props;
  return (
    <div className="place-picker">
      <h2 id="panel-heading" tabIndex={-1} ref={props.headingRef}>{t('place.heading')}</h2>
      <p className="muted small">{t('place.lead')}</p>
      <form className="place-search" role="search" onSubmit={(e) => { e.preventDefault(); props.onSearch(); }}>
        <label htmlFor="place-q" className="visually-hidden">{t('place.searchLabel')}</label>
        <input id="place-q" type="search" value={props.query} placeholder={t('place.searchPlaceholder')} onChange={(e) => props.onQuery(e.target.value)} autoComplete="off" />
        <button type="submit" className="place-search__btn" aria-label={t('place.search')}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </form>
      <div className="addr-head" aria-hidden="true"><span>{t('place.address')}</span><span>{t('place.zip')}</span></div>
      {list.status === 'loading' ? <p className="state" role="status" aria-busy="true">{t('place.loading')}</p> : null}
      {list.status === 'error' ? <p className="state state--warn" role="status">{t('place.error')}</p> : null}
      {list.status === 'ready' && list.items.length === 0 ? <p className="state state--empty" role="status">{t('place.empty')}</p> : null}
      {list.items.length > 0 ? (
        <ul className="addr-list" aria-busy={list.status === 'loading'}>
          {list.items.map((it) => {
            const ok = props.isAllowed(it);
            return (
              <li key={it.id}>
                <button type="button" className={`addr-item${props.selectedId === it.id ? ' addr-item--on' : ''}`} onClick={() => props.onSelect(it)} disabled={!ok} aria-pressed={props.selectedId === it.id}>
                  <span className="addr-item__main">
                    {it.name ? <strong className="addr-item__name">{it.name}</strong> : null}
                    {it.road ? <span className="addr-line"><span className="addr-badge addr-badge--road">{t('place.road')}</span><span>{it.road}</span></span> : null}
                    {it.jibun ? <span className="addr-line"><span className="addr-badge">{t('place.jibun')}</span><span>{it.jibun}</span></span> : null}
                    {!ok ? <span className="addr-item__out">{t('place.outside')}</span> : null}
                  </span>
                  <span className="addr-item__zip">{it.zip ?? '–'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <button type="button" className="link-btn place-skip" onClick={props.onSkip}>{t('place.skip')}</button>
      <p className="hint">{t('place.savedNote')}</p>
    </div>
  );
}
