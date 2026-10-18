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
    <>
    <TestModeSwitch onChanged={() => void load()} />
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
      <p className="muted small">원문은 담당자만 볼 수 있습니다. 공개는 작성자의 지도 공개 선택과 담당자 요약·승인이 모두 있어야 합니다. 플레이어에는 공개한 뒤 ‘상영에 포함’한 의견만 나옵니다(‘상영 대기’ 표시).</p>
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
                  {o.status === 'published' && o.include_in_player ? <span className="status status--queue">상영 중</span> : null}
                  {o.status === 'published' && o.allow_map && o.allow_player && !o.include_in_player ? <span className="status status--queue">상영 대기</span> : null}
                  <span className={`cat-label cat-label--${o.category}`}>{CATEGORY_LABEL[o.category]}</span>
                  <span className="muted">{LANGUAGE_LABEL[o.language]}</span>
                  <span className="muted">{formatDate(o.created_at)}</span>
                </span>
                <span className="admin-row__text">{o.original_text}</span>
                <span className="admin-row__flags">
                  <span>지도 공개 선택 {o.allow_map ? '예' : '아니오'}</span>
                  <span>플레이어 공개 선택 {o.allow_player ? '예' : '아니오'}</span>
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
    </>
  );
}

type Settings = { test_auto_publish: boolean; test_auto_publish_supported: boolean };

/** 테스트 모드(검토 없이 바로 공개) 켜기·끄기. 팀 테스트에서만 쓰고 정식 운영 전에는 끈다. */
function TestModeSwitch({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setSettings(d as Settings); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!settings) return null;
  async function toggle() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ test_auto_publish: !settings.test_auto_publish }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error?.message ?? '바꾸지 못했습니다.'); return; }
      setSettings({ ...settings, test_auto_publish: Boolean(json?.test_auto_publish) });
      onChanged();
    } catch {
      setError('연결 문제로 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  const on = settings.test_auto_publish;
  return (
    <section className={`card test-mode${on ? ' test-mode--on' : ''}`} aria-labelledby="test-mode-title">
      <div className="test-mode__text">
        <h2 id="test-mode-title" className="small-heading">테스트 모드 · 검토 없이 바로 공개 <span className={`status ${on ? 'status--published' : 'status--hidden'}`}>{on ? '켜짐' : '꺼짐'}</span></h2>
        <p className="muted small">
          켜면 새로 들어오는 의견 중 작성자가 지도 공개를 고른 것은 원문 앞 250자를 요약으로 바로 공개하고, 플레이어 공개도 고른 것은 바로 상영합니다.
          이미 들어온 의견은 바뀌지 않습니다. 링크를 아는 누구나 쓸 수 있으므로 팀 테스트 중에만 켜고, 정식 운영 전에는 꼭 끄세요.
        </p>
        {!settings.test_auto_publish_supported ? <p className="state state--warn small">DB에 테스트 모드 SQL이 아직 적용되지 않았습니다. supabase/manual/2026-10-19_test_auto_publish.sql을 SQL Editor에서 실행하면 켤 수 있습니다.</p> : null}
        {error ? <p className="state state--error small" role="alert">{error}</p> : null}
      </div>
      <button type="button" className={on ? 'btn' : 'btn btn--primary'} onClick={() => void toggle()} disabled={busy || !settings.test_auto_publish_supported} aria-pressed={on}>
        {on ? '테스트 모드 끄기' : '테스트 모드 켜기'}
      </button>
    </section>
  );
}
