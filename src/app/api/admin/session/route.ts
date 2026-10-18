import { cookies } from 'next/headers';
import { assertSameOrigin, fromHttpError, HttpError, json, logRequest, readJsonObject } from '@/lib/api/http';
import { backendMode } from '@/lib/backend/mode';
import { issueSession, LOCAL_SESSION_COOKIE, LOCAL_SESSION_TTL_S } from '@/lib/backend/local-auth';

export const dynamic = 'force-dynamic';

// 로컬 DB 모드 전용 담당자 로그인·로그아웃. Supabase 모드에서는 브라우저가 Supabase Auth를 쓰므로 없는 경로로 둔다.
const FAILURE_DELAY_MS = 400;
// PC 한 대에서 쓰는 개발·시연용 서버라 프로세스 메모리로 실패 횟수만 센다(5분에 10번 넘으면 잠시 막음).
const FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_FAILURES = 10;
const failures: number[] = [];

function onlyLocal() {
  if (backendMode() !== 'local') throw new HttpError(404, 'NOT_FOUND');
}

function recentFailures(now = Date.now()) {
  while (failures.length && now - failures[0] > FAILURE_WINDOW_MS) failures.shift();
  return failures.length;
}

export async function POST(request: Request) {
  const started = performance.now();
  try {
    onlyLocal();
    assertSameOrigin(request);
    if (recentFailures() >= MAX_FAILURES) throw new HttpError(429, 'RATE_LIMITED');
    const body = await readJsonObject(request, 1024);
    const keys = Object.keys(body);
    if (keys.length !== 2 || !keys.includes('email') || !keys.includes('password')) throw new HttpError(400, 'INVALID_FIELDS');
    const { email, password } = body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) throw new HttpError(400, 'INVALID_BODY');
    const { localSignIn, localMembershipActive } = await import('@/lib/backend/local');
    const { getLocalDb } = await import('@/lib/backend/local-db');
    const userId = await localSignIn(email, password);
    // 비밀번호가 맞아도 활성 담당자가 아니면 같은 실패로 답한다(계정 존재·비밀번호 일치 여부를 알리지 않음).
    if (!userId || !(await localMembershipActive(userId))) {
      failures.push(Date.now());
      await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    const { secret } = await getLocalDb();
    (await cookies()).set(LOCAL_SESSION_COOKIE, issueSession(userId, secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: LOCAL_SESSION_TTL_S,
    });
    logRequest('admin/session', 200, started);
    return json({ ok: true });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/session', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}

export async function DELETE(request: Request) {
  try {
    onlyLocal();
    assertSameOrigin(request);
    (await cookies()).delete(LOCAL_SESSION_COOKIE);
    return json({ ok: true });
  } catch (e) {
    return fromHttpError(e);
  }
}
