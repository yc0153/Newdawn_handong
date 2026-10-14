import { defineConfig, devices } from '@playwright/test';

// 카카오 지도 모드 검수. 가짜 카카오 SDK(tests/e2e/kakao-mock.js)로 빌드한 두 번째 서버(:3100)를 쓴다.
// 준비: npm run tiles:test, 그리고
//   NEXT_DIST_DIR=.next-kakao NEXT_PUBLIC_KAKAO_MAP_KEY=test NEXT_PUBLIC_KAKAO_SDK_URL=http://127.0.0.1:8099/kakao-mock.js npx next build
//   NEXT_DIST_DIR=.next-kakao APP_ORIGIN=http://localhost:3100 TRUSTED_CLIENT_IP_HEADER=x-test-client-ip npx next start -p 3100
try { process.loadEnvFile('.env.local'); } catch { /* optional */ }

export default defineConfig({
  testDir: 'tests/e2e-kakao',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_KAKAO_BASE_URL ?? 'http://localhost:3100',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    trace: 'off',
  },
});
