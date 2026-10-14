// 카카오 지도 모드: 지도 클릭 → 주변 상세주소 → 검색 → 로드뷰 → 핀 → 의견 등록.
// 가짜 SDK(tests/e2e/kakao-mock.js)를 쓰며, 서버에는 칸 번호만 간다는 것을 확인한다.
import { test as base, expect, type Page, type Request } from '@playwright/test';

const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-test-client-ip': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` });
    await use(context);
  },
});

async function clickMapCenter(page: Page) {
  const box = (await page.locator('.kakao-host').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('K01: map click lists nearby addresses; search, roadview pin and submit send only the cell', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.locator('.kakao-host')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await expect(page.locator('.kmock-polygon')).toHaveCount(1);
  await expect(page.locator('.steps li')).toHaveCount(3);

  await clickMapCenter(page);
  await expect(page.getByRole('heading', { name: '주변 상세주소에서 장소를 골라 주세요.' })).toBeVisible();
  const items = page.locator('.addr-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(1);
  await expect(items.first()).toContainText('도로명');
  await expect(items.first()).toContainText('지번');
  await expect(items.first().locator('.addr-item__zip')).toHaveText(/^37\d{3}$/);
  // 의견 입력은 아직 열리지 않는다.
  await expect(page.locator('#f-text')).toHaveCount(0);

  // 검색: 영역 밖 장소는 고를 수 없다.
  await page.fill('#place-q', '시청');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.locator('.addr-item', { hasText: '시청 검수장소' })).toBeEnabled();
  const outside = page.locator('.addr-item', { hasText: '시청 영역밖장소' });
  await expect(outside).toBeDisabled();
  await expect(outside).toContainText('영역 밖');

  // 고르면 로드뷰 → 지도로 돌아가기 → 다시 고르기
  await page.locator('.addr-item', { hasText: '검수빌딩' }).click();
  await expect(page.locator('.roadview')).toBeVisible();
  await expect(page.locator('.kmock-roadview')).toContainText('ROADVIEW 4242');
  await page.getByRole('button', { name: '지도로 돌아가기' }).click();
  await expect(page.locator('.roadview')).toHaveCount(0);
  await expect(page.locator('.addr-list')).toBeVisible();
  await page.locator('.addr-item', { hasText: '검수빌딩' }).click();
  await page.getByRole('button', { name: '이 장면에 핀 꽂기' }).click();
  await expect(page.locator('.roadview__pin--set')).toBeVisible();

  // 의견 작성: 고른 장소 이름이 보이고, 저장은 약 200m 칸이라는 안내
  await expect(page.locator('#f-text')).toBeVisible();
  await expect(page.locator('.location-box')).toContainText('검수빌딩');
  await expect(page.locator('.location-box')).toContainText('약 200m');
  await page.selectOption('#f-category', 'transport');
  await page.selectOption('#f-language', 'ko');
  await page.fill('#f-text', '[E2E 카카오] 정류장 안내판이 한국어로만 되어 있어요.');

  let sent: Request | null = null;
  page.on('request', (r) => { if (r.url().endsWith('/api/opinions') && r.method() === 'POST') sent = r; });
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page).toHaveURL(/\/submit\/complete$/);
  const body = JSON.parse((sent as Request | null)!.postData()!);
  expect(Object.keys(body).sort()).toEqual(['allow_map', 'allow_player', 'category', 'cell_x', 'cell_y', 'grid_version', 'language', 'notice_version', 'original_text']);
  // 검수빌딩은 칸 (40, 44)의 대표점
  expect([body.cell_x, body.cell_y]).toEqual([40, 44]);
  expect(JSON.stringify(body)).not.toMatch(/검수빌딩|검수로|lat|lon/);
});

test('K02: skipping the address keeps the map place', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.locator('.kakao-host')).toBeVisible();
  await clickMapCenter(page);
  await expect(page.locator('.addr-item').first()).toBeVisible();
  // 주소를 고르지 않고 건너뛰면 지도에서 누른 칸 그대로 의견을 쓴다.
  await page.getByRole('button', { name: '주소 없이 지도 위치로 진행' }).click();
  await expect(page.locator('#f-text')).toBeVisible();
  await expect(page.locator('.location-box')).toContainText('대략 위치');
  await expect(page.locator('.roadview')).toHaveCount(0);
});

test('K03: if the Kakao SDK cannot load, the page falls back to the tile map and the plain flow', async ({ page }) => {
  await page.route('**/kakao-mock.js*', (r) => r.abort());
  await page.goto('/submit');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.steps li')).toHaveCount(2);
  const area = (await page.locator('.leaflet-overlay-pane path').first().boundingBox())!;
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  await expect(page.locator('#f-text')).toBeVisible();
});

test('K04: public map and player draw pins with the Kakao adapter', async ({ page }) => {
  await page.goto('/map');
  await expect(page.locator('.kakao-host')).toBeVisible();
  await expect(page.locator('.kmock-map')).toHaveAttribute('data-level', /\d+/);
  await page.goto('/player');
  await expect(page.locator('.kakao-host')).toBeVisible();
});
