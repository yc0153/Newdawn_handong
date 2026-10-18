// 로컬 DB 모드(PGlite) 검수: 같은 API 경로가 Supabase 없이 동작하는지, 권한·멱등·공개 조건이 같은지 확인한다.
// 실행: npm run test:local  (react-server 조건으로 server-only 모듈을 불러온다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET as getConfig } from '../src/app/api/public/config/route';
import { GET as getPublic } from '../src/app/api/public/opinions/route';
import { POST as postOpinion } from '../src/app/api/opinions/route';
import { closeLocalDb } from '../src/lib/backend/local-db';
import * as local from '../src/lib/backend/local';
import * as auth from '../src/lib/backend/local-auth';
import { backendMode } from '../src/lib/backend/mode';

// 환경 변수는 요청을 처리할 때 읽으므로 import 뒤에 정해도 된다.

process.env.DATA_BACKEND = 'local';
process.env.LOCAL_DB_DIR = 'memory://';
process.env.LOCAL_ADMIN_EMAIL = 'op@local.test';
process.env.LOCAL_ADMIN_PASSWORD = 'local-test-password';
delete process.env.APP_ORIGIN;
delete process.env.RATE_LIMIT_HMAC_SECRET;
delete process.env.TRUSTED_CLIENT_IP_HEADER;


const ORIGIN = 'http://localhost:3000';
type Config = { allowed_cells: { cell_x: number; cell_y: number }[]; submissions_enabled: boolean; test_auto_publish: boolean; notice_version: string; grid_version: string };

async function config(): Promise<Config> {
  const res = await getConfig();
  assert.equal(res.status, 200);
  return (await res.json()) as Config;
}
async function submit(cfg: Config, opts: { key?: string; text?: string; map?: boolean; player?: boolean; origin?: string } = {}) {
  const cell = cfg.allowed_cells[Math.floor(cfg.allowed_cells.length / 2)];
  const body = {
    grid_version: cfg.grid_version, cell_x: cell.cell_x, cell_y: cell.cell_y, category: 'transport', language: 'ko',
    original_text: opts.text ?? '버스 정류장 안내가 영어로도 있으면 좋겠습니다', allow_map: opts.map ?? true, allow_player: opts.player ?? true,
    notice_version: cfg.notice_version,
  };
  return postOpinion(new Request(`${ORIGIN}/api/opinions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: opts.origin ?? ORIGIN, 'idempotency-key': opts.key ?? randomUUID() },
    body: JSON.stringify(body),
  }));
}
async function publicList(mode: 'browse' | 'player') {
  const res = await getPublic(new NextRequest(`${ORIGIN}/api/public/opinions?mode=${mode}`));
  assert.equal(res.status, 200);
  return ((await res.json()) as { data: Record<string, unknown>[] }).data;
}

test('mode: explicit local, auto local without Supabase URL, never auto on Vercel', () => {
  assert.equal(backendMode({ DATA_BACKEND: 'local' }), 'local');
  assert.equal(backendMode({}), 'local');
  assert.equal(backendMode({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }), 'supabase');
  assert.equal(backendMode({ VERCEL: '1' }), 'supabase');
  assert.equal(backendMode({ DATA_BACKEND: 'supabase' }), 'supabase');
});

test('session token: signature, expiry and tampering', () => {
  const sub = randomUUID();
  const token = auth.issueSession(sub, 's'.repeat(64), 1000);
  assert.equal(auth.verifySession(token, 's'.repeat(64), 1001)?.sub, sub);
  assert.equal(auth.verifySession(token, 'x'.repeat(64), 1001), null);
  assert.equal(auth.verifySession(token, 's'.repeat(64), 1000 + auth.LOCAL_SESSION_TTL_S), null);
  const [p, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: randomUUID(), iat: 1000, exp: 99999 })).toString('base64url');
  assert.equal(auth.verifySession(`${forged}.${sig}`, 's'.repeat(64), 1001), null);
  assert.equal(auth.verifySession(`${p}.`, 's'.repeat(64), 1001), null);
  assert.equal(auth.verifySession(undefined, 's'.repeat(64)), null);
  const hash = auth.hashPassword('비밀번호-123');
  assert.ok(auth.verifyPassword('비밀번호-123', hash));
  assert.ok(!auth.verifyPassword('비밀번호-124', hash));
  assert.ok(!hash.includes('비밀번호'));
});

test('local DB: same API flow as Supabase without any external service', async () => {
  try {
    const cfg = await config();
    assert.equal(cfg.grid_version, 'pohang-v1');
    assert.equal(cfg.submissions_enabled, true);
    assert.equal(cfg.test_auto_publish, false);
    assert.equal(cfg.allowed_cells.length, 29264, '포항시 전체 격자가 처음 실행 때 열린다');

    // 다른 출처 요청은 막는다(APP_ORIGIN이 없으면 요청 주소 기준)
    assert.equal((await submit(cfg, { origin: 'https://evil.example' })).status, 403);

    const key = randomUUID();
    const first = await submit(cfg, { key });
    assert.equal(first.status, 201);
    const receipt = (await first.json()) as { reference: string; published: boolean };
    assert.match(receipt.reference, /^OP-/);
    assert.equal(receipt.published, false);
    const retry = await submit(cfg, { key });
    assert.equal(retry.status, 200);
    assert.equal(((await retry.json()) as { reference: string }).reference, receipt.reference);
    assert.equal((await submit(cfg, { key, text: '같은 키로 다른 내용을 보내면 거절합니다' })).status, 409);
    assert.equal((await submit(cfg, { text: '짧음' })).status, 422);

    assert.equal((await publicList('browse')).length, 0, '검토 전에는 공개되지 않는다');

    assert.equal(await local.localSignIn('op@local.test', 'wrong-password'), null);
    assert.equal(await local.localSignIn('nobody@local.test', 'local-test-password'), null);
    const userId = await local.localSignIn('OP@local.test', 'local-test-password');
    assert.ok(userId);
    assert.equal(await local.localMembershipActive(userId!), true);
    assert.equal(await local.localMembershipActive(randomUUID()), false);
    assert.equal(await local.localAccountValid(userId!, Math.floor(Date.now() / 1000)), true);
    assert.equal(await local.localAccountValid(userId!, 0), false, '계정 갱신 전에 발급된 세션은 받지 않는다');

    // 담당자 권한이 없는 사용자는 RLS로 아무것도 보지 못하고 RPC도 거절된다
    const outsider = local.localOperatorStore(randomUUID());
    assert.equal((await outsider.listOpinions({ status: 'all', page: 1, pageSize: 50 })).total, 0);

    const op = local.localOperatorStore(userId!);
    const list = await op.listOpinions({ status: 'pending', page: 1, pageSize: 50 });
    assert.equal(list.total, 1);
    const row = list.rows[0];
    assert.equal(typeof row.created_at, 'string');
    await assert.rejects(() => outsider.action({ id: row.id, expected_version: row.version, action: 'publish', summary: null, include_in_player: null }), /FORBIDDEN/);

    let v = await op.action({ id: row.id, expected_version: row.version, action: 'save_summary', summary: '영어 버스 안내 요청', include_in_player: null });
    await assert.rejects(() => op.action({ id: row.id, expected_version: row.version, action: 'publish', summary: null, include_in_player: null }), /VERSION_CONFLICT/);
    v = await op.action({ id: row.id, expected_version: v.version, action: 'publish', summary: null, include_in_player: null });
    assert.equal((await publicList('browse')).length, 1);
    assert.equal((await publicList('player')).length, 0, '상영 포함 전에는 플레이어에 없다');
    v = await op.action({ id: row.id, expected_version: v.version, action: 'set_player', summary: null, include_in_player: true });
    const player = await publicList('player');
    assert.equal(player.length, 1);
    assert.deepEqual(Object.keys(player[0]).sort(), ['category', 'location', 'public_id', 'summary']);

    const detail = await op.getOpinion(row.id);
    assert.deepEqual(detail?.audit.map((a) => a.action), ['save_summary', 'publish', 'set_player']);
    assert.equal(detail?.row.notice_version, cfg.notice_version);
    assert.equal(await op.getOpinion(randomUUID()), null);

    // 테스트 모드: 켜면 새 의견이 바로 지도·플레이어에 나온다
    assert.equal(await op.setTestAutoPublish(true), true);
    assert.equal((await config()).test_auto_publish, true);
    const auto = await submit(cfg, { text: '테스트 모드에서는 바로 상영됩니다 확인' });
    assert.equal(((await auto.json()) as { published: boolean }).published, true);
    assert.equal((await publicList('player')).length, 2);
    await op.setTestAutoPublish(false);
    const reviewed = await submit(cfg, { text: '끄면 다시 검토를 거쳐야 공개됩니다' });
    assert.equal(((await reviewed.json()) as { published: boolean }).published, false);
    assert.equal((await publicList('browse')).length, 2);

    v = await op.action({ id: row.id, expected_version: v.version, action: 'delete', summary: null, include_in_player: null });
    assert.equal(v.deleted, true);
    assert.equal((await publicList('player')).length, 1);
  } finally {
    await closeLocalDb();
  }
});

test('local DB folder: data survives restart, account file is written, second server is refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pom-local-'));
  const saved = { dir: process.env.LOCAL_DB_DIR, email: process.env.LOCAL_ADMIN_EMAIL, pw: process.env.LOCAL_ADMIN_PASSWORD };
  process.env.LOCAL_DB_DIR = dir;
  delete process.env.LOCAL_ADMIN_EMAIL;
  delete process.env.LOCAL_ADMIN_PASSWORD;
  try {
    const cfg = await config();
    assert.equal((await submit(cfg)).status, 201);
    const file = path.join(dir, 'admin-account.txt');
    assert.ok(existsSync(file));
    const text = readFileSync(file, 'utf8');
    const password = /비밀번호: (\S+)/.exec(text)?.[1];
    assert.ok(text.includes('admin@local.test') && password);
    await closeLocalDb();

    const again = await config();
    assert.equal(again.allowed_cells.length, 29264);
    const userId = await local.localSignIn('admin@local.test', password!);
    assert.ok(userId, '다시 켜도 같은 계정으로 로그인된다');
    assert.equal((await local.localOperatorStore(userId!).listOpinions({ status: 'all', page: 1, pageSize: 10 })).total, 1);
    await closeLocalDb();

    // 살아 있는 다른 프로세스가 폴더를 잡고 있으면 열지 않는다
    writeFileSync(path.join(dir, 'server.pid'), String(process.ppid));
    const busy = await getConfig();
    assert.equal(busy.status, 503);
    await closeLocalDb();
  } finally {
    await closeLocalDb();
    process.env.LOCAL_DB_DIR = saved.dir;
    process.env.LOCAL_ADMIN_EMAIL = saved.email;
    process.env.LOCAL_ADMIN_PASSWORD = saved.pw;
    rmSync(dir, { recursive: true, force: true });
  }
});
