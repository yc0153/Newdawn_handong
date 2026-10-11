'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import MapView from './map/MapView';
import type { PinGroup } from './map/LeafletMap';
import { useI18n } from './I18nProvider';
import { usePublicSnapshot } from '@/lib/client/usePublicSnapshot';
import { useReducedMotion } from '@/lib/client/useReducedMotion';
import { CATEGORY_KEYS, CATEGORY_ORDER } from '@/lib/client/categories';
import { mapProvider } from '@/lib/map/provider';
import type { Category, PublicOpinion } from '@/lib/domain/types';
import type { SnapshotView } from '@/lib/domain/snapshot';

const keyOf = (o: PublicOpinion) => `${o.location.lat.toFixed(7)},${o.location.lon.toFixed(7)}`;

export default function MapExplorer() {
  const { t } = useI18n();
  const { view, retry } = usePublicSnapshot('browse');
  const reducedMotion = useReducedMotion();
  const provider = useMemo(() => mapProvider(), []);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; token: number } | null>(null);
  const [tileStatus, setTileStatus] = useState<'ok' | 'failed' | 'unknown'>('unknown');
  const [reloadToken, setReloadToken] = useState(0);

  const all = view.kind === 'fresh' ? view.cases : null;
  const filtered = useMemo(() => (all ? all.filter((o) => filter === 'all' || o.category === filter) : null), [all, filter]);

  // 철회되었거나 필터에서 빠진 선택은 해제한다.
  const activeId = filtered && selectedId && filtered.some((o) => o.public_id === selectedId) ? selectedId : null;
  const activeGroup = filtered && groupKey && filtered.some((o) => keyOf(o) === groupKey) ? groupKey : null;

  const groups = useMemo<PinGroup[]>(() => {
    if (!filtered) return [];
    const map = new Map<string, PublicOpinion[]>();
    for (const o of filtered) {
      const k = keyOf(o);
      map.set(k, [...(map.get(k) ?? []), o]);
    }
    const activeKey = activeGroup ?? (activeId ? keyOf(filtered.find((o) => o.public_id === activeId)!) : null);
    return [...map].map(([k, list]) => ({
      key: k,
      lat: list[0].location.lat,
      lon: list[0].location.lon,
      count: list.length,
      category: list[0].category,
      active: k === activeKey,
      label: `${t(CATEGORY_KEYS[list[0].category])} · ${t('list.atPlace', { n: list.length })}`,
    }));
  }, [filtered, activeId, activeGroup, t]);

  const listed = filtered && activeGroup ? filtered.filter((o) => keyOf(o) === activeGroup) : filtered;

  function selectOpinion(o: PublicOpinion) {
    setSelectedId(o.public_id);
    setFocus({ lat: o.location.lat, lon: o.location.lon, token: Date.now() });
  }
  function selectGroup(key: string) {
    if (!filtered) return;
    const items = filtered.filter((o) => keyOf(o) === key);
    if (items.length === 0) return;
    setGroupKey(items.length > 1 ? key : null);
    setSelectedId(items[0].public_id);
  }

  return (
    <div className="explorer">
      <section className="card map-card" aria-label={t('map.ariaBrowse')}>
        <div className="filter-bar" role="group" aria-label={t('filter.label')}>
          {(['all', ...CATEGORY_ORDER] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${c !== 'all' ? ` chip--${c}` : ''}`}
              aria-pressed={filter === c}
              onClick={() => { setFilter(c); setGroupKey(null); }}
            >
              {c === 'all' ? t('filter.all') : t(CATEGORY_KEYS[c])}
            </button>
          ))}
        </div>
        <div className="map-frame">
          <MapView
            provider={provider}
            ariaLabel={t('map.ariaBrowse')}
            groups={groups}
            onPinSelect={selectGroup}
            focus={focus}
            fit="pins"
            reducedMotion={reducedMotion}
            onTileStatus={setTileStatus}
            reloadToken={reloadToken}
          />
          {provider?.dev ? <span className="map-note">{t('devMap')}</span> : null}
          {(!provider || tileStatus === 'failed') ? (
            <div className="map-alert" role="status">
              <strong>{t('mapError.title')}</strong>
              <span>{provider ? t('mapError.body') : t('mapError.unconfigured')}</span>
              {provider ? <button type="button" className="btn btn--small" onClick={() => { setTileStatus('unknown'); setReloadToken((n) => n + 1); }}>{t('mapError.retry')}</button> : null}
            </div>
          ) : null}
          <Link href="/submit" className="btn btn--primary map-cta">{t('cta.write')} <span aria-hidden="true">+</span></Link>
        </div>
      </section>

      <aside className="card side-panel" aria-labelledby="list-title">
        <div className="side-panel__head">
          <h2 id="list-title">{t('list.title')}</h2>
          {filtered ? <span className="count-badge">{t('list.count', { n: filtered.length })}</span> : null}
        </div>
        <p className="muted">{t('list.lead')}</p>
        <StateMessage view={view} filteredCount={filtered?.length ?? null} onRetry={retry} />
        {activeGroup && listed ? (
          <div className="group-head">
            <strong>{t('list.atPlace', { n: listed.length })}</strong>
            <button type="button" className="link-btn" onClick={() => setGroupKey(null)}>{t('list.showAll')}</button>
          </div>
        ) : null}
        {listed && listed.length > 0 ? (
          <ul className="opinion-list">
            {listed.map((o) => {
              const active = o.public_id === activeId;
              return (
                <li key={o.public_id}>
                  <button type="button" className={`opinion${active ? ' opinion--active' : ''}`} aria-pressed={active} onClick={() => selectOpinion(o)} data-public-id={o.public_id}>
                    <span className={`cat-label cat-label--${o.category}`}>{t(CATEGORY_KEYS[o.category])}</span>
                    <span className="opinion__summary">{o.summary}</span>
                    <span className="opinion__meta">
                      <span>{t('list.summaryLabel')}</span>
                      {active ? <span className="approx-chip">⌖ {t('list.approx')} · {t('list.approxHelp')}</span> : <span>{t('list.approx')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <Link href="/submit" className="btn btn--primary btn--block side-panel__cta">{t('cta.write')} <span aria-hidden="true">+</span></Link>
      </aside>
    </div>
  );
}

function StateMessage({ view, filteredCount, onRetry }: { view: SnapshotView<PublicOpinion>; filteredCount: number | null; onRetry: () => void }) {
  const { t } = useI18n();
  if (view.kind === 'fresh') {
    if (view.cases.length === 0) return <p className="state state--empty" role="status">{t('state.empty')}</p>;
    if (filteredCount === 0) return <p className="state state--empty" role="status">{t('state.filterEmpty')}</p>;
    return view.refreshFailing ? <p className="state state--warn" role="status">{t('state.refreshFailing')}</p> : null;
  }
  if (view.kind === 'loading') return <p className="state" role="status" aria-busy="true">{t('state.loading')}</p>;
  if (view.kind === 'error') {
    return (
      <div className="state state--error" role="alert">
        <p>{t('state.error')}</p>
        <button type="button" className="btn btn--small" onClick={onRetry}>{t('state.retry')}</button>
      </div>
    );
  }
  if (view.kind === 'offline') return <p className="state state--warn" role="status">{t('state.offline')}</p>;
  if (view.kind === 'paused') return <p className="state" role="status">{t('state.paused')}</p>;
  return (
    <div className="state state--warn" role="status">
      <p>{t('state.unverified')}</p>
      <button type="button" className="btn btn--small" onClick={onRetry}>{t('state.retry')}</button>
    </div>
  );
}
