import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPlayer, playerReducer, type PlayerState } from '../src/lib/domain/player';
import { initialSnapshot, snapshotReducer, snapshotView, type SnapshotState } from '../src/lib/domain/snapshot';
import { cellBounds, quantize, representative } from '../src/lib/domain/grid';
import { readJsonObject, HttpError, assertSameOrigin } from '../src/lib/api/http';
import { fingerprint, rateKeyHash, serverReadyForSubmissions } from '../src/lib/api/submission';
import { mapDbError } from '../src/lib/api/db-errors';
import { parseAdminAction, AdminInputError } from '../src/lib/api/admin-dto';
import { validateSubmission } from '../src/lib/domain/validation';

const ids = ['a', 'b', 'c'];
const run = (s: PlayerState, ...actions: Parameters<typeof playerReducer>[1][]) => actions.reduce(playerReducer, s);

test('player: initial stop, explicit play, 12s tick cycles, manual move stops', () => {
  let s = run(initialPlayer, { type: 'data', ids });
  assert.deepEqual(s, { currentId: 'a', index: 0, playing: false });
  s = run(s, { type: 'tick', ids });
  assert.equal(s.currentId, 'a', 'tick while stopped does nothing');
  s = run(s, { type: 'toggle', ids }, { type: 'tick', ids }, { type: 'tick', ids }, { type: 'tick', ids });
  assert.deepEqual(s, { currentId: 'a', index: 0, playing: true }, 'wraps after the last case');
  s = run(s, { type: 'next', ids });
  assert.deepEqual(s, { currentId: 'b', index: 1, playing: false });
  s = run(s, { type: 'toggle', ids }, { type: 'prev', ids });
  assert.deepEqual(s, { currentId: 'a', index: 0, playing: false }, 'manual prev stops playback');
  s = run(s, { type: 'prev', ids });
  assert.equal(s.currentId, 'c');
});

test('player: 0 and 1 case never play; withdrawn current case stops and picks next valid', () => {
  assert.deepEqual(run(initialPlayer, { type: 'data', ids: [] }, { type: 'toggle', ids: [] }), { currentId: null, index: 0, playing: false });
  assert.equal(run(initialPlayer, { type: 'data', ids: ['x'] }, { type: 'toggle', ids: ['x'] }).playing, false);
  let s = run(initialPlayer, { type: 'data', ids }, { type: 'next', ids }, { type: 'toggle', ids });
  assert.deepEqual(s, { currentId: 'b', index: 1, playing: true });
  s = run(s, { type: 'data', ids: ['a', 'c'] });
  assert.deepEqual(s, { currentId: 'c', index: 1, playing: false }, 'b withdrawn → next at same position, stopped');
  s = run(s, { type: 'data', ids: ['a'] });
  assert.deepEqual(s, { currentId: 'a', index: 0, playing: false });
  s = run(s, { type: 'data', ids: [] });
  assert.equal(s.currentId, null);
  // selection is kept by id when new cases are inserted before it
  s = run(initialPlayer, { type: 'data', ids }, { type: 'next', ids }, { type: 'data', ids: ['z', 'a', 'b', 'c'] });
  assert.deepEqual(s, { currentId: 'b', index: 2, playing: false });
  // suspend (offline/background/stale) stops playback but keeps the case
  s = run(s, { type: 'toggle', ids: ['z', 'a', 'b', 'c'] }, { type: 'suspend' });
  assert.deepEqual(s, { currentId: 'b', index: 2, playing: false });
});

type Row = { id: string };
const reduce = (s: SnapshotState<Row>, ...a: Parameters<typeof snapshotReducer<Row>>[1][]) => a.reduce(snapshotReducer<Row>, s);

test('snapshot: failure is never shown as empty, fresh within 60s, cleared at 60s', () => {
  let s = reduce(initialSnapshot<Row>(), { type: 'request', generation: 1 });
  assert.equal(snapshotView(s, 0).kind, 'loading');
  s = reduce(s, { type: 'failure', generation: 1 });
  assert.equal(snapshotView(s, 1).kind, 'error', 'first failure is an error, not 0 cases');
  s = reduce(s, { type: 'request', generation: 2 }, { type: 'success', generation: 2, data: [], at: 1000 });
  assert.deepEqual(snapshotView(s, 1001), { kind: 'fresh', cases: [], refreshFailing: false });
  s = reduce(s, { type: 'request', generation: 3 }, { type: 'success', generation: 3, data: [{ id: 'a' }], at: 2000 });
  s = reduce(s, { type: 'request', generation: 4 }, { type: 'failure', generation: 4 });
  const v = snapshotView(s, 61_999);
  assert.equal(v.kind, 'fresh');
  assert.equal(v.kind === 'fresh' && v.refreshFailing, true);
  assert.equal(snapshotView(s, 62_000).kind, 'unverified', 'expired at 60s');
  s = reduce(s, { type: 'expire', now: 62_000 });
  assert.equal(s.data, null);
});

test('snapshot: offline/background clears immediately and late responses from old generations are ignored (X13)', () => {
  let s = reduce(initialSnapshot<Row>(), { type: 'request', generation: 1 }, { type: 'success', generation: 1, data: [{ id: 'a' }], at: 0 });
  s = reduce(s, { type: 'request', generation: 2 });
  s = reduce(s, { type: 'connectivity', online: true, visible: false, generation: 3 });
  assert.equal(snapshotView(s, 1).kind, 'paused');
  assert.equal(s.data, null);
  s = reduce(s, { type: 'success', generation: 2, data: [{ id: 'old' }], at: 5 });
  assert.equal(s.data, null, 'late success of invalidated request ignored');
  s = reduce(s, { type: 'connectivity', online: true, visible: true, generation: 3 });
  assert.equal(snapshotView(s, 6).kind, 'unverified', 'back to foreground: no old cases before revalidation');
  s = reduce(s, { type: 'request', generation: 4 }, { type: 'success', generation: 3, data: [{ id: 'stale' }], at: 7 });
  assert.equal(s.data, null);
  s = reduce(s, { type: 'success', generation: 4, data: [{ id: 'new' }], at: 8 });
  assert.deepEqual(snapshotView(s, 9), { kind: 'fresh', cases: [{ id: 'new' }], refreshFailing: false });
  s = reduce(s, { type: 'connectivity', online: false, visible: true, generation: 5 });
  assert.equal(snapshotView(s, 10).kind, 'offline');
  s = reduce(s, { type: 'success', generation: 5, data: [{ id: 'x' }], at: 11 });
  assert.equal(s.data, null, 'responses while offline are not displayed');
});

test('grid: cell bounds contain the representative point and quantize back to the cell', () => {
  const cell = { grid_version: 'pohang-v1' as const, cell_x: 40, cell_y: 40 };
  const [[s, w], [n, e]] = cellBounds(cell);
  const c = representative(cell);
  assert.ok(s < c.lat && c.lat < n && w < c.lon && c.lon < e);
  assert.deepEqual(quantize(s + 1e-9, w + 1e-9), cell);
  assert.deepEqual(quantize(n - 1e-9, e - 1e-9), cell);
  assert.ok(Math.abs((n - s) * Math.PI / 180 * 6371008.8 - 200) < 1e-6);
});

function req(body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('http://localhost/api/opinions', { method: 'POST', headers, body });
}

test('http: 8KB limit, JSON object only, content type, same origin', async () => {
  assert.deepEqual(await readJsonObject(req('{"a":1}')), { a: 1 });
  await assert.rejects(readJsonObject(req('x'.repeat(9000))), (e: HttpError) => e.code === 'PAYLOAD_TOO_LARGE');
  await assert.rejects(readJsonObject(req('[1]')), (e: HttpError) => e.code === 'INVALID_BODY');
  await assert.rejects(readJsonObject(req('{bad')), (e: HttpError) => e.code === 'INVALID_JSON');
  await assert.rejects(readJsonObject(req('{}', { 'content-type': 'text/plain' })), (e: HttpError) => e.code === 'UNSUPPORTED_MEDIA_TYPE');
  await assert.rejects(readJsonObject(req(new Uint8Array([0x7b, 0xff, 0x7d]))), (e: HttpError) => e.code === 'INVALID_JSON');
  const prev = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'http://localhost:3000';
  try {
    assert.doesNotThrow(() => assertSameOrigin(new Request('http://x', { headers: { origin: 'http://localhost:3000' } })));
    assert.throws(() => assertSameOrigin(new Request('http://x', { headers: { origin: 'http://localhost:3001' } })), /CROSS_ORIGIN/);
    assert.throws(() => assertSameOrigin(new Request('http://x')), /CROSS_ORIGIN/);
    delete process.env.APP_ORIGIN;
    assert.throws(() => assertSameOrigin(new Request('http://x', { headers: { origin: 'http://localhost:3000' } })), /CONFIG_INCOMPLETE/);
  } finally {
    if (prev === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = prev;
  }
});

test('fingerprint is order independent and changes with content; rate key needs trusted config', () => {
  const base = validateSubmission({ grid_version: 'pohang-v1', cell_x: 1, cell_y: 2, category: 'other', language: 'en', original_text: 'Ten chars here', allow_map: false, allow_player: false, notice_version: '2026-10-06-v1' });
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
  assert.equal(fingerprint(base), fingerprint(reordered));
  assert.notEqual(fingerprint(base), fingerprint({ ...base, allow_map: true }));
  const secret = 'x'.repeat(32);
  const h = (v: Record<string, string>) => new Headers(v);
  const day = new Date('2026-10-11T00:00:00Z');
  const a = rateKeyHash(h({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' }), { NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret, TRUSTED_CLIENT_IP_HEADER: 'x-real-ip' }, day);
  const b = rateKeyHash(h({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '2.2.2.2' }), { NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret, TRUSTED_CLIENT_IP_HEADER: 'x-real-ip' }, day);
  assert.equal(a, b, 'untrusted X-Forwarded-For does not change the bucket');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('198'));
  const next = rateKeyHash(h({ 'x-real-ip': '198.51.100.7' }), { NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret, TRUSTED_CLIENT_IP_HEADER: 'x-real-ip' }, new Date('2026-10-12T00:00:00Z'));
  assert.notEqual(a, next, 'daily rotation');
  assert.throws(() => rateKeyHash(h({}), { NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret }), /CONFIG_INCOMPLETE/);
  assert.throws(() => rateKeyHash(h({ 'x-real-ip': 'garbage' }), { NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret, TRUSTED_CLIENT_IP_HEADER: 'x-real-ip' }), /CONFIG_INCOMPLETE/);
  assert.throws(() => rateKeyHash(h({}), { NODE_ENV: 'development', RATE_LIMIT_HMAC_SECRET: 'short' }), /CONFIG_INCOMPLETE/);
  assert.equal(serverReadyForSubmissions({ NODE_ENV: 'production', RATE_LIMIT_HMAC_SECRET: secret }), false);
  assert.equal(serverReadyForSubmissions({ NODE_ENV: 'development', RATE_LIMIT_HMAC_SECRET: secret }), true);
});

test('db error mapping never leaks internals; admin action allow-list', () => {
  assert.deepEqual({ ...mapDbError({ message: 'OUTSIDE_AREA' }) }, { ...new HttpError(422, 'OUTSIDE_AREA', 'location') });
  assert.equal(mapDbError({ message: 'VERSION_CONFLICT' }).status, 409);
  assert.equal(mapDbError({ message: 'OPINION_DELETED' }).code, 'NOT_FOUND');
  const unknown = mapDbError({ message: 'duplicate key value violates unique constraint "secret_internal"' });
  assert.equal(unknown.code, 'SERVICE_UNAVAILABLE');
  assert.equal(unknown.status, 503);
  assert.equal(mapDbError({ message: 'permission denied', code: '42501' }).status, 403);
  assert.deepEqual(parseAdminAction({ action: 'hide', expected_version: 3 }), { action: 'hide', expected_version: 3 });
  assert.throws(() => parseAdminAction({ action: 'hide', expected_version: 3, summary: 'x' }), (e: AdminInputError) => e.code === 'INVALID_FIELDS');
  assert.throws(() => parseAdminAction({ action: 'save_summary', expected_version: 3 }), (e: AdminInputError) => e.code === 'INVALID_FIELDS');
  assert.throws(() => parseAdminAction({ action: 'publish', expected_version: 0 }), (e: AdminInputError) => e.code === 'INVALID_VERSION');
  assert.throws(() => parseAdminAction({ action: 'set_status', expected_version: 1 }), (e: AdminInputError) => e.code === 'INVALID_ACTION');
  assert.throws(() => parseAdminAction({ action: 'set_player', expected_version: 1, include_in_player: 'yes' }), (e: AdminInputError) => e.code === 'INVALID_FIELDS');
});
