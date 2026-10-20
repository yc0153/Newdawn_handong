'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import MapView from '@/components/map/MapView';
import type { PinGroup } from '@/components/map/types';
import type { Category, ReviewStatus } from '@/lib/domain/types';
import { mapProvider } from '@/lib/map/provider';
import { CATEGORY_LABEL, STATUS_LABEL, formatDate } from './labels';

type Item = {
  id: string; category: Category; status: ReviewStatus; location: { lat: number; lon: number }; summary: string | null;
  preview: string; allow_map: boolean; allow_player: boolean; include_in_player: boolean; created_at: string;
};
type Overview = {
  counts: { total: number; pending: number; published: number; hidden: number; in_player: number; player_waiting: number };
  by_category: Record<Category, number>;
  items: Item[];
  truncated: boolean;
  limit: number;
};
type Filter = 'all' | ReviewStatus;

const CATS: Category[] = ['transport', 'language', 'environment', 'other'];
const keyOf = (i: Item) => `${i.location.lat.toFixed(7)},${i.location.lon.toFixed(7)}`;

/** 담당자 첫 화면: 전체 의견을 한눈에(상태별 건수·분야·지도 위치·검토 대기). */
export default function AdminOverview() {
  const router = useRouter();
  const provider = useMemo(() => mapProvider(), []);
  const [data, setData] = useState<{ state: 'loading' | 'ready' | 'error'; value?: Overview }>({ state: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const [place, setPlace] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData((d) => ({ state: 'loading', value: d.value }));
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      if (res.status === 401) { router.replace('/admin/login'); return; }
      if (!res.ok) throw new Error(String(res.status));
      setData({ state: 'ready', value: (await res.json()) as Overview });
    } catch {
      setData((d) => ({ state: 'error', value: d.value }));
    }
  }, [router]);
  useEffect(() => { void load(); }, [load]);

  const v = data.value;
  const shown = useMemo(() => (v ? v.items.filter((i) => filter === 'all' || i.status === filter) : []), [v, filter]);
  const groups = useMemo<PinGroup[]>(() => {
    const byPlace = new Map<string, Item[]>();
    for (const i of shown) byPlace.set(keyOf(i), [...(byPlace.get(keyOf(i)) ?? []), i]);
    return [...byPlace].map(([key, list]) => ({
      key, lat: list[0].location.lat, lon: list[0].location.lon, count: list.length, category: list[0].category,
      active: key === place, label: `${CATEGORY_LABEL[list[0].category]} · 이 위치 ${list.length}건`,
    }));
  }, [shown, place]);
  const atPlace = place ? shown.filter((i) => keyOf(i) === place) : [];
  const pending = v ? v.items.filter((i) => i.status === 'pending').slice(0, 6) : [];
  const maxCat = v ? Math.max(1, ...CATS.map((c) => v.by_category[c] ?? 0)) : 1;

  if (!v) {
    return (
      <section className="card">
        <h1>전체 현황</h1>
        {data.state === 'error' ? <p className="state state--error" role="alert">현황을 불러오지 못했습니다. <button type="button" className="btn btn--small" onClick={() => void load()}>다시 시도</button></p> : <p className="state" aria-busy="true">불러오는 중…</p>}
      </section>
    );
  }
  const c = v.counts;
  const tiles: { label: string; value: number; tab: Filter | null; note: string }[] = [
    { label: '검토 대기', value: c.pending, tab: 'pending', note: '담당자 확인 전' },
    { label: '지도 공개', value: c.published, tab: 'published', note: '공개 의견 지도에 표시' },
    { label: '상영 중', value: c.in_player, tab: null, note: '플레이어에 나오는 의견' },
    { label: '상영 대기', value: c.player_waiting, tab: null, note: '공개했지만 상영에 안 넣음' },
    { label: '숨김', value: c.hidden, tab: 'hidden', note: '공개하지 않음' },
    { label: '전체', value: c.total, tab: 'all', note: '삭제한 의견 제외' },
  ];

  return (
    <div className="overview">
      <div className="admin-toolbar">
        <h1>전체 현황</h1>
        <Link href="/admin/opinions" className="btn btn--small">의견 목록으로</Link>
        <button type="button" className="btn btn--small" onClick={() => void load()} disabled={data.state === 'loading'}>새로고침</button>
      </div>
      {data.state === 'error' ? <p className="state state--error" role="alert">새로 불러오지 못해 이전 내용을 보여 줍니다.</p> : null}

      <ul className="overview__tiles" aria-label="상태별 건수">
        {tiles.map((t) => (
          <li key={t.label} className={`overview__tile${t.label === '검토 대기' && t.value > 0 ? ' overview__tile--alert' : ''}`}>
            <span className="overview__label">{t.label}</span>
            <strong className="overview__value">{t.value.toLocaleString('ko-KR')}</strong>
            <span className="muted small">{t.note}</span>
          </li>
        ))}
      </ul>

      <div className="overview__grid">
        <section className="card overview__map-card" aria-labelledby="ov-map">
          <div className="overview__head">
            <h2 id="ov-map" className="small-heading">의견 위치 (모든 상태)</h2>
            <div className="tabs" role="tablist" aria-label="지도에 보일 상태">
              {(['all', 'pending', 'published', 'hidden'] as Filter[]).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className="tab" onClick={() => { setFilter(f); setPlace(null); }}>
                  {f === 'all' ? '전체' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="overview__map">
            <MapView provider={provider} ariaLabel="의견 위치 지도" groups={groups} onPinSelect={(k) => setPlace((p) => (p === k ? null : k))} fit="pins" compact />
          </div>
          <p className="muted small">핀은 약 200m 범위 대표 지점이고, 숫자는 그 자리의 의견 수입니다. 핀을 누르면 아래에 그 자리 의견이 보입니다.{v.truncated ? ` 최근 ${v.limit.toLocaleString('ko-KR')}건만 지도에 표시합니다.` : ''}</p>
          {place ? (
            <div className="overview__place">
              <div className="overview__head">
                <h3 className="small-heading">이 위치의 의견 {atPlace.length}건</h3>
                <button type="button" className="link-btn" onClick={() => setPlace(null)}>닫기</button>
              </div>
              <OverviewList items={atPlace} />
            </div>
          ) : null}
        </section>

        <div className="overview__side">
          <section className="card" aria-labelledby="ov-cat">
            <h2 id="ov-cat" className="small-heading">분야별</h2>
            <ul className="overview__bars">
              {CATS.map((cat) => {
                const n = v.by_category[cat] ?? 0;
                return (
                  <li key={cat}>
                    <span className={`cat-label cat-label--${cat}`}>{CATEGORY_LABEL[cat]}</span>
                    <span className="overview__bar" aria-hidden="true"><span className={`overview__fill overview__fill--${cat}`} style={{ width: `${(n / maxCat) * 100}%` }} /></span>
                    <strong>{n}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card" aria-labelledby="ov-pending">
            <div className="overview__head">
              <h2 id="ov-pending" className="small-heading">검토 대기 {c.pending}건</h2>
              {c.pending > 0 ? <Link href="/admin/opinions" className="link-btn">모두 보기 →</Link> : null}
            </div>
            {pending.length === 0 ? <p className="muted small">검토할 의견이 없습니다.</p> : <OverviewList items={pending} />}
          </section>
        </div>
      </div>
    </div>
  );
}

function OverviewList({ items }: { items: Item[] }) {
  return (
    <ul className="overview__list">
      {items.map((i) => (
        <li key={i.id}>
          <Link href={`/admin/opinions/${i.id}`} className="overview__item">
            <span className="admin-row__top">
              <span className={`status status--${i.status}`}>{STATUS_LABEL[i.status]}</span>
              {i.status === 'published' && i.include_in_player ? <span className="status status--queue">상영 중</span> : null}
              <span className={`cat-label cat-label--${i.category}`}>{CATEGORY_LABEL[i.category]}</span>
              <span className="muted">{formatDate(i.created_at)}</span>
            </span>
            <span className="overview__text">{i.summary ?? i.preview}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
