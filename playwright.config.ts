import { defineConfig, devices } from '@playwright/test';

// 실행 전: 로컬 Supabase, `npm run build && npm start`(또는 dev), 검수용 타일 서버(tests/e2e/tile-server.mjs).
// 서버는 TRUSTED_CLIENT_IP_HEADER=x-test-client-ip 로 띄워 테스트마다 다른 클라이언트로 보이게 한다.
try { process.loadEnvFile('.env.local'); } catch { /* optional */ }

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    trace: 'off',
  },
});
