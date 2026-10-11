// 공개 지도·플레이어가 함께 쓰는 공개 스냅샷 신선도 상태.
// - 마지막 성공 확인에서 60초가 지나면 사례를 지운다.
// - 오프라인·백그라운드 전환 즉시 사례를 지우고 진행 중 요청을 무효화한다(세대 번호).
// - 늦게 도착한 예전 세대의 응답은 버린다.
// - 조회 실패를 0건으로 표시하지 않는다.
import { canDisplayCases } from './freshness';

export type SnapshotState<T> = {
  generation: number;
  data: T[] | null;
  lastVerified: number | null;
  pending: boolean;
  failed: boolean;
  everSucceeded: boolean;
  online: boolean;
  visible: boolean;
};

export type SnapshotAction<T> =
  | { type: 'request'; generation: number }
  | { type: 'success'; generation: number; data: T[]; at: number }
  | { type: 'failure'; generation: number }
  | { type: 'connectivity'; online: boolean; visible: boolean; generation: number }
  | { type: 'expire'; now: number };

export function initialSnapshot<T>(online = true, visible = true): SnapshotState<T> {
  return { generation: 0, data: null, lastVerified: null, pending: false, failed: false, everSucceeded: false, online, visible };
}

export function snapshotReducer<T>(s: SnapshotState<T>, a: SnapshotAction<T>): SnapshotState<T> {
  switch (a.type) {
    case 'request':
      return { ...s, generation: a.generation, pending: true };
    case 'success':
      if (a.generation !== s.generation || !s.online || !s.visible) return s;
      return { ...s, data: a.data, lastVerified: a.at, pending: false, failed: false, everSucceeded: true };
    case 'failure':
      if (a.generation !== s.generation) return s;
      return { ...s, pending: false, failed: true };
    case 'connectivity':
      if (!a.online || !a.visible) {
        return { ...s, online: a.online, visible: a.visible, generation: a.generation, data: null, lastVerified: null, pending: false };
      }
      return { ...s, online: a.online, visible: a.visible };
    case 'expire':
      if (s.lastVerified !== null && !canDisplayCases(a.now, s.lastVerified, s.online, s.visible)) {
        return { ...s, data: null, lastVerified: null };
      }
      return s;
  }
}

export type SnapshotView<T> =
  | { kind: 'fresh'; cases: T[]; refreshFailing: boolean }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unverified' }
  | { kind: 'offline' }
  | { kind: 'paused' };

export function snapshotView<T>(s: SnapshotState<T>, now: number): SnapshotView<T> {
  if (!s.online) return { kind: 'offline' };
  if (!s.visible) return { kind: 'paused' };
  if (s.data && canDisplayCases(now, s.lastVerified, s.online, s.visible)) {
    return { kind: 'fresh', cases: s.data, refreshFailing: s.failed };
  }
  if (!s.everSucceeded) return s.failed ? { kind: 'error' } : { kind: 'loading' };
  return { kind: 'unverified' };
}
