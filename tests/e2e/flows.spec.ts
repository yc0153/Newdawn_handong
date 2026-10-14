// 브라우저 연결 검수: 공개 지도 → 위치 태그 → 등록 → 담당자 검토 → 지도·플레이어 → 숨김·삭제.
import { test as base, expect, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  admin, adminAction, adminGet, ensureUser, idByReference, loginCookie, publicIdOf, submit, validBody,
} from '../integration/helpers';

const OP1 = { email: 'it-op1@local.test', password: 'it-pass-op1-1234' };
const OP2 = { email: 'it-op2@local.test', password: 'it-pass-op2-1234' };
const USER = { email: 'it-user@local.test', password: 'it-pass-user-1234' };

const test = base.extend({
  // 테스트마다 다른 클라이언트 IP로 보이게 해 빈도 제한이 서로 간섭하지 않게 한다.
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-test-client-ip': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` });
    await use(context);
  },
});

test.beforeAll(async () => {
  await ensureUser(OP1.email, OP1.password, true);
  await ensureUser(OP2.email, OP2.password, true);
  await ensureUser(USER.email, USER.password, null);
});

async function publishedOpinion(summary: string, opts: { player?: boolean } = {}) {
  const op = await loginCookie(OP1.email, OP1.password);
  const s = await submit(validBody({ allow_map: true, allow_player: !!opts.player, original_text: `[E2E 원문] ${summary}` }));
  const id = await idByReference(s.body.reference);
  let v = (await adminAction(id, { action: 'save_summary', expected_version: 1, summary }, op.cookie)).body.version;
  v = (await adminAction(id, { action: 'publish', expected_version: v }, op.cookie)).body.version;
  if (opts.player) v = (await adminAction(id, { action: 'set_player', expected_version: v, include_in_player: true }, op.cookie)).body.version;
  return { id, version: v as number, cookie: op.cookie, publicId: await publicIdOf(id) };
}

async function areaBox(page: Page) {
  const area = page.locator('.leaflet-overlay-pane path').first();
  await expect(area).toBeVisible();
  return (await area.boundingBox())!;
}
async function clickInsideArea(page: Page, fx = 0.5, fy = 0.5) {
  const b = await areaBox(page);
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
}
async function clickOutsideArea(page: Page) {
  const b = await areaBox(page);
  const map = (await page.locator('.leaflet-container').boundingBox())!;
  const x = Math.max(map.x + 70, b.x - 40);
  expect(x).toBeLessThan(b.x);
  await page.mouse.click(x, b.y + b.height - 20);
}

/** 가짜 시계를 2초씩 진행하며 실제 네트워크 응답이 도착할 틈을 준다. */
async function advance(page: Page, ms: number) {
  for (let left = ms; left > 0; left -= 2000) {
    await page.clock.runFor(Math.min(2000, left));
    await page.waitForTimeout(40);
  }
}
async function fillDraft(page: Page, text: string) {
  await page.selectOption('#f-category', 'transport');
  await page.selectOption('#f-language', 'ko');
  await page.fill('#f-text', text);
}

test('T01·T03: main entry shows the public map first; write button and direct place entry open the tag map', async ({ page }) => {
  await page.goto('/?view=browse');
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('heading', { name: '공개 의견' })).toBeVisible();
  await page.locator('.side-panel__cta').click();
  await expect(page).toHaveURL(/\/submit$/);
  await expect(page.locator('.map-instruction')).toHaveText('의견을 남길 위치를 지도에서 눌러주세요.');
  await expect(page.locator('.opinion-list')).toHaveCount(0);

  const fresh = await page.context().newPage();
  await fresh.goto('/?view=place');
  await expect(fresh).toHaveURL(/\/submit$/);
  await expect(fresh.locator('.map-instruction')).toBeVisible();
  await fresh.goto('/');
  await expect(fresh).toHaveURL(/\/map$/);
  await fresh.goto('/?view=player');
  await expect(fresh).toHaveURL(/\/player$/);
});

test('T04·T05·T06·T11·X20: outside click keeps draft, location change keeps everything, payload has only the cell', async ({ page }) => {
  const bodies: string[] = [];
  const urls: string[] = [];
  page.on('request', (r: Request) => {
    urls.push(r.url());
    if (r.url().endsWith('/api/opinions') && r.method() === 'POST') bodies.push(r.postData() ?? '');
  });
  await page.goto('/submit');
  await clickOutsideArea(page);
  await expect(page.locator('.map-instruction')).toContainText('영역 밖');
  await expect(page.locator('#f-text')).toHaveCount(0);

  await clickInsideArea(page, 0.3, 0.3);
  await expect(page.locator('#f-text')).toBeVisible();
  await expect(page.locator('#panel-heading')).toHaveText('의견을 남겨주세요.');
  const text = `[E2E] 위치 변경 검수 ${randomUUID().slice(0, 6)} 입력 보존`;
  await fillDraft(page, text);
  // 공개 설정: 기본 꺼짐, 플레이어는 지도 공개에 종속
  await expect(page.locator('#f-map')).not.toBeChecked();
  await expect(page.locator('#f-player')).toBeDisabled();
  await page.check('#f-map');
  await page.check('#f-player');
  await page.uncheck('#f-map');
  await expect(page.locator('#f-player')).not.toBeChecked();
  await expect(page.locator('#f-player')).toBeDisabled();
  await page.check('#f-map');
  await page.check('#f-player');

  await page.click('#change-location');
  await expect(page.locator('.map-instruction')).toContainText('새 위치');
  await clickOutsideArea(page);
  await expect(page.locator('.map-instruction')).toContainText('영역 밖');
  await clickInsideArea(page, 0.7, 0.7);
  await expect(page.locator('#f-text')).toHaveValue(text);
  await expect(page.locator('#f-category')).toHaveValue('transport');
  await expect(page.locator('#f-language')).toHaveValue('ko');
  await expect(page.locator('#f-map')).toBeChecked();
  await expect(page.locator('#f-player')).toBeChecked();

  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page).toHaveURL(/\/submit\/complete$/);
  await expect(page.getByRole('heading', { name: '의견이 등록되었습니다.' })).toBeVisible();
  const reference = (await page.locator('.reference').textContent())!.trim();
  expect(reference).toMatch(/^OP-/);

  expect(bodies).toHaveLength(1);
  const sent = JSON.parse(bodies[0]);
  expect(Object.keys(sent).sort()).toEqual(['allow_map', 'allow_player', 'category', 'cell_x', 'cell_y', 'grid_version', 'language', 'notice_version', 'original_text']);
  expect(bodies[0]).not.toMatch(/lat|lon|lng/);
  for (const u of urls) expect(u).not.toMatch(/(lat|lng|lon)=/);
  expect(page.url()).not.toContain('OP-');

  const id = await idByReference(reference);
  const row = await admin.from('opinions').select('allow_map,allow_player,status,original_text').eq('id', id).single();
  expect(row.data).toMatchObject({ allow_map: true, allow_player: true, status: 'pending', original_text: text });

  // T08: 미검토 의견은 공개 화면 어디에도 없다.
  await page.goto('/map');
  await expect(page.locator('.side-panel')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(text);
  const pub = await (await page.request.get('/api/public/opinions')).text();
  expect(pub).not.toContain(text);

  // X19: 새 의견 시작은 위치·입력·공개 설정 초기화
  await page.goto('/submit');
  await clickInsideArea(page);
  await expect(page.locator('#f-text')).toHaveValue('');
  await expect(page.locator('#f-map')).not.toBeChecked();
});

test('T07·X05: double click and a lost response create exactly one opinion with the same key', async ({ page }) => {
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/opinions', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (first) {
      first = false;
      await route.fetch(); // 서버는 저장했지만 응답이 브라우저에 도착하지 않은 상황
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.goto('/submit');
  await clickInsideArea(page);
  const text = `[E2E] 응답 유실 재시도 ${randomUUID().slice(0, 6)}`;
  await fillDraft(page, text);
  const btn = page.getByRole('button', { name: /의견 등록|등록 중/ });
  await btn.dblclick();
  await expect(page.locator('.submit-panel [role="alert"]')).toContainText('중복 등록되지 않습니다');
  await expect(page.locator('#f-text')).toHaveValue(text);
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page).toHaveURL(/\/submit\/complete$/);
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  const { count } = await admin.from('opinions').select('*', { count: 'exact', head: true }).eq('original_text', text);
  expect(count).toBe(1);
});

test('S03: clicks after a successful response cannot create a second opinion', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/opinions', async (route) => {
    posts += 1;
    const res = await route.fetch();
    await page.waitForTimeout(300); // 응답 후 화면 전환이 늦는 상황
    await route.fulfill({ response: res });
  });
  await page.goto('/submit');
  await clickInsideArea(page);
  const text = `[E2E] 성공 후 재클릭 ${randomUUID().slice(0, 6)}`;
  await fillDraft(page, text);
  const btn = page.locator('.submit-panel button[type="submit"]');
  await btn.click();
  for (let i = 0; i < 5; i++) await btn.click({ force: true, timeout: 500 }).catch(() => undefined);
  await expect(page).toHaveURL(/\/submit\/complete$/);
  expect(posts).toBe(1);
  const { count } = await admin.from('opinions').select('*', { count: 'exact', head: true }).eq('original_text', text);
  expect(count).toBe(1);
});

test('validation: field errors keep the draft; changing content after failure uses a new key', async ({ page }) => {
  const keys: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/opinions')) keys.push(r.headers()['idempotency-key']); });
  await page.goto('/submit');
  await clickInsideArea(page);
  await page.fill('#f-text', '짧음');
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page.locator('#f-category-err')).toBeVisible();
  await expect(page.locator('#f-text-err')).toContainText('10자');
  await expect(page.locator('#f-category')).toBeFocused();
  expect(keys).toHaveLength(0);
  await page.route('**/api/opinions', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"x"}}' }));
  await fillDraft(page, '[E2E] 서버 오류 후 내용 변경 검수 문장');
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page.locator('.submit-panel [role="alert"]')).toContainText('작성한 내용은 그대로');
  await page.fill('#f-text', '[E2E] 서버 오류 후 내용 변경 검수 문장 수정');
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page.locator('.submit-panel [role="alert"]')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});

test('X19: direct entry to the completion page never fakes success', async ({ page }) => {
  await page.goto('/submit/complete');
  await expect(page.getByRole('heading', { name: '표시할 등록 결과가 없습니다.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('의견이 등록되었습니다');
});

test('keyboard: the map centre can be selected with Enter', async ({ page }) => {
  await page.goto('/submit');
  await areaBox(page);
  await page.locator('.leaflet-container').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#f-text')).toBeVisible();
});

test('T02·T09·X18: list/pin linkage, grouped pin, filter empty and fetch failure are distinct', async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  const a = await publishedOpinion(`[E2E ${tag}] 같은 위치 첫 번째 요약`);
  const b = await publishedOpinion(`[E2E ${tag}] 같은 위치 두 번째 요약`);
  await page.goto('/map');
  const itemA = page.locator(`[data-public-id="${a.publicId}"]`);
  await expect(itemA).toBeVisible();
  await itemA.click();
  await expect(itemA).toHaveAttribute('aria-pressed', 'true');
  await expect(itemA).toContainText('대략 위치');
  await expect(page.locator('.pin--active')).toHaveCount(1);
  // 같은 격자의 의견은 한 핀에 묶이고, 핀을 누르면 그 위치의 의견을 모두 고를 수 있다.
  const pin = page.locator('.leaflet-marker-icon', { has: page.locator('.pin--active') });
  await pin.click();
  await expect(page.locator('.group-head')).toContainText('이 위치의 의견');
  await expect(page.locator(`[data-public-id="${b.publicId}"]`)).toBeVisible();
  await page.locator(`[data-public-id="${b.publicId}"]`).click();
  await expect(page.locator(`[data-public-id="${b.publicId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '전체 목록 보기' }).click();

  // 필터: 해당 분야 0건 안내와 작성 버튼 유지
  await page.route('**/api/public/opinions**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ public_id: randomUUID(), category: 'transport', location: { lat: 36.06, lon: 129.39 }, summary: '[E2E] 교통 1건' }] }),
  }));
  await page.reload();
  await page.getByRole('button', { name: '기타' }).click();
  await expect(page.locator('.state--empty')).toHaveText('이 분야에는 아직 공개된 의견이 없습니다.');
  await expect(page.locator('.side-panel__cta')).toBeVisible();

  await page.route('**/api/public/opinions**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}' }));
  await page.reload();
  await expect(page.locator('.state--empty')).toHaveText('아직 공개된 의견이 없습니다. 첫 의견을 남겨 주세요.');
  await expect(page.locator('.leaflet-container')).toBeVisible();

  await page.route('**/api/public/opinions**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"x"}}' }));
  await page.reload();
  await expect(page.locator('.state--error')).toContainText('의견이 없다는 뜻이 아닙니다');
  await expect(page.locator('.state--empty')).toHaveCount(0);
  await expect(page.locator('.side-panel__cta')).toBeVisible();
});

test('X16: map tile failure keeps the list and offers retry', async ({ page }) => {
  const s = await publishedOpinion(`[E2E ${randomUUID().slice(0, 6)}] 지도 장애 중 목록 유지`);
  await page.route('http://127.0.0.1:8099/**', (route) => route.abort('failed'));
  await page.goto('/map');
  await expect(page.locator('.map-alert')).toContainText('지도를 불러오지 못했습니다.');
  await expect(page.locator(`[data-public-id="${s.publicId}"]`)).toBeVisible();
  await page.unroute('http://127.0.0.1:8099/**');
  await page.getByRole('button', { name: '지도 다시 불러오기' }).click();
  await expect(page.locator('.map-alert')).toHaveCount(0);
});

test('T10·X14·offline·background: withdrawal reaches the open map within one poll; stale data is hidden', async ({ page, context }) => {
  const summary = `[E2E ${randomUUID().slice(0, 6)}] 철회 반영 검수 요약`;
  const s = await publishedOpinion(summary);
  await page.clock.install();
  await page.goto('/map');
  const item = page.locator(`[data-public-id="${s.publicId}"]`);
  await expect(item).toBeVisible();

  // 담당자가 숨기면 다음 30초 재조회에서 사라진다.
  await adminAction(s.id, { action: 'hide', expected_version: s.version }, s.cookie);
  expect((await (await page.request.get('/api/public/opinions')).text()).includes(summary)).toBe(false);
  await advance(page, 31_000);
  await expect(item).toHaveCount(0);

  // 다시 공개하고 확인 후, 조회가 계속 실패하면 60초에 사례를 숨긴다.
  const op = await loginCookie(OP1.email, OP1.password);
  await adminAction(s.id, { action: 'publish', expected_version: s.version + 1 }, op.cookie);
  await advance(page, 31_000);
  await expect(item).toBeVisible();
  await page.route('**/api/public/opinions**', (route) => route.abort('failed'));
  await advance(page, 31_000);
  await expect(item).toBeVisible();
  await expect(page.locator('.state--warn')).toContainText('지연');
  await advance(page, 31_000);
  await expect(item).toHaveCount(0);
  await expect(page.locator('.state--warn')).toContainText('다시 확인하는 중');
  await page.unroute('**/api/public/opinions**');
  await advance(page, 31_000);
  await expect(item).toBeVisible();

  // 오프라인: 즉시 숨김, 복귀 후 새 조회가 성공해야 다시 표시
  await context.setOffline(true);
  await expect(item).toHaveCount(0);
  await expect(page.locator('.state--warn')).toContainText('연결이 끊겨');
  await context.setOffline(false);
  await expect(item).toBeVisible();

  // 백그라운드: 즉시 숨김
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(item).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(item).toBeVisible();

  // 삭제 후 다음 재조회에서 제거
  const latest = await adminGet(`/api/admin/opinions/${s.id}`, op.cookie);
  await adminAction(s.id, { action: 'delete', expected_version: latest.body.version }, op.cookie);
  await advance(page, 31_000);
  await expect(item).toHaveCount(0);
});

const fake = (n: number) => Array.from({ length: n }, (_, i) => ({
  public_id: randomUUID(), category: 'language', location: { lat: 36.06 + i * 0.004, lon: 129.39 }, summary: `[E2E] 플레이어 사례 ${i + 1}`,
}));

test('T12·T13: player 0/1/many, initial stop, 12s cycle, manual move stops, keyboard, withdrawal', async ({ page }) => {
  let data = fake(0);
  await page.route('**/api/public/opinions?mode=player', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) }));
  await page.clock.install();
  await page.goto('/player');
  await expect(page.getByText('아직 상영할 공개 의견이 없습니다.')).toBeVisible();
  await expect(page.getByRole('link', { name: '나도 의견 남기기' })).toHaveAttribute('href', '/submit');

  data = fake(1);
  await page.reload();
  await expect(page.locator('.case__summary')).toHaveText('[E2E] 플레이어 사례 1');
  await expect(page.getByRole('button', { name: '재생' })).toBeDisabled();
  await expect(page.locator('.player__status')).toContainText('2건 이상이면 자동 재생');

  data = fake(3);
  await page.reload();
  const summary = page.locator('.case__summary');
  await expect(summary).toHaveText('[E2E] 플레이어 사례 1');
  await expect(page.locator('.player__count')).toHaveText('01 / 03');
  await advance(page, 13_000);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 1');
  await page.getByRole('button', { name: '재생' }).click();
  await advance(page, 12_100);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 2');
  await advance(page, 12_000);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 3');
  await advance(page, 12_000);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 1');
  await page.getByRole('button', { name: '다음 사례' }).click();
  await expect(summary).toHaveText('[E2E] 플레이어 사례 2');
  await expect(page.getByRole('button', { name: '재생' })).toHaveAttribute('aria-pressed', 'false');
  await advance(page, 13_000);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 2');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect(summary).toHaveText('[E2E] 플레이어 사례 3');
  await page.keyboard.press('ArrowLeft');
  await expect(summary).toHaveText('[E2E] 플레이어 사례 2');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '일시정지' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '재생' })).toHaveAttribute('aria-pressed', 'false');
  await expect(summary).toHaveText('[E2E] 플레이어 사례 2');

  // 현재 사례(2)가 철회되면 정지하고 같은 순번의 다음 유효 사례로
  data = [data[0], data[2]];
  await advance(page, 30_500);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 3');
  await expect(page.getByRole('button', { name: '재생' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.player__count')).toHaveText('02 / 02');
  await expect(page.locator('body')).not.toContainText('[E2E] 플레이어 사례 2');

  // 연결 단절: 즉시 숨김
  await page.context().setOffline(true);
  await expect(summary).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(summary).toHaveText('[E2E] 플레이어 사례 3');
  await expect(page.getByRole('button', { name: '재생' })).toHaveAttribute('aria-pressed', 'false');
});

test('player shows only operator-included, player-consented cases from the real API', async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  await publishedOpinion(`[E2E ${tag}] 지도만 공개`);
  const yes = await publishedOpinion(`[E2E ${tag}] 상영 포함`, { player: true });
  const res = await page.request.get('/api/public/opinions?mode=player');
  const body = await res.json();
  expect(body.data.some((o: { public_id: string }) => o.public_id === yes.publicId)).toBe(true);
  expect(JSON.stringify(body)).not.toContain(`[E2E ${tag}] 지도만 공개`);
});

test('T14: unauthenticated and non-operator users cannot reach raw opinions', async ({ page }) => {
  await page.goto('/admin/opinions');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.fill('#a-email', USER.email);
  await page.fill('#a-password', USER.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '담당자 권한이 없습니다.' })).toBeVisible();
  const api = await page.request.get('/api/admin/opinions');
  expect(api.status()).toBe(403);
  const headers = (await page.request.get('/admin/login')).headers();
  expect(headers['x-frame-options']).toBe('DENY');
});

test('A01: operator reviews, summarises, publishes, includes in player; concurrent edit shows conflict', async ({ page, browser }) => {
  const text = `[E2E 원문] 담당자 화면 검수 ${randomUUID().slice(0, 6)}`;
  const s = await submit(validBody({ original_text: text, allow_map: true, allow_player: true }));
  const id = await idByReference(s.body.reference);
  const publicId = await publicIdOf(id);

  await page.goto('/admin/login');
  await page.fill('#a-email', OP1.email);
  await page.fill('#a-password', OP1.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '등록 의견' })).toBeVisible();
  await expect(page.locator('.admin-list')).toContainText(text);
  await page.locator('.admin-row', { hasText: text }).click();
  await expect(page.locator('.original-text')).toHaveText(text);
  await expect(page.getByRole('button', { name: '지도에 공개' })).toBeDisabled();
  const summary = `[E2E] 담당자 요약 ${publicId.slice(0, 6)}`;
  await page.fill('#summary', summary);
  await page.getByRole('button', { name: '요약 저장' }).click();
  await expect(page.locator('.state--ok')).toContainText('요약을 저장했습니다');
  await page.getByRole('button', { name: '지도에 공개' }).click();
  await expect(page.locator('.status--published')).toBeVisible();
  await expect(page.locator('#summary')).toBeDisabled();
  // 공개만 하고 상영에 넣지 않으면 상세에 안내가, 목록에 '상영 대기'가 보인다.
  await expect(page.locator('.callout')).toContainText('플레이어에는 아직 나오지 않습니다');
  await page.getByRole('link', { name: '← 목록' }).click();
  await page.getByRole('tab', { name: '공개' }).click();
  await expect(page.locator('.admin-row', { hasText: text }).locator('.status--queue')).toHaveText('상영 대기');
  await page.locator('.admin-row', { hasText: text }).click();
  await page.getByRole('button', { name: '플레이어에도 상영' }).click();
  await expect(page.getByRole('button', { name: '상영에서 빼기' })).toBeVisible();
  await expect(page.locator('.callout')).toHaveCount(0);
  const pub = await (await page.request.get('/api/public/opinions?mode=player')).json();
  expect(pub.data.find((o: { public_id: string }) => o.public_id === publicId)?.summary).toBe(summary);
  await expect(page.locator('.audit li')).toHaveCount(3);

  // 다른 담당자가 먼저 숨기면 이 화면의 다음 변경은 충돌로 거절된다.
  const ctx2 = await browser.newContext();
  const op2 = await ctx2.newPage();
  await op2.goto('/admin/login');
  await op2.fill('#a-email', OP2.email);
  await op2.fill('#a-password', OP2.password);
  await op2.getByRole('button', { name: '로그인' }).click();
  await expect(op2.getByRole('heading', { name: '등록 의견' })).toBeVisible();
  await op2.goto(`/admin/opinions/${id}`);
  await op2.getByRole('button', { name: '숨김', exact: true }).click();
  await expect(op2.locator('.status--hidden')).toBeVisible();
  await ctx2.close();

  await page.getByRole('button', { name: '상영에서 빼기' }).click();
  await expect(page.locator('.state--warn')).toContainText('다른 담당자가 먼저 변경했습니다');
  await page.getByRole('button', { name: '최신 내용 불러오기' }).click();
  await expect(page.locator('.status--hidden')).toBeVisible();
  await expect(page.getByRole('button', { name: '상영에 포함' })).toBeVisible();

  // 삭제: 확인 단계 후 공개 제외
  await page.getByRole('button', { name: '삭제…' }).click();
  await page.getByRole('button', { name: '삭제 확인' }).click();
  await expect(page.getByRole('heading', { name: '삭제했습니다.' })).toBeVisible();
  const after = await admin.from('opinions').select('original_text,deleted_at').eq('id', id).single();
  expect(after.data!.original_text).toBeNull();

  await page.getByRole('link', { name: '목록으로' }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get('/api/admin/opinions')).status()).toBe(401);
});

test('X17: no horizontal overflow at 360/768/1440, at 200% text, and English UI wraps', async ({ page }) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/map', '/submit', '/submit/complete', '/player', '/admin/login']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `${path} @${width}`).toBeLessThanOrEqual(width);
    }
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/submit');
  await page.getByRole('button', { name: /English/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your everyday opinions, with a place.');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await clickInsideArea(page);
  await expect(page.locator('#f-text')).toBeVisible();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(768);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your everyday opinions, with a place.');
  await page.getByRole('button', { name: /한국어/ }).click();
});

test('X22: with no allowed area or submissions disabled the page explains it and never submits', async ({ page }) => {
  let posted = false;
  page.on('request', (r) => { if (r.url().endsWith('/api/opinions') && r.method() === 'POST') posted = true; });
  await page.route('**/api/public/config', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ grid_version: 'pohang-v1', notice_version: '2026-10-06-v1', submissions_enabled: false, allowed_cells: [] }),
  }));
  await page.goto('/submit');
  await expect(page.getByText('지금은 의견 등록을 받지 않습니다.')).toBeVisible();
  const map = (await page.locator('.leaflet-container').boundingBox())!;
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
  await expect(page.locator('#f-text')).toHaveCount(0);
  expect(posted).toBe(false);
});

test('X23: a map that loads while hidden fits the allowed area once it becomes visible', async ({ page }) => {
  await page.route('**/submit', async (route) => {
    const r = await route.fetch();
    const html = (await r.text()).replace('</body>', '<style id="hide-map">.leaflet-host{display:none!important}</style></body>');
    await route.fulfill({ response: r, body: html });
  });
  await page.goto('/submit');
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeAttached();
  await page.evaluate(() => document.getElementById('hide-map')?.remove());
  await expect.poll(async () => {
    const src = await page.locator('.leaflet-tile').first().getAttribute('src');
    return Number(src?.match(/\/(\d+)\/\d+\/\d+\.svg$/)?.[1] ?? 99);
  }).toBeLessThan(16);
});

test('X24: a failing first config request is retried quietly before showing an error', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/public/config', async (route) => {
    calls += 1;
    if (calls <= 2) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}' });
    return route.continue();
  });
  await page.goto('/submit');
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeAttached();
  await expect(page.getByText('등록 설정을 불러오지 못했습니다.')).toHaveCount(0);
  expect(calls).toBe(3);
});
