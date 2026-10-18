// Supabase 없이 이 PC에서 바로 실행한다: 내장 DB(PGlite)를 .local-db 폴더에 만들고 같은 API로 동작한다.
// 사용: npm run dev:local            (개발 서버, http://localhost:3000)
//       npm run dev:local -- --port 3001
// 처음 실행하면 포항시 전체 등록 영역을 열고 담당자 계정을 만들어 .local-db/admin-account.txt에 적는다.
// DB를 처음 상태로 되돌리려면 서버를 끄고 .local-db 폴더를 지운다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const env = {
  ...process.env,
  DATA_BACKEND: 'local',
  NEXT_PUBLIC_ENV_LABEL: process.env.NEXT_PUBLIC_ENV_LABEL || '로컬 DB',
};
console.log('[로컬 DB] Supabase 없이 내장 DB(.local-db 폴더)로 실행합니다.');
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
