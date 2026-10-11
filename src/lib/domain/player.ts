// 플레이어 상태 전이. 화면 타이머와 분리된 순수 함수로 두어 검수한다.
// 규칙: 첫 진입 정지, 재생은 명시적 조작으로만 시작, 수동 이동 후 정지,
// 현재 사례가 사라지면 정지 후 같은 순번의 다음 유효 사례, 2건 미만이면 재생하지 않는다.
// 선택은 순번이 아니라 public_id로 유지하고, index는 철회 시 대체 사례를 고르는 데만 쓴다.
export type PlayerState = { currentId: string | null; index: number; playing: boolean };
export type PlayerAction =
  | { type: 'data'; ids: string[] }
  | { type: 'next'; ids: string[] }
  | { type: 'prev'; ids: string[] }
  | { type: 'toggle'; ids: string[] }
  | { type: 'tick'; ids: string[] }
  | { type: 'suspend' };

export const initialPlayer: PlayerState = { currentId: null, index: 0, playing: false };

function at(ids: string[], index: number, playing: boolean): PlayerState {
  if (ids.length === 0) return { currentId: null, index: 0, playing: false };
  const i = ((index % ids.length) + ids.length) % ids.length;
  return { currentId: ids[i], index: i, playing: playing && ids.length > 1 };
}

function position(ids: string[], state: PlayerState): number {
  const i = state.currentId === null ? -1 : ids.indexOf(state.currentId);
  return i >= 0 ? i : Math.min(state.index, Math.max(ids.length - 1, 0));
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'suspend':
      return state.playing ? { ...state, playing: false } : state;
    case 'data': {
      const { ids } = action;
      if (ids.length === 0) return { currentId: null, index: 0, playing: false };
      if (state.currentId === null) return at(ids, 0, false);
      const i = ids.indexOf(state.currentId);
      if (i >= 0) return { currentId: state.currentId, index: i, playing: state.playing && ids.length > 1 };
      // 현재 사례가 철회됨: 정지하고 같은 순번(끝이면 마지막)의 유효 사례로 바꾼다.
      return at(ids, Math.min(state.index, ids.length - 1), false);
    }
    case 'next':
    case 'prev':
      return at(action.ids, position(action.ids, state) + (action.type === 'next' ? 1 : -1), false);
    case 'toggle':
      if (action.ids.length < 2) return { ...state, playing: false };
      return { ...state, playing: !state.playing };
    case 'tick':
      if (!state.playing) return state;
      if (action.ids.length < 2) return { ...state, playing: false };
      return at(action.ids, position(action.ids, state) + 1, true);
  }
}
