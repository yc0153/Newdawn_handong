'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './I18nProvider';
import type { Kakao } from '@/lib/map/kakao';
import type { AddressItem } from '@/lib/map/kakaoPlaces';

/**
 * 고른 주소의 카카오 로드뷰. 가운데 고정 핀에 장면을 맞춘 뒤 '핀 꽂기'로 확정한다.
 * 로드뷰 방향·좌표는 저장하지 않는다(장소 확인용).
 */
export default function RoadviewPane(props: {
  kakao: Kakao;
  item: AddressItem;
  pinned: boolean;
  onPin: () => void;
  onRepin: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none'>('loading');
  const { kakao, item } = props;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    setStatus('loading');
    const rv = new kakao.maps.Roadview(node);
    const client = new kakao.maps.RoadviewClient();
    const pos = new kakao.maps.LatLng(item.lat, item.lon);
    client.getNearestPanoId(pos, 60, (panoId: number | null) => {
      if (cancelled) return;
      if (panoId === null || panoId === undefined) { setStatus('none'); return; }
      rv.setPanoId(panoId, pos);
      setStatus('ready');
    });
    const ro = new ResizeObserver(() => rv.relayout?.());
    ro.observe(node);
    return () => { cancelled = true; ro.disconnect(); node.replaceChildren(); };
  }, [kakao, item]);

  const place = item.name ?? item.road ?? item.jibun;
  return (
    <div className="roadview" role="region" aria-label={t('rv.mapAria')}>
      <div className="roadview__head">
        <span className="roadview__title"><span className="eyebrow-dot" aria-hidden="true" />{t('rv.title')} · <strong>{place}</strong></span>
        <button type="button" className="btn btn--small" onClick={props.onBack}>{t('rv.backToMap')}</button>
      </div>
      <div className="roadview__stage">
        <div ref={el} className="roadview__view" />
        {status === 'ready' ? (
          <span className={`roadview__pin${props.pinned ? ' roadview__pin--set' : ''}`} aria-hidden="true">
            <span className="pin pin--other"><span className="pin__n">+</span></span>
          </span>
        ) : null}
        {status === 'loading' ? <p className="roadview__msg" role="status">{t('rv.loading')}</p> : null}
        {status === 'none' ? <p className="roadview__msg" role="status">{t('rv.none')}</p> : null}
      </div>
      <div className="roadview__foot">
        {status === 'ready' && !props.pinned ? (
          <>
            <span className="muted small">{t('rv.aim')}</span>
            <button type="button" className="btn btn--primary" onClick={props.onPin}>{t('rv.pin')} <span aria-hidden="true">→</span></button>
          </>
        ) : null}
        {status === 'ready' && props.pinned ? (
          <>
            <span className="roadview__ok" role="status">{t('rv.pinned')}</span>
            <button type="button" className="btn btn--small" onClick={props.onRepin}>{t('rv.repin')}</button>
          </>
        ) : null}
        {status === 'none' && !props.pinned ? (
          <button type="button" className="btn btn--primary" onClick={props.onPin}>{t('rv.continueNoView')} <span aria-hidden="true">→</span></button>
        ) : null}
        {status === 'none' && props.pinned ? <span className="roadview__ok" role="status">{t('rv.pinned')}</span> : null}
      </div>
    </div>
  );
}
