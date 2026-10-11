// 로컬에서 바로 써볼 수 있게 한 번에 준비한다. (로컬 전용, 운영·원격 프로젝트에는 사용하지 않음)
// 1) Docker 확인 → 2) 로컬 Supabase 시작·마이그레이션 → 3) .env.local 작성
// 4) 로컬 테스트 영역 열기 → 5) 로컬 담당자 계정 만들기
// 사용: npm run local:setup            (기본 담당자: admin@local.test, 비밀번호는 화면에 출력)
//       npm run local:setup -- 이메일 비밀번호
//       npm run local:setup -- --no-cli   (Supabase는 이미 떠 있고 .env.local도 있을 때 4·5단계만)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const noCli = args.includes('--no-cli');
const [email = 'admin@local.test', password = `local-${randomBytes(6).toString('hex')}`] = args.filter((a) => !a.startsWith('--'));
const ENV_FILE = '.env.local';
const isWin = process.platform === 'win32';

function step(n, text) { console.log(`\n[${n}/5] ${text}`); }
function fail(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }
function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: isWin, encoding: 'utf8' });
}
function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

let env = readEnv(ENV_FILE);

if (!noCli) {
  step(1, 'Docker 실행 확인');
  if (run('docker', ['info'], { capture: true }).status !== 0) {
    fail('Docker가 실행 중이 아닙니다. Docker Desktop을 켜고(고래 아이콘이 Running) 다시 실행하세요.');
  }

  step(2, '로컬 Supabase 시작 (처음에는 이미지 내려받기로 몇 분 걸립니다)');
  const exclude = 'realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor';
  if (run('npx', ['supabase', 'start', '-x', exclude]).status !== 0) fail('supabase start 실패. 위 오류를 확인하세요.');
  if (run('npx', ['supabase', 'migration', 'up', '--local']).status !== 0) fail('마이그레이션 적용 실패.');

  step(3, `${ENV_FILE} 작성`);
  const st = run('npx', ['supabase', 'status', '-o', 'json'], { capture: true });
  const jsonText = (st.stdout ?? '').slice((st.stdout ?? '').indexOf('{'));
  let s;
  try { s = JSON.parse(jsonText); } catch { fail('supabase status 결과를 읽지 못했습니다.'); }
  const url = s.API_URL;
  const publishable = s.PUBLISHABLE_KEY || s.ANON_KEY;
  const secret = s.SECRET_KEY || s.SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) fail('Supabase 접속 정보를 찾지 못했습니다.');
  if (existsSync(ENV_FILE)) copyFileSync(ENV_FILE, `${ENV_FILE}.bak`);
  const keep = (k) => (env[k] ? `${k}=${env[k]}\n` : '');
  const content =
    `# 로컬 개발 전용 (npm run local:setup 이 작성). Git에 올리지 않는다.\n` +
    `NEXT_PUBLIC_SUPABASE_URL=${url}\n` +
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}\n` +
    `SUPABASE_SECRET_KEY=${secret}\n` +
    `APP_ORIGIN=http://localhost:3000\n` +
    `RATE_LIMIT_HMAC_SECRET=${env.RATE_LIMIT_HMAC_SECRET || randomBytes(32).toString('hex')}\n` +
    `TRUSTED_CLIENT_IP_HEADER=\n` +
    `NEXT_PUBLIC_ENV_LABEL=로컬 개발\n` +
    keep('NEXT_PUBLIC_MAP_TILE_URL') + keep('NEXT_PUBLIC_MAP_ATTRIBUTION');
  writeFileSync(ENV_FILE, content);
  env = readEnv(ENV_FILE);
} else {
  console.log('--no-cli: Supabase 시작과 .env.local 작성은 건너뜁니다.');
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
if (!url || !secret) fail(`${ENV_FILE}에 Supabase 접속 정보가 없습니다.`);
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) fail('로컬 Supabase에서만 실행합니다.');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

step(4, '로컬 테스트 영역 열기 (실제 수집 지역 아님)');
const cells = [];
for (let x = 28; x <= 48; x++) for (let y = 18; y <= 52; y++) cells.push({ cell_x: x, cell_y: y });
const up = await db.from('allowed_cells').upsert(cells, { onConflict: 'cell_x,cell_y', ignoreDuplicates: true });
if (up.error) fail(`허용 영역 등록 실패: ${up.error.message}`);
const on = await db.from('service_settings').update({ submissions_enabled: true }).eq('singleton', true);
if (on.error) fail(`등록 켜기 실패: ${on.error.message}`);

step(5, '로컬 담당자 계정');
let userId = null;
for (let page = 1; !userId; page++) {
  const list = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (list.error) fail(`계정 목록 조회 실패: ${list.error.message}`);
  userId = list.data.users.find((u) => u.email === email)?.id ?? null;
  if (list.data.users.length < 200) break;
}
let created = false;
if (!userId) {
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) fail(`계정 생성 실패: ${c.error.message}`);
  userId = c.data.user.id;
  created = true;
}
const m = await db.from('operator_memberships').upsert({ user_id: userId, active: true });
if (m.error) fail(`담당자 명단 등록 실패: ${m.error.message}`);

console.log('\n✔ 준비 완료');
console.log('  다음: npm run dev  →  http://localhost:3000');
console.log('  담당자 화면: http://localhost:3000/admin/login');
console.log(`  이메일: ${email}`);
console.log(created ? `  비밀번호: ${password}` : '  비밀번호: (이미 있던 계정이라 기존 비밀번호 그대로)');
