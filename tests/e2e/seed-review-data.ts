// 로컬 검수 화면용 데이터. 실제 의견이 아님을 밝히는 [검수용] 표시를 붙인다. 운영 DB에 쓰지 않는다.
import { adminAction, ensureUser, idByReference, loginCookie, submit, validBody } from '../integration/helpers';

const OP = { email: 'it-op1@local.test', password: 'it-pass-op1-1234' };
const rows = [
  { cell_x: 40, cell_y: 44, category: 'language', summary: '[검수용] 정류장 노선 안내를 영어로도 표시해 주면 좋겠다는 의견', player: true },
  { cell_x: 40, cell_y: 44, category: 'transport', summary: '[검수용] 같은 위치의 두 번째 의견: 횡단보도 신호 시간이 짧다는 의견', player: true },
  { cell_x: 35, cell_y: 30, category: 'environment', summary: '[검수용] 공원 쓰레기 분리배출 안내가 한국어로만 있다는 의견', player: true },
  { cell_x: 44, cell_y: 36, category: 'other', summary: '[검수용] 주민센터 이용 시간 안내를 찾기 어렵다는 의견', player: false },
  // 공개했지만 아직 상영에 넣지 않은 의견(담당자 목록의 '상영 대기' 확인용)
  { cell_x: 31, cell_y: 40, category: 'transport', summary: '[검수용] 버스 도착 안내 화면이 정류장에 없다는 의견', player: true, queue: true },
];

async function main() {
  await ensureUser(OP.email, OP.password, true);
  const op = await loginCookie(OP.email, OP.password);
  for (const r of rows) {
    const s = await submit(validBody({ cell_x: r.cell_x, cell_y: r.cell_y, category: r.category, original_text: `[검수용 원문] ${r.summary}`, allow_map: true, allow_player: r.player }));
    const id = await idByReference(s.body.reference);
    let v = (await adminAction(id, { action: 'save_summary', expected_version: 1, summary: r.summary }, op.cookie)).body.version;
    v = (await adminAction(id, { action: 'publish', expected_version: v }, op.cookie)).body.version;
    if (r.player && !('queue' in r)) await adminAction(id, { action: 'set_player', expected_version: v, include_in_player: true }, op.cookie);
  }
  console.log('seeded', rows.length);
}
void main();
