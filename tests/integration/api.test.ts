// 연결 검수: Next Route Handler ↔ Supabase Auth·PostgREST·Postgres RLS.
// 실행: 로컬 Supabase + `npm run dev` 상태에서 `npm run test:integration`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  admin, adminAction, adminGet, BASE, ensureUser, idByReference, IP_HEADER, loginCookie,
  PUBLISHABLE, publicData, publicIdOf, SB_URL, submit, validBody,
} from './helpers';

const OP1 = { email: 'it-op1@local.test', password: 'it-pass-op1-1234' };
const OP2 = { email: 'it-op2@local.test', password: 'it-pass-op2-1234' };
const USER = { email: 'it-user@local.test', password: 'it-pass-user-1234' };
const OFF = { email: 'it-off@local.test', password: 'it-pass-off-1234' };

test.before(async () => {
  await ensureUser(OP1.email, OP1.password, true);
  await ensureUser(OP2.email, OP2.password, true);
  await ensureUser(USER.email, USER.password, null);
  await ensureUser(OFF.email, OFF.password, false);
});

async function newOpinion(over: Record<string, unknown> = {}) {
  const r = await submit(validBody(over));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { reference: r.body.reference as string, id: await idByReference(r.body.reference) };
}

test('public endpoints: no-store, 4 fields only, mode validation', async () => {
  const r = await publicData();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
  for (const row of r.body.data) assert.deepEqual(Object.keys(row).sort(), ['category', 'location', 'public_id', 'summary']);
  const bad = await fetch(`${BASE}/api/public/opinions?mode=raw`);
  assert.equal(bad.status, 400);
  const cfg = await fetch(`${BASE}/api/public/config`);
  const body = await cfg.json();
  assert.deepEqual(Object.keys(body).sort(), ['allowed_cells', 'grid_version', 'notice_version', 'submissions_enabled']);
});

test('submission validation, idempotency, consent dependency and receipt format (T07, T11, X03-X05)', async () => {
  const key = randomUUID();
  const body = validBody({ allow_map: false, allow_player: false });
  const first = await submit(body, { key });
  assert.equal(first.status, 201);
  assert.match(first.body.reference, /^OP-[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(first.body).sort(), ['message', 'reference']);
  const retry = await submit(body, { key });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reference, first.body.reference);
  const conflict = await submit({ ...body, original_text: body.original_text + ' 수정' }, { key });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const { count } = await admin.from('submission_receipts').select('*', { count: 'exact', head: true }).eq('request_key', key);
  assert.equal(count, 1);

  // 동시 요청 5개도 1건만 생성한다.
  const k2 = randomUUID();
  const b2 = validBody();
  const parallel = await Promise.all(Array.from({ length: 5 }, () => submit(b2, { key: k2 })));
  assert.equal(parallel.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(parallel.map((r) => r.body.reference)).size, 1);

  const consent = await submit(validBody({ allow_map: false, allow_player: true }));
  assert.equal(consent.status, 422);
  assert.equal(consent.body.error.code, 'INVALID_CONSENT');
  const precise = await submit({ ...validBody(), lat: 36.05, lon: 129.39 });
  assert.equal(precise.status, 400);
  const outside = await submit(validBody({ cell_x: 0, cell_y: 0 }));
  assert.equal(outside.status, 422);
  assert.equal(outside.body.error.field, 'location');
  const short = await submit(validBody({ original_text: '123456789 　' }));
  assert.equal(short.status, 422);
  assert.equal(short.body.error.code, 'TEXT_TOO_SHORT');
  const long = await submit(validBody({ original_text: 'x'.repeat(501) }));
  assert.equal(long.status, 422);
  const at500 = await submit(validBody({ original_text: '가'.repeat(500) }));
  assert.equal(at500.status, 201);
  const html = await submit(validBody({ original_text: '<script>alert(1)</script> 테스트 문자열' }));
  assert.equal(html.status, 201);
  const badKey = await submit(validBody(), { headers: { 'idempotency-key': 'not-a-uuid' } });
  assert.equal(badKey.status, 400);
  const foreign = await submit(validBody(), { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
});

test('rate limit: 5 per 10 minutes per trusted client, retries not counted, forged XFF ignored (X06, X07)', async (t) => {
  if (!IP_HEADER) { t.skip('TRUSTED_CLIENT_IP_HEADER not set for this server'); return; }
  const ip = `192.0.2.${Math.floor(Math.random() * 200) + 10}`;
  const keys: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  for (let i = 0; i < 5; i++) {
    const key = randomUUID();
    const body = validBody({ allow_map: false, allow_player: false });
    keys.push(key); bodies.push(body);
    const r = await submit(body, { key, ip, headers: { 'x-forwarded-for': `203.0.113.${i}` } });
    assert.equal(r.status, 201);
  }
  const retry = await submit(bodies[0], { key: keys[0], ip });
  assert.equal(retry.status, 200, 'same successful retry is not limited');
  const sixth = await submit(validBody(), { ip, headers: { 'x-forwarded-for': '203.0.113.99' } });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'RATE_LIMITED');
});

test('anonymous and publishable-key access cannot read raw data or call privileged RPCs (T14)', async () => {
  const anon = createClient(SB_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const raw = await anon.from('opinions').select('original_text');
  assert.ok(raw.error, 'anon table read must fail');
  for (const fn of ['read_public_opinions', 'read_public_config', 'cleanup_expired_rate_buckets']) {
    const r = await anon.rpc(fn);
    assert.ok(r.error, `anon must not execute ${fn}`);
  }
  const s = await anon.rpc('submit_opinion', {});
  assert.ok(s.error);
  const a = await anon.rpc('admin_opinion_action', { p_id: randomUUID(), p_expected_version: 1, p_action: 'publish' });
  assert.ok(a.error);
  for (const table of ['submission_receipts', 'rate_buckets', 'allowed_cells', 'service_settings', 'admin_audit_logs', 'operator_memberships']) {
    const r = await anon.from(table).select('*');
    assert.ok(r.error, `anon must not read ${table}`);
  }
  const listed = await adminGet('/api/admin/opinions');
  assert.equal(listed.status, 401);
  const act = await adminAction(randomUUID(), { action: 'hide', expected_version: 1 });
  assert.equal(act.status, 401);
});

test('authenticated non-operator and inactive operator are denied everywhere (T14, X11)', async () => {
  const { id } = await newOpinion();
  for (const who of [USER, OFF]) {
    const session = await loginCookie(who.email, who.password);
    assert.equal((await adminGet('/api/admin/opinions', session.cookie)).status, 403);
    assert.equal((await adminGet(`/api/admin/opinions/${id}`, session.cookie)).status, 403);
    assert.equal((await adminAction(id, { action: 'hide', expected_version: 1 }, session.cookie)).status, 403);
    const direct = createClient(SB_URL, PUBLISHABLE, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
    });
    const rows = await direct.from('opinions').select('original_text');
    assert.deepEqual(rows.data ?? [], [], 'RLS returns no rows');
    const rpc = await direct.rpc('admin_opinion_action', { p_id: id, p_expected_version: 1, p_action: 'hide' });
    assert.ok(rpc.error);
    const upd = await direct.from('opinions').update({ status: 'published' }).eq('id', id).select();
    assert.ok(upd.error || (upd.data ?? []).length === 0);
  }
  // user_metadata 조작으로 권한을 얻지 못한다.
  const session = await loginCookie(USER.email, USER.password);
  await admin.auth.admin.updateUserById(session.userId, { user_metadata: { isAdmin: true, role: 'operator' } });
  const again = await loginCookie(USER.email, USER.password);
  assert.equal((await adminGet('/api/admin/opinions', again.cookie)).status, 403);
});

test('full review lifecycle, public truth table and withdrawal (T08-T11, X08, X10)', async () => {
  const op = await loginCookie(OP1.email, OP1.password);
  const { id, reference } = await newOpinion({ allow_map: true, allow_player: true });
  const publicId = await publicIdOf(id);
  const inBrowse = async () => (await publicData('browse')).body.data.some((o) => o.public_id === publicId);
  const inPlayer = async () => (await publicData('player')).body.data.some((o) => o.public_id === publicId);

  assert.equal(await inBrowse(), false, 'pending is not public');
  const detail = await adminGet(`/api/admin/opinions/${id}`, op.cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, 'pending');
  assert.ok(!('request_key' in detail.body) && !('fingerprint' in detail.body) && !('public_id' in detail.body));
  let v = detail.body.version as number;

  const noSummary = await adminAction(id, { action: 'publish', expected_version: v }, op.cookie);
  assert.equal(noSummary.status, 422);
  const blank = await adminAction(id, { action: 'save_summary', expected_version: v, summary: ' 　 ' }, op.cookie);
  assert.equal(blank.status, 422);
  const tooLong = await adminAction(id, { action: 'save_summary', expected_version: v, summary: 'a'.repeat(251) }, op.cookie);
  assert.equal(tooLong.status, 422);
  let r = await adminAction(id, { action: 'save_summary', expected_version: v, summary: '[연결검수] 담당자 요약' }, op.cookie);
  assert.equal(r.status, 200); v = r.body.version;
  r = await adminAction(id, { action: 'publish', expected_version: v }, op.cookie);
  assert.equal(r.status, 200); v = r.body.version;
  assert.equal(await inBrowse(), true);
  assert.equal(await inPlayer(), false, 'player needs operator inclusion');
  r = await adminAction(id, { action: 'set_player', expected_version: v, include_in_player: true }, op.cookie);
  assert.equal(r.status, 200); v = r.body.version;
  assert.equal(await inPlayer(), true);
  const row = (await publicData('browse')).body.data.find((o) => o.public_id === publicId)!;
  assert.deepEqual(Object.keys(row).sort(), ['category', 'location', 'public_id', 'summary']);
  assert.equal(row.summary, '[연결검수] 담당자 요약');

  const editPublished = await adminAction(id, { action: 'save_summary', expected_version: v, summary: '바꾼 요약' }, op.cookie);
  assert.equal(editPublished.status, 409);
  assert.equal(editPublished.body.error.code, 'HIDE_BEFORE_EDIT');

  r = await adminAction(id, { action: 'hide', expected_version: v }, op.cookie);
  assert.equal(r.status, 200); v = r.body.version;
  assert.equal(await inBrowse(), false, 'hidden immediately excluded');
  r = await adminAction(id, { action: 'save_summary', expected_version: v, summary: '[연결검수] 고친 요약' }, op.cookie);
  assert.equal(r.status, 200); v = r.body.version;
  r = await adminAction(id, { action: 'publish', expected_version: v }, op.cookie);
  v = r.body.version;
  assert.equal(await inBrowse(), true);
  assert.equal(await inPlayer(), false, 'hide reset player inclusion; needs re-confirmation');

  // 같은 버전으로 두 담당자가 동시에 변경하면 1건만 성공한다.
  const op2 = await loginCookie(OP2.email, OP2.password);
  const both = await Promise.all([
    adminAction(id, { action: 'set_player', expected_version: v, include_in_player: true }, op.cookie),
    adminAction(id, { action: 'hide', expected_version: v }, op2.cookie),
  ]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
  const latest = await adminGet(`/api/admin/opinions/${id}`, op.cookie);
  v = latest.body.version;

  const del = await adminAction(id, { action: 'delete', expected_version: v }, op.cookie);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);
  assert.equal(await inBrowse(), false);
  assert.equal(await inPlayer(), false);
  assert.equal((await adminGet(`/api/admin/opinions/${id}`, op.cookie)).status, 404);
  const tomb = await admin.from('opinions').select('original_text,summary,status,deleted_at').eq('id', id).single();
  assert.equal(tomb.data!.original_text, null);
  assert.equal(tomb.data!.summary, null);

  const audit = await admin.from('admin_audit_logs').select('*').eq('opinion_id', id);
  const actions = (audit.data ?? []).map((a) => a.action);
  assert.ok(actions.includes('delete') && actions.includes('publish') && actions.includes('hide'));
  for (const a of audit.data ?? []) assert.ok(!('original_text' in a) && !('summary' in a));
  assert.ok(reference.startsWith('OP-'));
});

test('non-consented opinions cannot be published or played (T11)', async () => {
  const op = await loginCookie(OP1.email, OP1.password);
  const none = await newOpinion({ allow_map: false, allow_player: false });
  let r = await adminAction(none.id, { action: 'save_summary', expected_version: 1, summary: '[연결검수] 요약' }, op.cookie);
  r = await adminAction(none.id, { action: 'publish', expected_version: r.body.version }, op.cookie);
  assert.equal(r.status, 422);
  const mapOnly = await newOpinion({ allow_map: true, allow_player: false });
  r = await adminAction(mapOnly.id, { action: 'set_player', expected_version: 1, include_in_player: true }, op.cookie);
  assert.equal(r.status, 422);
});

test('deleted opinion: same-key retry returns the receipt without recreating (X05)', async () => {
  const op = await loginCookie(OP1.email, OP1.password);
  const key = randomUUID();
  const body = validBody();
  const first = await submit(body, { key });
  const id = await idByReference(first.body.reference);
  const del = await adminAction(id, { action: 'delete', expected_version: 1 }, op.cookie);
  assert.equal(del.status, 200);
  const again = await submit(body, { key });
  assert.equal(again.status, 200);
  assert.equal(again.body.reference, first.body.reference);
  const { count } = await admin.from('submission_receipts').select('*', { count: 'exact', head: true }).eq('request_key', key);
  assert.equal(count, 1);
});

test('deactivating an operator revokes access on the next request (X11)', async () => {
  const email = `it-tmp-${randomUUID().slice(0, 6)}@local.test`;
  const userId = await ensureUser(email, 'it-pass-tmp-1234', true);
  const s = await loginCookie(email, 'it-pass-tmp-1234');
  assert.equal((await adminGet('/api/admin/opinions', s.cookie)).status, 200);
  await admin.from('operator_memberships').update({ active: false }).eq('user_id', userId);
  assert.equal((await adminGet('/api/admin/opinions', s.cookie)).status, 403);
});

test('admin list: paging, status filter, deleted excluded, private keys absent', async () => {
  const op = await loginCookie(OP1.email, OP1.password);
  const r = await adminGet('/api/admin/opinions?status=pending&page=1&page_size=5', op.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.page_size, 5);
  assert.ok(r.body.data.length <= 5);
  for (const row of r.body.data) {
    assert.equal(row.status, 'pending');
    assert.deepEqual(Object.keys(row).sort(), ['allow_map', 'allow_player', 'category', 'created_at', 'id', 'include_in_player', 'language', 'location', 'original_text', 'status', 'summary', 'version'].sort());
  }
  assert.equal((await adminGet('/api/admin/opinions?page_size=101', op.cookie)).status, 400);
  assert.equal((await adminGet('/api/admin/opinions?status=deleted', op.cookie)).status, 400);
  const foreign = await adminAction(randomUUID(), { action: 'hide', expected_version: 1 }, op.cookie, 'https://evil.example');
  assert.equal(foreign.status, 403);
  const unknown = await adminAction(randomUUID(), { action: 'hide', expected_version: 1, summary: 'x' }, op.cookie);
  assert.equal(unknown.status, 400);
  const missing = await adminAction(randomUUID(), { action: 'hide', expected_version: 1 }, op.cookie);
  assert.equal(missing.status, 404);
});
