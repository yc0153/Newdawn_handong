import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 로컬 DB 모드 브라우저 검수: Supabase 없이 `npm run dev:local`(내장 DB)로 띄운 서버를 쓴다.
// 실행: npm run test:e2e:local   (검수용 타일 서버와 개발 서버를 함께 띄우고, 끝나면 닫는다)
// DB는 매번 새 임시 폴더에 만든다. 담당자 계정은 아래 검수 전용 값이다(이 검수 서버에서만 쓰임).
export const LOCAL_E2E_OPERATOR = { email: 'e2e-op@local.test', password: 'e2e-local-only-pass-1019' };
const PORT = Number(process.env.E2E_LOCAL_PORT ?? 3200);
const dbDir = process.env.E2E_LOCAL_DB_DIR ?? mkdtempSync(path.join(tmpdir(), 'pom-e2e-local-'));

export default defineConfig({
  testDir: 'tests/e2e-local',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    trace: 'off',
  },
  webServer: [
    { command: 'node tests/e2e/tile-server.mjs', port: 8099, reuseExistingServer: true },
    {
      command: `node scripts/dev-local.mjs --port ${PORT}`,
      url: `http://localhost:${PORT}/api/public/config`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        LOCAL_DB_DIR: dbDir,
        LOCAL_ADMIN_EMAIL: LOCAL_E2E_OPERATOR.email,
        LOCAL_ADMIN_PASSWORD: LOCAL_E2E_OPERATOR.password,
        APP_ORIGIN: `http://localhost:${PORT}`,
        TRUSTED_CLIENT_IP_HEADER: 'x-test-client-ip',
        NEXT_PUBLIC_MAP_TILE_URL: 'http://127.0.0.1:8099/{z}/{x}/{y}.svg',
        NEXT_PUBLIC_MAP_ATTRIBUTION: '검수용 테스트 타일',
        NEXT_PUBLIC_KAKAO_MAP_KEY: '',
      },
    },
  ],
});
