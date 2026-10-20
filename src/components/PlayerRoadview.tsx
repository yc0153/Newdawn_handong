'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './I18nProvider';
import type { Kakao } from '@/lib/map/kakao';

/* eslint-disable @typescript-eslint/no-explicit-any */
// 반지름 100m = 약 200m 칸 안쪽. 칸 대표 지점에서 가장 가까운 로드뷰를 찾는다.
const RADIUS_M = 100;

/**
 * 플레이어용 거리 모습(카카오 로드뷰). 서버에는 정확한 핀 위치가 없으므로
 * 공개된 약 200m 칸 대표 지점 근처의 로드뷰를 보여 준다. 새로 저장하는 정보는 없다.
 */
export default function PlayerRoadview({ kakao, lat, lon }: { kakao: Kakao; lat: number; lon: number }) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const rv = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const view = new kakao.maps.Roadview(node);
    rv.current = view;
    const ro = new ResizeObserver(() => view.relayout?.());
    ro.observe(node);
    return () => {
      ro.disconnect();
      rv.current = null;
      node.replaceChildren();
    };
  }, [kakao]);

  useEffect(() => {
    const view = rv.current;
    if (!view) return;
    let cancelled = false;
    setStatus('loading');
    const pos = new kakao.maps.LatLng(lat, lon);
    new kakao.maps.RoadviewClient().getNearestPanoId(pos, RADIUS_M, (panoId: number | null) => {
      if (cancelled) return;
      if (panoId === null || panoId === undefined) { setStatus('none'); return; }
      view.setPanoId(panoId, pos);
      setStatus('ready');
    });
    return () => { cancelled = true; };
  }, [kakao, lat, lon]);

  return (
    <section className={`player-rv player-rv--${status}`} aria-label={t('player.street')}>
      <div ref={el} className="player-rv__view" />
      <p className="player-rv__label">
        <strong>{t('player.street')}</strong>
        <span>{t('player.streetNote')}</span>
      </p>
      {status !== 'ready' ? (
        <p className="player-rv__msg" role="status">{status === 'loading' ? t('rv.loading') : t('player.streetNone')}</p>
      ) : null}
    </section>
  );
}
