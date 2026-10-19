// 로컬 DB 모드 브라우저 검수: 의견 등록 → 담당자 '지도·플레이어에 공개' → 플레이어 재생, 테스트 모드, 로컬 로그인.
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { LOCAL_E2E_OPERATOR as OP } from '../../playwright.local.config';

const test = base.extend({
  // 테스트마다 다른 클라이언트로 보이게 해 등록 빈도 제한이 서로 간섭하지 않게 한다.
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-test-client-ip': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` });
    await use(context);
  },
});

/** 허용 영역 채움 위의 한 점을 찾아 누른다(포항 전체 영역은 모양이 복잡해 상자 중앙이 바다일 수 있음). */
async function clickInsideArea(page: Page) {
  await expect(page.locator('.map-instruction')).toBeVisible();
  // 지도가 크기를 맞추며 도형을 다시 그릴 수 있어, 붙어 있는 도형에서 점을 찾을 때까지 몇 번 시도한다.
  let point: { x: number; y: number } | null = null;
  await expect.poll(async () => {
    point = await page.evaluate(() => {
      const el = document.querySelector<SVGPathElement>('.leaflet-container .leaflet-overlay-pane path:not([fill="none"])');
      const container = el?.closest('.leaflet-container');
      const ctm = el?.getScreenCTM();
      if (!el || !container || !ctm || !el.ownerSVGElement) return null;
      const box = container.getBoundingClientRect();
      const inverse = ctm.inverse();
      for (let fy = 0.5; fy < 0.9; fy += 0.04) for (let fx = 0.5; fx < 0.9; fx += 0.04) {
        for (const [x, y] of [[box.left + box.width * fx, box.top + box.height * fy], [box.left + box.width * (1 - fx), box.top + box.height * (1 - fy)]]) {
          const pt = el.ownerSVGElement.createSVGPoint(); pt.x = x; pt.y = y;
          if (el.isPointInFill(pt.matrixTransform(inverse))) return { x, y };
        }
      }
      return null;
    });
    return point;
  }, { message: '허용 영역 안의 점' }).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

async function submitOpinion(page: Page, text: string, opts: { player: boolean }) {
  await page.goto('/submit');
  await clickInsideArea(page);
  await expect(page.locator('#f-text')).toBeVisible();
  await page.selectOption('#f-category', 'transport');
  await page.selectOption('#f-language', 'ko');
  await page.fill('#f-text', text);
  await page.check('#f-map');
  if (opts.player) await page.check('#f-player');
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page).toHaveURL(/\/submit\/complete$/);
}

async function login(page: Page, password = OP.password) {
  await page.goto('/admin/login');
  await expect(page.getByText('로컬 DB 모드입니다')).toBeVisible();
  await page.fill('#a-email', OP.email);
  await page.fill('#a-password', password);
  await page.getByRole('button', { name: '로그인' }).click();
}

async function playerIds(page: Page) {
  const r = await page.request.get('/api/public/opinions?mode=player');
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { summary: string }[] }).data.map((o) => o.summary);
}

test('L01: without Supabase, an opinion is stored locally and stays private until review; the player explains why', async ({ page }) => {
  const cfg = await (await page.request.get('/api/public/config')).json();
  expect(cfg.allowed_cells.length).toBe(29264);
  expect(cfg.submissions_enabled).toBe(true);
  expect(cfg.test_auto_publish).toBe(false);

  const text = `[로컬E2E] 검토 대기 의견 ${randomUUID().slice(0, 6)}`;
  await submitOpinion(page, text, { player: true });
  await expect(page.getByRole('heading', { name: '의견이 등록되었습니다.' })).toBeVisible();
  await expect(page.getByText('‘상영에 포함’하면 지도와 플레이어에 나옵니다')).toBeVisible();
  expect(await playerIds(page)).not.toContain(text);

  await page.goto('/player');
  await expect(page.getByText('아직 상영할 공개 의견이 없습니다.')).toBeVisible();
  await expect(page.getByText('‘플레이어 공개’까지 선택하고')).toBeVisible();
});

test('L02: local operator login, one-click "지도·플레이어에 공개", then it plays in the player', async ({ page }) => {
  // 틀린 비밀번호는 거절
  await login(page, 'wrong-password-123');
  await expect(page.locator('.state--error')).toContainText('이메일 또는 비밀번호를 확인해 주세요.');
  expect((await page.request.get('/api/admin/opinions')).status()).toBe(401);

  await login(page);
  await expect(page.getByRole('heading', { name: '등록 의견' })).toBeVisible();
  await expect(page.locator('.admin-header')).toContainText('로컬 DB');
  const row = page.locator('.admin-row', { hasText: '[로컬E2E] 검토 대기 의견' }).first();
  await expect(row).toBeVisible();
  await row.click();

  const both = page.getByRole('button', { name: '지도·플레이어에 공개' });
  await expect(both).toBeDisabled();
  await expect(page.getByRole('button', { name: '지도에만 공개' })).toBeDisabled();
  const summary = `[로컬E2E] 요약 ${randomUUID().slice(0, 6)}`;
  await page.fill('#summary', summary);
  await expect(page.getByText('고친 요약을 먼저 저장한 뒤 공개합니다')).toBeVisible();
  await both.click();
  await expect(page.locator('.state--ok')).toContainText('지도에 공개하고 플레이어 상영에도 넣었습니다');
  await expect(page.locator('.status--published')).toBeVisible();
  await expect(page.getByRole('button', { name: '상영에서 빼기' })).toBeVisible();
  await expect(page.locator('.audit li')).toHaveCount(3);
  expect(await playerIds(page)).toContain(summary);

  await page.goto('/player');
  await expect(page.locator('.case__summary')).toHaveText(summary);
  await expect(page.locator('.player__status')).toContainText('상영 의견이 1건입니다');
});

test('L03: test mode publishes new opinions at once, so two submissions auto-play; switching it off restores review', async ({ page, browser }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: '테스트 모드 · 검토 없이 바로 공개' })).toBeVisible();
  await page.getByRole('button', { name: '테스트 모드 켜기' }).click();
  await expect(page.getByRole('button', { name: '테스트 모드 끄기' })).toBeVisible();
  await expect(page.locator('.test-mode')).toContainText('저절로 꺼짐');

  const visitor = await (await browser.newContext({ extraHTTPHeaders: { 'x-test-client-ip': '10.99.1.2' } })).newPage();
  const text = `[로컬E2E] 테스트 모드 의견 ${randomUUID().slice(0, 6)}`;
  await visitor.goto('/submit');
  await clickInsideArea(visitor);
  await expect(visitor.getByText('테스트 모드: 지도 공개를 선택하면')).toBeVisible();
  await visitor.close();
  const v2 = await (await browser.newContext({ extraHTTPHeaders: { 'x-test-client-ip': '10.99.1.3' } })).newPage();
  await submitOpinion(v2, text, { player: true });
  await expect(v2.getByRole('heading', { name: '의견이 등록되어 바로 공개되었습니다.' })).toBeVisible();
  await expect(v2.getByRole('link', { name: /플레이어에서 보기/ })).toBeVisible();
  expect(await playerIds(v2)).toContain(text);

  // 상영 2건 → ▶로 재생
  await v2.goto('/player');
  await expect(v2.locator('.player__count')).toHaveText('01 / 02');
  await expect(v2.locator('.player__status')).toContainText('▶ 또는 Space로 재생');
  await v2.getByRole('button', { name: '재생' }).click();
  await expect(v2.locator('.player__status')).toContainText('재생 중');
  await v2.close();

  // 자동 공개 이력이 담당자 화면에 보인다
  await page.reload();
  await page.getByRole('tab', { name: '공개' }).click();
  await page.locator('.admin-row', { hasText: text }).click();
  await expect(page.locator('.audit li').first()).toContainText('테스트 모드 자동 공개');
  await expect(page.locator('.audit li').first()).toContainText('(나)');

  // 끄면 다시 검토를 거친다
  await page.goto('/admin/opinions');
  await page.getByRole('button', { name: '테스트 모드 끄기' }).click();
  await expect(page.getByRole('button', { name: '테스트 모드 켜기' })).toBeVisible();
  const v3 = await (await browser.newContext({ extraHTTPHeaders: { 'x-test-client-ip': '10.99.1.4' } })).newPage();
  const later = `[로컬E2E] 끈 뒤 의견 ${randomUUID().slice(0, 6)}`;
  await submitOpinion(v3, later, { player: true });
  await expect(v3.getByRole('heading', { name: '의견이 등록되었습니다.' })).toBeVisible();
  expect(await playerIds(v3)).not.toContain(later);
  await v3.close();
});

test('L04: logout ends the local session; cross-origin writes are refused', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: '등록 의견' })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get('/api/admin/opinions')).status()).toBe(401);
  const res = await page.request.post('/api/admin/session', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, data: { email: OP.email, password: OP.password } });
  expect(res.status()).toBe(403);
});
