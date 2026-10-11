'use client';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cellBounds, GRID_VERSION, mergeCells } from '@/lib/domain/grid';
import type { Category } from '@/lib/domain/types';
import { INITIAL_VIEW, type MapProvider } from '@/lib/map/provider';

export type PinGroup = { key: string; lat: number; lon: number; count: number; category: Category; active: boolean; label: string };

export type LeafletMapProps = {
  provider: MapProvider | null;
  ariaLabel: string;
  groups?: PinGroup[];
  onPinSelect?: (key: string) => void;
  allowedCells?: { cell_x: number; cell_y: number }[];
  tag?: { lat: number; lon: number; label: string } | null;
  /** 클릭·Enter 위치. 받는 쪽은 즉시 격자로 바꾸고 원좌표를 보관하지 않는다. */
  onPick?: (lat: number, lon: number) => void;
  focus?: { lat: number; lon: number; zoom?: number; token: number } | null;
  fit?: 'allowed' | 'pins' | null;
  reducedMotion?: boolean;
  onTileStatus?: (status: 'ok' | 'failed') => void;
  reloadToken?: number;
  compact?: boolean;
};

export default function LeafletMap(props: LeafletMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const area = useRef<L.LayerGroup | null>(null);
  const tag = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const cb = useRef(props);
  useEffect(() => { cb.current = props; });

  // 지도 생성: 한 번만
  useEffect(() => {
    if (!el.current) return;
    fitted.current = false;
    const m = L.map(el.current, {
      center: [INITIAL_VIEW.lat, INITIAL_VIEW.lon],
      zoom: INITIAL_VIEW.zoom,
      zoomControl: true,
      keyboard: true,
      attributionControl: true,
      zoomAnimation: !cb.current.reducedMotion,
      fadeAnimation: !cb.current.reducedMotion,
      markerZoomAnimation: !cb.current.reducedMotion,
    });
    m.attributionControl.setPrefix(false);
    map.current = m;
    pins.current = L.layerGroup().addTo(m);
    area.current = L.layerGroup().addTo(m);
    tag.current = L.layerGroup().addTo(m);
    const container = m.getContainer();
    container.setAttribute('aria-label', cb.current.ariaLabel);
    container.setAttribute('role', 'application');

    m.on('click', (e: L.LeafletMouseEvent) => cb.current.onPick?.(e.latlng.lat, e.latlng.lng));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.target !== container || !cb.current.onPick) return;
      e.preventDefault();
      const c = m.getCenter();
      cb.current.onPick(c.lat, c.lng);
    };
    container.addEventListener('keydown', onKey);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      container.removeEventListener('keydown', onKey);
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.getContainer().setAttribute('aria-label', props.ariaLabel);
  }, [props.ariaLabel]);

  // 타일 레이어와 장애 감지
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = null;
    if (!props.provider) {
      cb.current.onTileStatus?.('failed');
      return;
    }
    let loaded = 0;
    let failed = 0;
    let reported: 'ok' | 'failed' | null = null;
    const report = (s: 'ok' | 'failed') => { if (reported !== s) { reported = s; cb.current.onTileStatus?.(s); } };
    const layer = L.tileLayer(props.provider.url, {
      attribution: props.provider.attribution,
      maxZoom: props.provider.maxZoom,
      crossOrigin: true,
    });
    layer.on('tileload', () => { loaded += 1; report('ok'); });
    layer.on('tileerror', () => { failed += 1; if (loaded === 0 && failed >= 3) report('failed'); });
    const timer = setTimeout(() => { if (loaded === 0) report('failed'); }, 8000);
    layer.addTo(m);
    tiles.current = layer;
    return () => { clearTimeout(timer); layer.remove(); };
  }, [props.provider, props.reloadToken]);

  // 의견을 받을 수 있는 격자 영역
  useEffect(() => {
    const m = map.current;
    const g = area.current;
    if (!m || !g) return;
    g.clearLayers();
    const cells = props.allowedCells ?? [];
    if (cells.length === 0) return;
    let bounds: L.LatLngBounds | null = null;
    for (const r of mergeCells(cells)) {
      const sw = cellBounds({ grid_version: GRID_VERSION, cell_x: r.x0, cell_y: r.y0 })[0];
      const ne = cellBounds({ grid_version: GRID_VERSION, cell_x: r.x1, cell_y: r.y1 })[1];
      const b = L.latLngBounds(sw, ne);
      L.rectangle(b, { color: '#2f6f9f', weight: 1, opacity: 0.6, fillColor: '#2f6f9f', fillOpacity: 0.12, interactive: false }).addTo(g);
      bounds = bounds ? bounds.extend(b) : b;
    }
    if (bounds && props.fit === 'allowed' && !fitted.current) {
      fitted.current = true;
      m.invalidateSize({ pan: false });
      m.fitBounds(bounds, { padding: [16, 16], animate: false });
    }
  }, [props.allowedCells, props.fit]);

  // 공개 의견 핀(같은 대표점은 한 핀에 건수로 묶음)
  useEffect(() => {
    const m = map.current;
    const g = pins.current;
    if (!m || !g) return;
    g.clearLayers();
    const groups = props.groups ?? [];
    for (const p of groups) {
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<span class="pin pin--${p.category}${p.active ? ' pin--active' : ''}"><span class="pin__n">${p.count}</span></span>`,
        iconSize: [34, 42],
        iconAnchor: [17, 40],
      });
      const marker = L.marker([p.lat, p.lon], { icon, keyboard: true, riseOnHover: true, zIndexOffset: p.active ? 1000 : 0 });
      marker.on('click', () => cb.current.onPinSelect?.(p.key));
      marker.on('add', () => {
        const node = marker.getElement();
        node?.setAttribute('aria-label', p.label);
        node?.setAttribute('aria-pressed', String(p.active));
      });
      marker.addTo(g);
      if (p.active) {
        L.circle([p.lat, p.lon], { radius: 100, color: '#1f3a5a', weight: 1, fillColor: '#2f6f9f', fillOpacity: 0.12, interactive: false }).addTo(g);
      }
    }
    if (props.fit === 'pins' && !fitted.current && groups.length > 0) {
      fitted.current = true;
      m.invalidateSize({ pan: false });
      const b = L.latLngBounds(groups.map((p) => [p.lat, p.lon] as [number, number]));
      if (groups.length === 1) m.setView(b.getCenter(), 15, { animate: false });
      else m.fitBounds(b, { padding: [40, 40], maxZoom: 15, animate: false });
    }
  }, [props.groups, props.fit]);

  // 선택한 대략 위치 태그
  useEffect(() => {
    const g = tag.current;
    if (!g) return;
    g.clearLayers();
    if (!props.tag) return;
    L.circle([props.tag.lat, props.tag.lon], { radius: 100, color: '#1f3a5a', weight: 2, dashArray: '4 4', fillColor: '#2f6f9f', fillOpacity: 0.18, interactive: false }).addTo(g);
    const icon = L.divIcon({ className: 'pin-wrap', html: '<span class="tag-dot" aria-hidden="true">+</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker([props.tag.lat, props.tag.lon], { icon, interactive: false, keyboard: false })
      .bindTooltip(props.tag.label, { permanent: true, direction: 'bottom', offset: [0, 14], className: 'tag-tooltip' })
      .addTo(g);
  }, [props.tag]);

  // 선택 위치로 이동
  useEffect(() => {
    const m = map.current;
    if (!m || !props.focus) return;
    const zoom = props.focus.zoom ?? Math.max(m.getZoom(), 14);
    if (props.reducedMotion) m.setView([props.focus.lat, props.focus.lon], zoom, { animate: false });
    else m.flyTo([props.focus.lat, props.focus.lon], zoom, { duration: 0.6 });
  }, [props.focus, props.reducedMotion]);

  return <div ref={el} className={props.compact ? 'leaflet-host leaflet-host--compact' : 'leaflet-host'} />;
}
