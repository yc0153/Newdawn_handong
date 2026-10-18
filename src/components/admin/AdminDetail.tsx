'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import MapView from '@/components/map/MapView';
import type { AdminDetail as Detail } from '@/lib/domain/types';
import { textLengths, validSummary } from '@/lib/domain/validation';
import { mapProvider } from '@/lib/map/provider';
import { ACTION_LABEL, CATEGORY_LABEL, LANGUAGE_LABEL, STATUS_LABEL, formatDate } from './labels';

type ActionBody =
  | { action: 'save_summary'; summary: string }
  | { action: 'publish' | 'hide' | 'delete' }
  | { action: 'set_player'; include_in_player: boolean };

export default function AdminDetail({ id, selfId }: { id: string; selfId: string }) {
  const router = useRouter();
  const provider = useMemo(() => mapProvider(), []);
  const [detail, setDetail] = useState<{ state: 'loading' | 'ready' | 'missing' | 'error'; data?: Detail }>({ state: 'loading' });
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'conflict'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async (keepDraft: boolean) => {
    try {
      const res = await fetch(`/api/admin/opinions/${id}`, { cache: 'no-store' });
      if (res.status === 401) { router.replace('/admin/login'); return; }
      if (res.status === 404) { setDetail({ state: 'missing' }); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Detail;
      setDetail({ state: 'ready', data });
      if (!keepDraft) setSummary(data.summary ?? '');
    } catch {
      setDetail((d) => ({ state: 'error', data: d.data }));
    }
  }, [id, router]);

  useEffect(() => {
    void load(false);
  }, [load]);

  // 조치 하나 또는 여러 개를 차례로 실행한다(예: 공개 → 상영 포함). 앞 조치가 돌려준 버전으로 다음 조치를 보낸다.
  async function act(body: ActionBody | ActionBody[], okText: string) {
    if (!detail.data) return;
    const steps = Array.isArray(body) ? body : [body];
    let version = detail.data.version;
    let doneSteps = 0;
    setBusy(true);
    setMessage(null);
    try {
      for (const step of steps) {
        const res = await fetch(`/api/admin/opinions/${id}/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...step, expected_version: version }),
          cache: 'no-store',
        });
        const json = await res.json().catch(() => null);
        if (res.status === 401) { router.replace('/admin/login'); return; }
        if (!res.ok) {
          const code = json?.error?.code as string | undefined;
          if (code === 'VERSION_CONFLICT') {
            setMessage({ kind: 'conflict', text: '다른 담당자가 먼저 변경했습니다. 최신 내용을 불러온 뒤 다시 확인해 주세요. 작성 중인 요약은 유지됩니다.' });
          } else if (res.status === 404) {
            setDetail({ state: 'missing' });
          } else {
            const partial = doneSteps > 0 ? '앞 단계는 처리되었습니다. ' : '';
            setMessage({ kind: 'error', text: partial + (json?.error?.message ?? '처리하지 못했습니다.') });
          }
          if (doneSteps > 0) await load(true);
          return;
        }
        if (step.action === 'delete') { setDeleted(true); return; }
        version = (json as { version: number }).version;
        doneSteps += 1;
      }
      setMessage({ kind: 'ok', text: okText });
      await load(false);
    } catch {
      setMessage({ kind: 'error', text: '연결 문제로 결과를 확인하지 못했습니다. 최신 내용을 불러와 확인해 주세요.' });
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <section className="card">
        <h1>삭제했습니다.</h1>
        <p className="muted">공개 지도와 플레이어에서 제외되었고 원문과 요약을 비웠습니다. 중복 방지 기록과 최소 작업 이력만 남습니다.</p>
        <Link href="/admin/opinions" className="btn btn--primary">목록으로</Link>
      </section>
    );
  }
  if (detail.state === 'missing') {
    return (
      <section className="card">
        <h1>의견을 찾을 수 없습니다.</h1>
        <p className="muted">이미 삭제되었거나 없는 의견입니다.</p>
        <Link href="/admin/opinions" className="btn">목록으로</Link>
      </section>
    );
  }
  if (!detail.data) {
    return <section className="card"><p className="state" aria-busy={detail.state === 'loading'}>{detail.state === 'error' ? '불러오지 못했습니다.' : '불러오는 중…'}</p></section>;
  }

  const d = detail.data;
  const dirty = summary !== (d.summary ?? '');
  const summaryLen = textLengths(summary).total;
  const summaryValid = validSummary(summary);
  // 고친 요약이 있으면 공개 버튼이 요약 저장부터 함께 한다(요약 저장 → 공개 → 상영 포함 순서, 각각 이력에 남음).
  const canPublish = d.allow_map && d.status !== 'published' && (dirty ? summaryValid : !!d.summary);
  const saveFirst: ActionBody[] = dirty ? [{ action: 'save_summary', summary }] : [];
  const canPlayer = d.allow_map && d.allow_player;
  const group = [{ key: d.id, lat: d.location.lat, lon: d.location.lon, count: 1, category: d.category, active: true, label: '대략 위치' }];

  return (
    <div className="admin-detail">
      <p><Link href="/admin/opinions" className="link-btn">← 목록</Link></p>
      {message ? (
        <div className={`state ${message.kind === 'ok' ? 'state--ok' : message.kind === 'conflict' ? 'state--warn' : 'state--error'}`} role={message.kind === 'ok' ? 'status' : 'alert'}>
          <p>{message.text}</p>
          {message.kind !== 'ok' ? <button type="button" className="btn btn--small" onClick={() => { setMessage(null); void load(true); }}>최신 내용 불러오기</button> : null}
        </div>
      ) : null}
      {d.status === 'published' && canPlayer && !d.include_in_player ? (
        <div className="callout" role="region" aria-label="플레이어 상영 안내">
          <p><strong>지도에는 공개되었지만 플레이어에는 아직 나오지 않습니다.</strong> 작성자가 플레이어 공개도 선택했습니다. 플레이어에도 상영할까요?</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void act({ action: 'set_player', include_in_player: true }, '상영에 포함했습니다. 플레이어에 바로 반영됩니다.')}>플레이어에도 상영</button>
        </div>
      ) : null}
      <div className="admin-detail__grid">
        <section className="card">
          <div className="admin-row__top">
            <span className={`status status--${d.status}`}>{STATUS_LABEL[d.status]}</span>
            <span className={`cat-label cat-label--${d.category}`}>{CATEGORY_LABEL[d.category]}</span>
            <span className="muted">{LANGUAGE_LABEL[d.language]}</span>
            <span className="muted">{formatDate(d.created_at)}</span>
          </div>
          <h1 className="visually-hidden">의견 상세</h1>
          <h2 className="small-heading">원문 (비공개)</h2>
          <p className="original-text">{d.original_text}</p>
          <dl className="facts">
            <div><dt>작성자 지도 공개 선택</dt><dd>{d.allow_map ? '예' : '아니오'}</dd></div>
            <div><dt>작성자 플레이어 공개 선택</dt><dd>{d.allow_player ? '예' : '아니오'}</dd></div>
            <div><dt>상영 포함</dt><dd>{d.include_in_player ? '예' : '아니오'}</dd></div>
            <div><dt>공개 안내 버전</dt><dd>{d.notice_version}</dd></div>
            <div><dt>대략 위치</dt><dd>{d.location.lat.toFixed(5)}, {d.location.lon.toFixed(5)} (약 200m 격자 대표점)</dd></div>
          </dl>
          <p className="muted small">작성자의 공개 선택은 담당자가 바꿀 수 없습니다. 민감한 내용이 있으면 위치를 흐리는 것으로 공개하지 말고 숨김 상태로 두세요.</p>
          <div className="admin-map"><MapView provider={provider} ariaLabel="의견의 대략 위치" groups={group} focus={{ lat: d.location.lat, lon: d.location.lon, zoom: 15, token: 1 }} compact /></div>
        </section>

        <section className="card">
          <h2 className="small-heading">담당자 공개 요약</h2>
          <label htmlFor="summary" className="visually-hidden">담당자 요약</label>
          <textarea id="summary" rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={busy || d.status === 'published'} aria-describedby="summary-help" />
          <div className="field-foot">
            <span id="summary-help" className="muted">
              {d.status === 'published' ? '공개 중인 요약은 먼저 숨긴 뒤 수정할 수 있습니다.' : '공백만으로 만들 수 없고 250자 이하입니다. 원문을 그대로 붙이지 말고 개인정보 없이 요약하세요.'}
            </span>
            <span className={summaryLen > 250 ? 'counter counter--over' : 'counter'}>{summaryLen} / 250</span>
          </div>
          <div className="action-row">
            <button type="button" className="btn" disabled={busy || d.status === 'published' || !dirty || !summaryValid} onClick={() => void act({ action: 'save_summary', summary }, '요약을 저장했습니다.')}>요약 저장</button>
            {d.status !== 'published' && canPlayer ? (
              <button type="button" className="btn btn--primary" disabled={busy || !canPublish} onClick={() => void act([...saveFirst, { action: 'publish' }, { action: 'set_player', include_in_player: true }], '지도에 공개하고 플레이어 상영에도 넣었습니다. 바로 반영됩니다.')}>지도·플레이어에 공개</button>
            ) : null}
            {d.status !== 'published' ? (
              <button type="button" className={canPlayer ? 'btn' : 'btn btn--primary'} disabled={busy || !canPublish} onClick={() => void act([...saveFirst, { action: 'publish' }], '공개했습니다. 공개 지도에 바로 반영됩니다.')}>{canPlayer ? '지도에만 공개' : '지도에 공개'}</button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: 'hide' }, '숨겼습니다. 공개 지도와 플레이어에서 제외됩니다.')}>숨김</button>
            )}
            {d.status === 'pending' ? <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: 'hide' }, '숨김으로 두었습니다.')}>공개하지 않고 숨김</button> : null}
          </div>
          {!d.allow_map ? <p className="muted small">작성자가 지도 공개를 선택하지 않아 공개할 수 없습니다.</p> : null}
          {d.allow_map && dirty && d.status !== 'published' ? <p className="muted small">{summaryValid ? '공개 버튼을 누르면 고친 요약을 먼저 저장한 뒤 공개합니다.' : '요약을 250자 이하로 입력해야 공개할 수 있습니다.'}</p> : null}
          {d.allow_map && !d.summary && !dirty && d.status !== 'published' ? <p className="muted small">공개하려면 먼저 공개 요약을 입력하세요.</p> : null}

          <h2 className="small-heading">플레이어 상영</h2>
          {canPlayer ? (
            <div className="action-row">
              <button type="button" className="btn" disabled={busy} aria-pressed={d.include_in_player} onClick={() => void act({ action: 'set_player', include_in_player: !d.include_in_player }, d.include_in_player ? '상영에서 뺐습니다.' : '상영에 포함했습니다. 공개 상태일 때 플레이어에 나옵니다.')}>
                {d.include_in_player ? '상영에서 빼기' : '상영에 포함'}
              </button>
              <span className="muted small">{d.status === 'published' ? '숨기면 상영 포함도 해제됩니다.' : '공개한 뒤에 플레이어에 나옵니다.'}</span>
            </div>
          ) : <p className="muted small">작성자가 지도와 플레이어 공개를 모두 선택한 의견만 상영할 수 있습니다.</p>}

          <h2 className="small-heading">삭제</h2>
          {!confirmDelete ? (
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirmDelete(true)}>삭제…</button>
          ) : (
            <div className="danger-box" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-body">
              <strong id="del-title">이 의견을 삭제할까요?</strong>
              <p id="del-body">공개에서 즉시 빠지고 원문과 요약이 지워집니다. 되돌릴 수 없습니다.</p>
              <div className="action-row">
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void act({ action: 'delete' }, '')}>삭제 확인</button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>취소</button>
              </div>
            </div>
          )}

          <h2 className="small-heading">작업 이력</h2>
          {d.audit_logs.length === 0 ? <p className="muted small">아직 작업 이력이 없습니다.</p> : (
            <ol className="audit">
              {d.audit_logs.map((a, i) => (
                <li key={i}>
                  <span>{ACTION_LABEL[a.action]}</span>
                  <span className="muted">{formatDate(a.created_at)}</span>
                  <span className="muted">담당자 {a.actor_id === selfId ? '(나)' : a.actor_id.slice(0, 8)}</span>
                  <span className="muted">v{a.version}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
