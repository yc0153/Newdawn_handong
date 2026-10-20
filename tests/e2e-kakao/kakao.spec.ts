// 카카오 지도 모드: 지도 클릭 → 주변 상세주소 → 검색 → 로드뷰 → 핀 → 의견 등록.
// 가짜 SDK(tests/e2e/kakao-mock.js)를 쓴다. 공개용 위치는 칸 번호뿐이고, 담당자 검토용 핀(좌표·로드뷰 방향)만 따로 간다.
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
  // 영역(원) 없이 누른 자리에 핀만 꽂히고, 바로 옆(같은 200m 칸)을 다시 눌러도 핀이 옮겨진다.
  await expect(page.locator('.kmock-circle')).toHaveCount(0);
  const pickPin = page.locator('.pick-pin');
  await expect(pickPin).toHaveCount(1);
  const mapBox = (await page.locator('.kakao-host').boundingBox())!;
  const offBy = async (x: number, y: number) => { const b = (await pickPin.boundingBox())!; return Math.round(Math.hypot(b.x + b.width / 2 - x, b.y + b.height - y)); };
  const c0 = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
  expect(await offBy(c0.x, c0.y)).toBeLessThanOrEqual(2);
  await page.mouse.click(c0.x + 12, c0.y + 8);
  await expect.poll(() => offBy(c0.x + 12, c0.y + 8)).toBeLessThanOrEqual(2);
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
  // 핀을 꽂기 전에는 다음 단계로 갈 수 없다.
  await expect(page.getByRole('button', { name: /이 핀 위치로 의견 쓰기/ })).toBeDisabled();
  // 핀 꽂기를 누르기 전의 클릭은 로드뷰 자체 동작(둘러보기·이동)에 맡기고 핀을 만들지 않는다.
  const view = (await page.locator('.roadview__view').boundingBox())!;
  await page.mouse.click(view.x + view.width * 0.5, view.y + view.height * 0.5);
  await expect(page.locator('.roadview__droppin')).toHaveCount(0);
  // '핀 꽂기' → 원하는 곳을 누르면 그 자리에 핀(가장자리도 원근 보정), '핀 옮기기'로 다시 꽂기
  const pin = page.locator('.roadview__droppin');
  // 가장자리(네 모서리 가까이)도 핀이 꽂혀야 한다(시험 방향이 화면 밖으로 나가는 경우).
  for (const [i, [fx, fy]] of [[0.25, 0.4], [0.82, 0.7], [0.03, 0.05], [0.97, 0.95], [0.98, 0.04], [0.02, 0.97]].entries()) {
    await page.getByRole('button', { name: i === 0 ? /핀 꽂기/ : /핀 옮기기/ }).click();
    await expect(page.locator('.roadview__catch')).toBeVisible();
    const cx = view.x + view.width * fx, cy = view.y + view.height * fy;
    await page.mouse.click(cx, cy);
    await expect(page.locator('.roadview__catch')).toHaveCount(0);
    // 핀을 꽂아 안내문·버튼이 바뀌어도 로드뷰 크기는 그대로(크기가 바뀌면 장면이 다시 맞춰져 핀이 움직여 보인다)
    expect(await page.locator('.roadview__view').boundingBox()).toEqual(view);
    await expect(pin).toHaveCount(1);
    await expect.poll(async () => {
      const b = (await pin.boundingBox())!;
      return Math.round(Math.hypot(b.x + b.width / 2 - cx, b.y + b.height - cy));
    }).toBeLessThanOrEqual(fx < 0.1 || fx > 0.9 ? 6 : 3);
  }
  await page.getByRole('button', { name: /이 핀 위치로 의견 쓰기/ }).click();

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
  expect(Object.keys(body).sort()).toEqual(['allow_map', 'allow_player', 'category', 'cell_x', 'cell_y', 'grid_version', 'language', 'notice_version', 'original_text', 'review_pin']);
  // 검수빌딩은 칸 (40, 44)의 대표점. 공개용 위치는 칸 번호뿐이다.
  expect([body.cell_x, body.cell_y]).toEqual([40, 44]);
  // 담당자 검토용 핀: 고른 장소 좌표(같은 칸 안) + 로드뷰 핀 방향·시점. 주소 글자는 보내지 않는다.
  expect(Object.keys(body.review_pin).sort()).toEqual(['lat', 'lon', 'roadview']);
  expect(Object.keys(body.review_pin.roadview).sort()).toEqual(['pano_id', 'pin_pan', 'pin_tilt', 'view_pan', 'view_tilt', 'view_zoom']);
  expect(body.review_pin.roadview.pano_id).toBe(4242);
  expect(JSON.stringify(body)).not.toMatch(/검수빌딩|검수로|검수동|"(zip|address|road|jibun|name)"/);
});

test('K06: the operator detail shows the writer\'s map pin and the roadview pin in the same scene', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.locator('.kakao-host')).toBeVisible();
  await clickMapCenter(page);
  await page.fill('#place-q', '시청');
  await page.getByRole('button', { name: '검색' }).click();
  await page.locator('.addr-item', { hasText: '검수빌딩' }).click();
  await expect(page.locator('.kmock-roadview')).toContainText('ROADVIEW 4242');
  const view = (await page.locator('.roadview__view').boundingBox())!;
  await page.getByRole('button', { name: /핀 꽂기/ }).click();
  const at = { fx: 0.3, fy: 0.62 };
  await page.mouse.click(view.x + view.width * at.fx, view.y + view.height * at.fy);
  await expect(page.locator('.roadview__droppin')).toHaveCount(1);
  await page.getByRole('button', { name: /이 핀 위치로 의견 쓰기/ }).click();
  await expect(page.locator('.location-box')).toContainText('담당자만');
  // 의견을 쓰는 중에 로드뷰 핀을 옮겨도 옮긴 핀이 저장된다.
  const first = { ...at };
  await page.getByRole('button', { name: /핀 옮기기/ }).click();
  at.fx = 0.62; at.fy = 0.41;
  await page.mouse.click(view.x + view.width * at.fx, view.y + view.height * at.fy);
  await expect(page.locator('.roadview__catch')).toHaveCount(0);
  expect(at).not.toEqual(first);
  const text = `[E2E 카카오] 담당자 핀 확인 ${Date.now()}`;
  await page.selectOption('#f-category', 'environment');
  await page.selectOption('#f-language', 'ko');
  await page.fill('#f-text', text);
  await page.getByRole('button', { name: /의견 등록/ }).click();
  await expect(page).toHaveURL(/\/submit\/complete$/);

  // 담당자 로그인(이 검수 서버 전용 로컬 계정) → 상세
  await page.goto('/admin/login');
  await page.fill('#a-email', process.env.E2E_KAKAO_ADMIN_EMAIL ?? 'admin@local.test');
  await page.fill('#a-password', process.env.E2E_KAKAO_ADMIN_PASSWORD ?? 'kakao-e2e-local-only');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const list = await (await page.request.get('/api/admin/opinions?status=pending')).json() as { data: { id: string; original_text: string }[] };
  const id = list.data.find((o) => o.original_text === text)!.id;
  // 목록 응답에는 정확한 핀이 없다
  expect(JSON.stringify(list)).not.toMatch(/review_pin|pano_id/);
  await page.goto(`/admin/opinions/${id}`);
  await expect(page.getByText('지도 핀 + 로드뷰 핀')).toBeVisible();
  // 지도: 글쓴이가 꽂은 핀 + 공개되는 대략 위치(원)
  await expect(page.locator('.admin-map .pick-pin')).toHaveCount(1);
  await expect(page.locator('.admin-map .kmock-circle')).toHaveCount(1);
  // 로드뷰: 같은 지점(4242)·같은 시점으로 열리고 핀이 같은 자리(화면 비율 기준)에 보인다
  const rv = page.locator('.admin-rv');
  await expect(rv.locator('.kmock-roadview')).toContainText('ROADVIEW 4242');
  const pin = rv.locator('.roadview__droppin');
  await expect(pin).toBeVisible();
  const box = (await rv.locator('.admin-rv__view').boundingBox())!;
  await expect.poll(async () => {
    const b = (await pin.boundingBox())!;
    return Math.round(Math.hypot((b.x + b.width / 2 - box.x) / box.width - at.fx, (b.y + b.height - box.y) / box.height - at.fy) * 1000);
  }).toBeLessThanOrEqual(20);
  // 핀 쪽으로 보기: 핀이 가운데로 온다
  await rv.getByRole('button', { name: '핀 쪽으로 보기' }).click();
  await expect.poll(async () => {
    const b = (await pin.boundingBox())!;
    return Math.round(Math.abs((b.x + b.width / 2 - box.x) / box.width - 0.5) * 1000);
  }).toBeLessThanOrEqual(20);
  await rv.getByRole('button', { name: '처음 화면으로' }).click();
  await expect.poll(async () => {
    const b = (await pin.boundingBox())!;
    return Math.round(Math.abs((b.x + b.width / 2 - box.x) / box.width - at.fx) * 1000);
  }).toBeLessThanOrEqual(20);
});

test('K02: skipping the address keeps the map place', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.locator('.kakao-host')).toBeVisible();
  await clickMapCenter(page);
  await expect(page.locator('.addr-item').first()).toBeVisible();
  // 주소를 고르지 않고 건너뛰면 지도에서 누른 칸 그대로 의견을 쓴다.
  await page.getByRole('button', { name: '주소 없이 지도 위치로 진행' }).click();
  await expect(page.locator('#f-text')).toBeVisible();
  await expect(page.locator('.location-box')).toContainText('약 200m');
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

test('K05: the player shows the map pin and the street view near the representative point', async ({ page }) => {
  let data = [{ public_id: '7e2f6a52-1b7c-4c55-9a5e-0d4a3a1b2c3d', category: 'transport', location: { lat: 36.05, lon: 129.37 }, summary: '[E2E 카카오] 거리 모습 확인' }];
  await page.route('**/api/public/opinions?mode=player', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) }));
  await page.goto('/player');
  await expect(page.locator('.case__summary')).toHaveText('[E2E 카카오] 거리 모습 확인');
  const rv = page.locator('.player-rv');
  await expect(rv).toBeVisible();
  await expect(rv).toContainText('대략 위치 주변 거리 모습');
  await expect(rv.locator('.kmock-roadview')).toContainText('ROADVIEW 4242');
  await expect(page.locator('.player__map .pin')).toHaveCount(1);
  // 근처에 로드뷰가 없으면 안내만(가짜 SDK는 36.1 북쪽에 로드뷰가 없다고 답함)
  data = [{ ...data[0], location: { lat: 36.2, lon: 129.37 } }];
  await page.reload();
  await expect(rv).toContainText('이 근처에는 로드뷰가 없습니다.');
  // 공개 목록이 비면(철회) 거리 모습도 함께 사라진다
  data = [];
  await page.reload();
  await expect(page.getByText('아직 상영할 공개 의견이 없습니다.')).toBeVisible();
  await expect(rv).toHaveCount(0);
});
