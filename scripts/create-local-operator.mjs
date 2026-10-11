// 로컬 개발 전용 담당자 계정 생성. 원격 프로젝트에는 실행하지 않는다(localhost URL만 허용).
// 사용: node --env-file=.env.local scripts/create-local-operator.mjs <email> <password>
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!email || !password) {
  console.error('usage: node --env-file=.env.local scripts/create-local-operator.mjs <email> <password>');
  process.exit(2);
}
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 필요합니다.'); process.exit(2); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('로컬 Supabase에서만 실행합니다. 운영 계정은 운영 절차로 발급하세요.');
  process.exit(2);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) { console.error('계정 생성 실패:', created.error.message); process.exit(1); }
const m = await admin.from('operator_memberships').insert({ user_id: created.data.user.id, active: true });
if (m.error) { console.error('담당자 명단 등록 실패:', m.error.message); process.exit(1); }
console.log('로컬 담당자 계정을 만들었습니다:', email);
