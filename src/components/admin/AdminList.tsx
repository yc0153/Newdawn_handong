'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AdminOpinion, ReviewStatus } from '@/lib/domain/types';
import { CATEGORY_LABEL, LANGUAGE_LABEL, STATUS_LABEL, formatDate } from './labels';

type Page = { data: AdminOpinion[]; page: number; page_size: number; total: number };
const TABS: { key: 'all' | ReviewStatus; label: string }[] = [
  { key: 'pending', label: '검토 대기' },
  { key: 'published', label: '공개' },
  { key: 'hidden', label: '숨김' },
  { key: 'all', label: '전체' },
];
const PAGE_SIZE = 50;

export default function AdminList() {
  const router = useRouter();
  const [status, setStatus] = useState<'all' | ReviewStatus>('pending');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ state: 'loading' | 'ready' | 'error'; data?: Page }>({ state: 'loading' });

  const load = useCallback(async () => {
    setResult((r) => ({ state: 'loading', data: r.data }));
    try {
      const res = await fetch(`/api/admin/opinions?status=${status}&page=${page}&page_size=${PAGE_SIZE}`, { cache: 'no-store' });
      if (res.status === 401) { router.replace('/admin/login'); return; }
      if (!res.ok) throw new Error(String(res.status));
      setResult({ state: 'ready', data: (await res.json()) as Page });
    } catch {
      setResult({ state: 'error' });
    }
  }, [status, page, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = result.data ? Math.max(1, Math.ceil(result.data.total / PAGE_SIZE)) : 1;

  return (
    <section className="card">
      <div className="admin-toolbar">
        <h1>등록 의견</h1>
        <div className="tabs" role="tablist" aria-label="검토 상태">
          {TABS.map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={status === tab.key} className="tab" onClick={() => { setStatus(tab.key); setPage(1); }}>
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--small" onClick={() => void load()}>새로고침</button>
      </div>
      <p className="muted small">원문은 담당자만 볼 수 있습니다. 공개는 작성자의 지도 공개 선택과 담당자 요약·승인이 모두 있어야 합니다.</p>
      {result.state === 'error' ? <p className="state state--error" role="alert">목록을 불러오지 못했습니다.</p> : null}
      {result.state === 'loading' && !result.data ? <p className="state" aria-busy="true">불러오는 중…</p> : null}
      {result.data && result.data.data.length === 0 ? <p className="state state--empty">해당하는 의견이 없습니다.</p> : null}
      {result.data && result.data.data.length > 0 ? (
        <ul className="admin-list" aria-busy={result.state === 'loading'}>
          {result.data.data.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/opinions/${o.id}`} className="admin-row">
                <span className="admin-row__top">
                  <span className={`status status--${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  <span className={`cat-label cat-label--${o.category}`}>{CATEGORY_LABEL[o.category]}</span>
                  <span className="muted">{LANGUAGE_LABEL[o.language]}</span>
                  <span className="muted">{formatDate(o.created_at)}</span>
                </span>
                <span className="admin-row__text">{o.original_text}</span>
                <span className="admin-row__flags">
                  <span>지도 공개 선택 {o.allow_map ? '예' : '아니오'}</span>
                  <span>플레이어 공개 선택 {o.allow_player ? '예' : '아니오'}</span>
                  {o.include_in_player ? <span>상영 포함</span> : null}
                  {o.summary ? <span>요약 있음</span> : <span>요약 없음</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {result.data && pages > 1 ? (
        <div className="pager">
          <button type="button" className="btn btn--small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
          <span>{page} / {pages} (총 {result.data.total}건)</span>
          <button type="button" className="btn btn--small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      ) : result.data ? <p className="muted small">총 {result.data.total}건</p> : null}
    </section>
  );
}
