'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { POLL_INTERVAL_MS } from '@/lib/domain/freshness';
import { initialSnapshot, snapshotReducer, snapshotView, type SnapshotView } from '@/lib/domain/snapshot';
import type { PublicOpinion } from '@/lib/domain/types';

const REQUEST_TIMEOUT_MS = 10_000;

function isVisible() {
  return typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
}
function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/**
 * 공개 스냅샷 조회와 신선도 제어.
 * 30초 재조회, 마지막 성공 후 60초 만료, 오프라인·백그라운드 즉시 숨김,
 * 세대 번호와 AbortController로 늦게 도착한 예전 응답 무효화.
 */
export function usePublicSnapshot(mode: 'browse' | 'player'): { view: SnapshotView<PublicOpinion>; retry: () => void } {
  const [state, dispatch] = useReducer(snapshotReducer<PublicOpinion>, undefined, () => initialSnapshot<PublicOpinion>());
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [now, setNow] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    return generation.current;
  }, []);

  const load = useCallback(async () => {
    if (!isOnline() || !isVisible()) return;
    const g = invalidate();
    const c = new AbortController();
    controller.current = c;
    const timer = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
    dispatch({ type: 'request', generation: g });
    try {
      const res = await fetch(`/api/public/opinions?mode=${mode}`, { cache: 'no-store', signal: c.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: PublicOpinion[] };
      if (!Array.isArray(body.data)) throw new Error('shape');
      if (g !== generation.current) return;
      dispatch({ type: 'success', generation: g, data: body.data, at: performance.now() });
    } catch {
      if (g === generation.current) dispatch({ type: 'failure', generation: g });
    } finally {
      clearTimeout(timer);
      setNow(performance.now());
    }
  }, [invalidate, mode]);

  // 첫 조회와 30초 주기 재조회
  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => { clearInterval(id); invalidate(); };
  }, [load, invalidate]);

  // 만료 판정 1초 주기. 화면 재생(12초)과 무관하게 성공 확인 시각만으로 판단한다.
  useEffect(() => {
    // 상태가 바뀔 때만 다시 그린다(만료 시 reducer가 data를 비움). 매초 전체 재렌더링을 피한다.
    const id = setInterval(() => dispatch({ type: 'expire', now: performance.now() }), 1000);
    return () => clearInterval(id);
  }, []);

  // 오프라인·백그라운드: 즉시 숨기고 진행 중 요청 무효화. 복귀: 새 조회가 성공해야 다시 표시.
  useEffect(() => {
    const sync = () => {
      const online = isOnline();
      const visible = isVisible();
      if (!online || !visible) {
        const g = invalidate();
        dispatch({ type: 'connectivity', online, visible, generation: g });
      } else {
        dispatch({ type: 'connectivity', online, visible, generation: generation.current });
        void load();
      }
      setNow(performance.now());
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('pagehide', sync);
    if (!isOnline() || !isVisible()) sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('pagehide', sync);
    };
  }, [invalidate, load]);

  // 만료는 'expire'가 data를 비워 반영하므로, 표시 판단에는 마지막 갱신 시각 이후의 now를 쓴다.
  const viewNow = state.lastVerified !== null ? Math.max(now, state.lastVerified) : now;
  return { view: snapshotView(state, viewNow), retry: () => { void load(); } };
}
