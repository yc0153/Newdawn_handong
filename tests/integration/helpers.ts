// 실행 중인 Next 서버 + 로컬 Supabase(Auth·PostgREST·Postgres)를 대상으로 하는 연결 검수 도우미.
// 운영 프로젝트에는 실행하지 않는다: Supabase URL이 localhost가 아니면 중단한다.
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3000';
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
export const IP_HEADER = process.env.TRUSTED_CLIENT_IP_HEADER ?? '';

if (!SB_URL || !['127.0.0.1', 'localhost'].includes(new URL(SB_URL).hostname)) {
  throw new Error('integration tests run only against a local Supabase');
}

export const admin = createClient(SB_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

export function uniqueIp() {
  const n = Math.floor(Math.random() * 250) + 1;
  const m = Math.floor(Math.random() * 250) + 1;
  return `10.${(process.pid % 250) + 1}.${n}.${m}`;
}

export const validBody = (over: Record<string, unknown> = {}) => ({
  grid_version: 'pohang-v1',
  cell_x: 40,
  cell_y: 40,
  category: 'transport',
  language: 'ko',
  original_text: `[연결검수] ${randomUUID().slice(0, 8)} 자동 테스트 원문입니다`,
  allow_map: true,
  allow_player: true,
  notice_version: '2026-10-06-v1',
  ...over,
});

export async function submit(body: unknown, opts: { key?: string; ip?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: opts.origin ?? new URL(BASE).origin,
    'idempotency-key': opts.key ?? randomUUID(),
    ...opts.headers,
  };
  if (IP_HEADER) headers[IP_HEADER] = opts.ip ?? uniqueIp();
  const res = await fetch(`${BASE}/api/opinions`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** @supabase/ssr와 같은 쿠키 형식으로 로그인 세션을 만들어 Cookie 헤더로 돌려준다. */
export async function loginCookie(email: string, password: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(SB_URL, PUBLISHABLE, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return {
    cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; '),
    accessToken: data.session!.access_token,
    userId: data.user!.id,
  };
}

export async function adminGet(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

export async function adminAction(id: string, body: Record<string, unknown>, cookie?: string, origin = new URL(BASE).origin) {
  const res = await fetch(`${BASE}/api/admin/opinions/${id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export async function publicData(mode: 'browse' | 'player' = 'browse') {
  const res = await fetch(`${BASE}/api/public/opinions?mode=${mode}`);
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown>[] }, headers: res.headers };
}

/** 등록 참고번호로 내부 id를 찾는다(테스트 전용, 서비스 키로 직접 조회). */
export async function idByReference(reference: string): Promise<string> {
  const { data, error } = await admin.from('submission_receipts').select('opinion_id').eq('reference', reference).single();
  if (error) throw error;
  return data.opinion_id as string;
}

export async function publicIdOf(id: string): Promise<string> {
  const { data, error } = await admin.from('opinions').select('public_id').eq('id', id).single();
  if (error) throw error;
  return data.public_id as string;
}

export async function ensureUser(email: string, password: string, operator: boolean | null) {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list.data.users.find((u) => u.email === email);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  if (operator !== null) {
    const r = await admin.from('operator_memberships').upsert({ user_id: user.id, active: operator });
    if (r.error) throw r.error;
  } else {
    await admin.from('operator_memberships').delete().eq('user_id', user.id);
  }
  return user.id;
}
