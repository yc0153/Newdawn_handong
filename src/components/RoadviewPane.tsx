'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from './I18nProvider';
import type { Kakao } from '@/lib/map/kakao';
import type { AddressItem } from '@/lib/map/kakaoPlaces';
import type { ReviewRoadview } from '@/lib/domain/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dir = { pan: number; tilt: number };

const wait = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * 고른 주소의 카카오 로드뷰. 로드뷰에서 원하는 곳을 누르면 그 방향에 핀이 꽂힌다(다시 누르면 옮겨짐).
 * 카카오 로드뷰는 화면 좌표 → 방향 변환을 주지 않으므로, 보이지 않는 시험 오버레이로
 * 각도당 화면 이동량을 그 자리에서 재며 누른 곳의 방향(pan, tilt)을 찾는다.
 * 핀을 꽂은 방향과 그때의 로드뷰 시점은 onPin으로 넘긴다(담당자 검토용, 사진은 저장하지 않음).
 */
export default function RoadviewPane(props: {
  kakao: Kakao;
  item: AddressItem;
  pinned: boolean;
  /** 로드뷰 핀(방향·그때 시점)을 넘긴다. 로드뷰가 없거나 핀을 안 꽂았으면 null. */
  onPin: (snap: ReviewRoadview | null) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const rvRef = useRef<any>(null);
  const pinOverlay = useRef<any>(null);
  const snap = useRef<ReviewRoadview | null>(null);
  // 이미 '이 핀 위치로'를 누른 뒤 핀을 옮기면 바뀐 핀을 바로 다시 넘긴다.
  const after = useRef<{ pinned: boolean; onPin: (s: ReviewRoadview | null) => void }>({ pinned: props.pinned, onPin: props.onPin });
  useEffect(() => { after.current = { pinned: props.pinned, onPin: props.onPin }; }, [props.pinned, props.onPin]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none'>('loading');
  const [hasPin, setHasPin] = useState(false);
  // 카카오 로드뷰는 바닥을 누르면 다음 지점으로 이동하므로, 핀 꽂기 중에는 투명 막이 클릭을 대신 받는다.
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { kakao, item } = props;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    setStatus('loading');
    setHasPin(false);
    setPicking(false);
    snap.current = null;
    const rv = new kakao.maps.Roadview(node);
    rvRef.current = rv;
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
    return () => {
      cancelled = true;
      ro.disconnect();
      pinOverlay.current?.setMap(null);
      pinOverlay.current = null;
      rvRef.current = null;
      node.replaceChildren();
    };
  }, [kakao, item]);

  /** 방향 dir에 놓은 요소의 화면 위치(로드뷰 영역 기준, 요소 아래 가운데). */
  const placeAt = useCallback(async (overlay: any, content: HTMLElement, dir: Dir) => {
    const rv = rvRef.current, node = el.current;
    if (!rv || !node) return null;
    const vp = rv.getViewpoint();
    const pan = ((dir.pan % 360) + 360) % 360;
    overlay.setPosition(new kakao.maps.Viewpoint(pan, dir.tilt, vp.zoom, rv.getPanoId()));
    if (!overlay.getMap?.()) overlay.setMap(rv);
    await wait();
    const r = content.getBoundingClientRect(), box = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top };
  }, [kakao]);

  const dropPin = useCallback(async (x: number, y: number) => {
    const rv = rvRef.current;
    if (!rv) return;
    // 보이지 않는 시험 오버레이로 '각도 변화 → 화면 이동'을 그 자리에서 재고(뉴턴법) 누른 곳의 방향을 찾는다.
    // 가장자리 근처를 누르면 시험 방향이 화면 밖으로 나가 잴 수 없을 수 있다. 그래서
    //  - 기울기는 바깥쪽(+)이 안 되면 안쪽(-)으로 재고,
    //  - 한 번에 너무 많이 돌려 화면 밖으로 나가면 반씩 줄여 다시 해 보고,
    //  - 끝까지 1px 안으로 못 맞춰도 가장 가까웠던 방향에 핀을 꽂는다.
    const probeEl = document.createElement('span');
    probeEl.className = 'roadview__probe';
    const probe = new kakao.maps.CustomOverlay({ content: probeEl, xAnchor: 0.5, yAnchor: 1 });
    const vp = rv.getViewpoint();
    const STEP = 1.5;
    const clampTilt = (t: number) => Math.max(-85, Math.min(85, t));
    const gap = (p: { x: number; y: number }) => Math.hypot(p.x - x, p.y - y);
    let dir: Dir = { pan: vp.pan, tilt: vp.tilt };
    let J: { a: number; b: number; c: number; d: number; det: number } | null = null;
    try {
      let p0 = await placeAt(probe, probeEl, dir);
      if (!p0) return;
      const slope = async (axis: 'pan' | 'tilt', at: { x: number; y: number }) => {
        for (const h of [STEP, -STEP]) {
          const q = axis === 'pan' ? { pan: dir.pan + h, tilt: dir.tilt } : { pan: dir.pan, tilt: clampTilt(dir.tilt + h) };
          const real = axis === 'pan' ? h : q.tilt - dir.tilt;
          if (real === 0) continue;
          const p = await placeAt(probe, probeEl, q);
          if (p) return { dx: (p.x - at.x) / real, dy: (p.y - at.y) / real };
        }
        return null;
      };
      for (let i = 0; i < 8 && gap(p0) >= 1; i++) {
        const sp = await slope('pan', p0);
        const st = await slope('tilt', p0);
        if (!sp || !st) break;
        const a = sp.dx, c = sp.dy, b = st.dx, d = st.dy;
        const det = a * d - b * c;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-6) break;
        J = { a, b, c, d, det };
        const dx = x - p0.x, dy = y - p0.y;
        let stepPan = (d * dx - b * dy) / det, stepTilt = (-c * dx + a * dy) / det;
        let moved = false;
        for (let k = 0; k < 5; k++) {
          const cand = { pan: dir.pan + stepPan, tilt: clampTilt(dir.tilt + stepTilt) };
          const pc = await placeAt(probe, probeEl, cand);
          if (pc && gap(pc) < gap(p0)) { dir = cand; p0 = pc; moved = true; break; }
          stepPan /= 2; stepTilt /= 2;
        }
        if (!moved) break;
      }
    } finally {
      probe.setMap(null);
    }
    const content = document.createElement('span');
    content.className = 'roadview__droppin';
    content.setAttribute('aria-hidden', 'true');
    const pin = document.createElement('span');
    pin.className = 'pin pin--other';
    const n = document.createElement('span');
    n.className = 'pin__n';
    n.textContent = '+';
    pin.appendChild(n);
    content.appendChild(pin);
    pinOverlay.current?.setMap(null);
    const overlay = new kakao.maps.CustomOverlay({ content, xAnchor: 0.5, yAnchor: 1, zIndex: 5 });
    pinOverlay.current = overlay;
    // 안전장치: 핀 자체 위치를 다시 재서 어긋나 있으면 맞춘다(오버레이 크기에 따라 기준점이 다를 수 있음).
    let good = dir;
    for (let i = 0; i < 3; i++) {
      const at = await placeAt(overlay, content, dir);
      if (!at) { if (dir !== good) await placeAt(overlay, content, good); break; }
      good = dir;
      if (!J || Math.hypot(at.x - x, at.y - y) < 1.5) break;
      const dx = x - at.x, dy = y - at.y;
      dir = { pan: dir.pan + (J.d * dx - J.b * dy) / J.det, tilt: clampTilt(dir.tilt + (-J.c * dx + J.a * dy) / J.det) };
    }
    if (!overlay.getMap?.()) overlay.setMap(rv);
    // 핀이 놓인 방향(good)과 핀을 꽂을 때 보던 시점. 담당자 화면에서 같은 장면을 다시 연다.
    const norm = (p: number) => ((p % 360) + 360) % 360;
    const pano = Number(rv.getPanoId());
    snap.current = Number.isSafeInteger(pano) && pano > 0
      ? { pano_id: pano, pin_pan: norm(good.pan), pin_tilt: good.tilt, view_pan: norm(vp.pan), view_tilt: vp.tilt, view_zoom: vp.zoom ?? 0 }
      : null;
    setHasPin(true);
    if (after.current.pinned) after.current.onPin(snap.current);
  }, [kakao, placeAt]);

  const onCatch = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || busy) return;
    const box = el.current?.getBoundingClientRect();
    if (!box) return;
    setBusy(true);
    try { await dropPin(e.clientX - box.left, e.clientY - box.top); } finally { setBusy(false); setPicking(false); }
  };

  const place = item.name ?? item.road ?? item.jibun;
  return (
    <div className="roadview" role="region" aria-label={t('rv.mapAria')}>
      <div className="roadview__head">
        <span className="roadview__title"><span className="eyebrow-dot" aria-hidden="true" />{t('rv.title')} · <strong>{place}</strong></span>
        <button type="button" className="btn btn--small" onClick={props.onBack}>{t('rv.backToMap')}</button>
      </div>
      <div className="roadview__stage">
        <div ref={el} className="roadview__view" />
        {status === 'ready' && picking ? (
          <div className="roadview__catch" onPointerUp={(e) => void onCatch(e)} role="button" aria-label={t('rv.pickHint')} tabIndex={-1} />
        ) : null}
        {status === 'loading' ? <p className="roadview__msg" role="status">{t('rv.loading')}</p> : null}
        {status === 'none' ? <p className="roadview__msg" role="status">{t('rv.none')}</p> : null}
      </div>
      <div className="roadview__foot">
        {status === 'ready' ? (
          <>
            <span className={props.pinned && !picking ? 'roadview__ok' : 'muted small'} role="status">
              {picking ? t('rv.pickHint') : props.pinned ? t('rv.pinned') : hasPin ? t('rv.moved') : t('rv.aim')}
            </span>
            <span className="roadview__actions">
              {picking ? (
                <button type="button" className="btn btn--small" onClick={() => setPicking(false)}>{t('rv.pickCancel')}</button>
              ) : (
                <button type="button" className={`btn${hasPin ? ' btn--small' : ' btn--primary'}`} onClick={() => setPicking(true)}>
                  <span aria-hidden="true">📍</span> {hasPin ? t('rv.pickMove') : t('rv.pickStart')}
                </button>
              )}
              {!props.pinned ? (
                <button type="button" className="btn btn--primary" onClick={() => props.onPin(snap.current)} disabled={!hasPin || picking}>{t('rv.pin')} <span aria-hidden="true">→</span></button>
              ) : null}
            </span>
          </>
        ) : null}
        {status === 'none' && !props.pinned ? (
          <button type="button" className="btn btn--primary" onClick={() => props.onPin(null)}>{t('rv.continueNoView')} <span aria-hidden="true">→</span></button>
        ) : null}
        {status === 'none' && props.pinned ? <span className="roadview__ok" role="status">{t('rv.pinned')}</span> : null}
      </div>
    </div>
  );
}
