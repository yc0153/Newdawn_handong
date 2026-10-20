'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kakao } from '@/lib/map/kakao';
import type { ReviewRoadview } from '@/lib/domain/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LOAD_TIMEOUT_MS = 10_000;
const wait = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * 담당자 상세: 글쓴이가 로드뷰에 꽂은 핀을 같은 로드뷰 지점·같은 시점으로 다시 보여 준다.
 * 사진을 저장하지 않고, 저장한 방향(pan·tilt)과 확대 단계로 카카오 로드뷰를 다시 연다.
 * 담당자 화면 크기가 글쓴이 화면과 달라 핀이 화면 밖이면 핀 쪽으로 돌린다.
 */
export default function AdminRoadview({ kakao, lat, lon, rv }: { kakao: Kakao; lat: number; lon: number; rv: ReviewRoadview }) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<any>(null);
  const pinEl = useRef<HTMLSpanElement | null>(null);
  const pendingView = useRef<'saved' | 'pin' | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // 상세를 다시 불러와도(조치 후) 값이 같으면 로드뷰를 새로 만들지 않는다.
  const rvKey = [rv.pano_id, rv.pin_pan, rv.pin_tilt, rv.view_pan, rv.view_tilt, rv.view_zoom].join('|');

  const pinVisible = useCallback(() => {
    const node = el.current, pin = pinEl.current;
    if (!node || !pin || !pin.isConnected) return false;
    const r = pin.getBoundingClientRect(), box = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const x = r.left + r.width / 2, y = r.bottom;
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }, []);

  const look = useCallback(async (which: 'saved' | 'pin') => {
    const roadview = view.current;
    if (!roadview) return;
    // 다른 지점으로 이동해 있었다면 저장한 지점으로 돌아간 뒤(panoid_changed) 시점을 맞춘다.
    if (Number(roadview.getPanoId?.()) !== rv.pano_id) {
      pendingView.current = which;
      roadview.setPanoId(rv.pano_id, new kakao.maps.LatLng(lat, lon));
      return;
    }
    const toward = new kakao.maps.Viewpoint(rv.pin_pan, Math.max(-60, Math.min(60, rv.pin_tilt)), rv.view_zoom, rv.pano_id);
    // 카카오 로드뷰는 코드로 시점을 바꾼 뒤 오버레이를 바로 다시 그리지 않을 때가 있어 relayout으로 다시 그리게 한다.
    const apply = async (v: any) => { roadview.setViewpoint(v); await wait(); roadview.relayout?.(); };
    if (which === 'pin') { await apply(toward); return; }
    await apply(new kakao.maps.Viewpoint(rv.view_pan, rv.view_tilt, rv.view_zoom, rv.pano_id));
    await new Promise((r) => setTimeout(r, 300));
    // 담당자 화면이 글쓴이 화면보다 좁아 핀이 밖에 있으면 핀 쪽으로 돌린다.
    if (view.current === roadview && !pinVisible()) await apply(toward);
  }, [kakao, lat, lon, rv, pinVisible]);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    setStatus('loading');
    const roadview = new kakao.maps.Roadview(node);
    view.current = roadview;
    const content = document.createElement('span');
    content.className = 'roadview__droppin';
    content.setAttribute('aria-hidden', 'true');
    content.innerHTML = '<span class="pin pin--other"><span class="pin__n">+</span></span>';
    pinEl.current = content;
    const overlay = new kakao.maps.CustomOverlay({
      content, xAnchor: 0.5, yAnchor: 1, zIndex: 5,
      position: new kakao.maps.Viewpoint(rv.pin_pan, rv.pin_tilt, rv.view_zoom, rv.pano_id),
    });
    let started = false;
    const start = () => {
      if (cancelled || started) return;
      started = true;
      overlay.setPosition(new kakao.maps.Viewpoint(rv.pin_pan, rv.pin_tilt, rv.view_zoom, rv.pano_id));
      overlay.setMap(roadview);
      setStatus('ready');
      void look('saved');
    };
    const timer = setTimeout(() => { if (!started && !cancelled) setStatus('error'); }, LOAD_TIMEOUT_MS);
    kakao.maps.event.addListener(roadview, 'init', start);
    kakao.maps.event.addListener(roadview, 'panoid_changed', () => {
      if (cancelled) return;
      const back = Number(roadview.getPanoId?.()) === rv.pano_id;
      if (!started && back) { start(); return; }
      if (back && pendingView.current) { const w = pendingView.current; pendingView.current = null; void look(w); }
    });
    roadview.setPanoId(rv.pano_id, new kakao.maps.LatLng(lat, lon));
    const ro = new ResizeObserver(() => roadview.relayout?.());
    ro.observe(node);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ro.disconnect();
      overlay.setMap(null);
      view.current = null;
      pinEl.current = null;
      node.replaceChildren();
    };
    // rv는 rvKey가 같으면 같은 값이다.
  }, [kakao, lat, lon, rvKey]);

  return (
    <div className="admin-rv">
      <div className="admin-rv__stage">
        <div ref={el} className="admin-rv__view" aria-label="글쓴이가 핀을 꽂은 로드뷰" role="img" />
        {status === 'loading' ? <p className="admin-rv__msg" role="status">로드뷰를 불러오는 중…</p> : null}
        {status === 'error' ? <p className="admin-rv__msg" role="status">저장된 로드뷰 장면을 불러오지 못했습니다. 카카오 로드뷰가 바뀌었을 수 있습니다. 위 지도의 핀 위치를 참고하세요.</p> : null}
      </div>
      <div className="admin-rv__foot">
        <span className="muted small">글쓴이가 핀을 꽂을 때 보던 화면입니다. 끌어서 둘러볼 수 있습니다.</span>
        <span className="admin-rv__actions">
          <button type="button" className="btn btn--small" disabled={status !== 'ready'} onClick={() => void look('saved')}>처음 화면으로</button>
          <button type="button" className="btn btn--small" disabled={status !== 'ready'} onClick={() => void look('pin')}>핀 쪽으로 보기</button>
        </span>
      </div>
    </div>
  );
}
