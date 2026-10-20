'use client';
import { useEffect, useRef, useState } from 'react';
import { cellRings, cornerLatLng } from '@/lib/domain/grid';
import { INITIAL_VIEW, type KakaoProvider } from '@/lib/map/provider';
import { loadKakao, zoomToLevel, type Kakao } from '@/lib/map/kakao';
import type { MapProps } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type KakaoMapProps = Omit<MapProps, 'provider'> & { provider: KakaoProvider; onFail: () => void };

const PRIMARY = '#005378';
const PRIMARY_DARK = '#00405D';
const PAN_STEP = 80;

/**
 * 카카오 지도 어댑터. LeafletMap과 같은 props를 받는다.
 * 카카오 SDK를 불러오지 못하면 onFail을 불러 MapView가 타일 지도로 바꾸게 한다.
 */
export default function KakaoMap(props: KakaoMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const k = useRef<Kakao>(null);
  const map = useRef<any>(null);
  const area = useRef<any[]>([]);
  const pins = useRef<any[]>([]);
  const tagObjs = useRef<any[]>([]);
  const fitted = useRef(false);
  const pendingFit = useRef<{ bounds: any; pad: number; maxZoom?: number } | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(props);
  useEffect(() => { cb.current = props; });

  function fitWhenSized(bounds: any, pad: number, maxZoom?: number) {
    const m = map.current;
    const node = el.current;
    if (!m || !node) return;
    m.relayout();
    if (node.clientWidth === 0 || node.clientHeight === 0) { pendingFit.current = { bounds, pad, maxZoom }; return; }
    pendingFit.current = null;
    m.setBounds(bounds, pad, pad, pad, pad);
    if (maxZoom !== undefined && m.getLevel() < zoomToLevel(maxZoom)) m.setLevel(zoomToLevel(maxZoom));
  }

  // 지도 생성: 한 번만
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let tileTimer: ReturnType<typeof setTimeout> | null = null;
    const node = el.current;
    const onKey = (e: KeyboardEvent) => {
      const m = map.current;
      if (!m || e.target !== node) return;
      if (e.key === 'Enter' && cb.current.onPick) {
        e.preventDefault();
        const c = m.getCenter();
        cb.current.onPick(c.getLat(), c.getLng());
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = { ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP], ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0] }[e.key];
        if (d) m.panBy(d[0], d[1]);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        m.setLevel(Math.max(1, m.getLevel() - 1));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        m.setLevel(Math.min(14, m.getLevel() + 1));
      }
    };
    loadKakao(props.provider.appKey, props.provider.sdkUrl)
      .then((kakao) => {
        if (cancelled || !node) return;
        k.current = kakao;
        fitted.current = false;
        const m = new kakao.maps.Map(node, {
          center: new kakao.maps.LatLng(INITIAL_VIEW.lat, INITIAL_VIEW.lon),
          level: zoomToLevel(INITIAL_VIEW.zoom),
        });
        map.current = m;
        m.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        kakao.maps.event.addListener(m, 'click', (e: any) => cb.current.onPick?.(e.latLng.getLat(), e.latLng.getLng()));
        let reported = false;
        kakao.maps.event.addListener(m, 'tilesloaded', () => {
          if (!reported) { reported = true; cb.current.onTileStatus?.('ok'); }
        });
        tileTimer = setTimeout(() => { if (!reported) cb.current.onTileStatus?.('failed'); }, 10_000);
        node.addEventListener('keydown', onKey);
        ro = new ResizeObserver(() => {
          m.relayout();
          const p = pendingFit.current;
          if (p && node.clientWidth > 0 && node.clientHeight > 0) fitWhenSized(p.bounds, p.pad, p.maxZoom);
        });
        ro.observe(node);
        setReady(true);
      })
      .catch(() => { if (!cancelled) cb.current.onFail(); });
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (tileTimer) clearTimeout(tileTimer);
      node?.removeEventListener('keydown', onKey);
      for (const o of [...area.current, ...pins.current, ...tagObjs.current]) o.setMap(null);
      area.current = []; pins.current = []; tagObjs.current = [];
      map.current = null;
      setReady(false);
    };
    // 공급자는 페이지 수명 동안 바뀌지 않는다.
  }, []);

  // 의견을 받을 수 있는 영역: 실제 경계 고리(바깥 + 구멍)로 그린다.
  useEffect(() => {
    const m = map.current, kakao = k.current;
    if (!ready || !m || !kakao) return;
    for (const o of area.current) o.setMap(null);
    area.current = [];
    const cells = props.allowedCells ?? [];
    if (cells.length === 0) return;
    const ll = ([x, y]: [number, number]) => { const [lat, lon] = cornerLatLng(x, y); return new kakao.maps.LatLng(lat, lon); };
    const bounds = new kakao.maps.LatLngBounds();
    for (const poly of cellRings(cells)) {
      const outer = poly.outer.map(ll);
      for (const p of outer) bounds.extend(p);
      area.current.push(new kakao.maps.Polygon({
        map: m,
        path: poly.holes.length ? [outer, ...poly.holes.map((h) => h.map(ll))] : outer,
        strokeWeight: 1.5, strokeColor: PRIMARY, strokeOpacity: 0.6,
        fillColor: PRIMARY, fillOpacity: 0.12,
        clickable: false,
      }));
    }
    if (props.fit === 'allowed' && !fitted.current) { fitted.current = true; fitWhenSized(bounds, 16); }
  }, [ready, props.allowedCells, props.fit]);

  // 공개 의견 핀(같은 대표점은 한 핀에 건수로 묶음)
  useEffect(() => {
    const m = map.current, kakao = k.current;
    if (!ready || !m || !kakao) return;
    for (const o of pins.current) o.setMap(null);
    pins.current = [];
    const groups = props.groups ?? [];
    const bounds = new kakao.maps.LatLngBounds();
    for (const p of groups) {
      const pos = new kakao.maps.LatLng(p.lat, p.lon);
      bounds.extend(pos);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pin-wrap pin-btn';
      btn.setAttribute('aria-label', p.label);
      btn.setAttribute('aria-pressed', String(p.active));
      const pin = document.createElement('span');
      pin.className = `pin pin--${p.category}${p.active ? ' pin--active' : ''}`;
      const n = document.createElement('span');
      n.className = 'pin__n';
      n.textContent = String(p.count);
      pin.appendChild(n);
      btn.appendChild(pin);
      btn.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onPinSelect?.(p.key); });
      pins.current.push(new kakao.maps.CustomOverlay({ map: m, position: pos, content: btn, xAnchor: 0.5, yAnchor: 1, zIndex: p.active ? 3 : 1, clickable: true }));
      if (p.active) {
        pins.current.push(new kakao.maps.Circle({ map: m, center: pos, radius: 100, strokeWeight: 1, strokeColor: PRIMARY_DARK, strokeOpacity: 0.8, fillColor: PRIMARY, fillOpacity: 0.12 }));
      }
    }
    if (props.fit === 'pins' && !fitted.current && groups.length > 0) { fitted.current = true; fitWhenSized(bounds, 40, 15); }
  }, [ready, props.groups, props.fit]);

  // 고른 자리의 핀(영역 표시 없이 핀만). 핀은 클릭을 막지 않아 주변을 다시 누르면 그 자리로 옮겨진다.
  useEffect(() => {
    const m = map.current, kakao = k.current;
    if (!ready || !m || !kakao) return;
    for (const o of tagObjs.current) o.setMap(null);
    tagObjs.current = [];
    if (!props.tag) return;
    const pos = new kakao.maps.LatLng(props.tag.lat, props.tag.lon);
    const box = document.createElement('span');
    box.className = 'pick-pin';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<span class="pin pin--pick"><span class="pin__n">+</span></span>';
    tagObjs.current.push(new kakao.maps.CustomOverlay({ map: m, position: pos, content: box, xAnchor: 0.5, yAnchor: 1, zIndex: 4 }));
  }, [ready, props.tag]);

  // 선택 위치로 이동
  useEffect(() => {
    const m = map.current, kakao = k.current;
    if (!ready || !m || !kakao || !props.focus) return;
    const pos = new kakao.maps.LatLng(props.focus.lat, props.focus.lon);
    const level = props.focus.zoom !== undefined ? zoomToLevel(props.focus.zoom) : Math.min(m.getLevel(), zoomToLevel(14));
    m.setLevel(level);
    if (props.reducedMotion) m.setCenter(pos); else m.panTo(pos);
  }, [ready, props.focus, props.reducedMotion]);

  // 다시 불러오기 요청: 크기만 다시 계산
  useEffect(() => { map.current?.relayout(); }, [props.reloadToken]);

  return (
    <div
      ref={el}
      className={props.compact ? 'leaflet-host leaflet-host--compact kakao-host' : 'leaflet-host kakao-host'}
      role="application"
      aria-label={props.ariaLabel}
      tabIndex={0}
    />
  );
}
