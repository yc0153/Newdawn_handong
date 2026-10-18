import 'server-only';
import { cookies } from 'next/headers';
import { HttpError } from '@/lib/api/http';
import { backendMode } from './mode';
import { LOCAL_SESSION_COOKIE, verifySession } from './local-auth';
import type { OperatorStore } from './types';

/**
 * 담당자 확인. 로그인 세션을 검증한 뒤 DB의 활성 담당자 명단을 확인한다.
 * user_metadata·브라우저 표시·로그인 여부만으로는 권한을 주지 않는다.
 * Supabase: 같은 JWT client로 이후 조회·변경을 실행해 RLS와 RPC 검사가 다시 적용된다.
 * 로컬 DB: 서명된 HttpOnly 쿠키 + 같은 RLS·RPC를 담당자 역할로 실행한다.
 */
export async function requireOperator(): Promise<OperatorStore> {
  if (backendMode() === 'local') return requireLocalOperator();
  const { requireOperator: requireSupabaseOperator } = await import('@/lib/supabase/operator');
  const { supabaseOperatorStore } = await import('./supabase');
  const { supabase, userId } = await requireSupabaseOperator();
  return supabaseOperatorStore(supabase, userId);
}

async function requireLocalOperator(): Promise<OperatorStore> {
  const local = await import('./local');
  const { getLocalDb } = await import('./local-db');
  let secret: string;
  try { secret = (await getLocalDb()).secret; } catch { throw new HttpError(503, 'SERVICE_UNAVAILABLE'); }
  const token = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  const session = verifySession(token, secret);
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED');
  if (!(await local.localAccountValid(session.sub, session.iat))) throw new HttpError(401, 'UNAUTHENTICATED');
  if (!(await local.localMembershipActive(session.sub))) throw new HttpError(403, 'FORBIDDEN');
  return local.localOperatorStore(session.sub);
}

/** 화면 가드용: 예외 대신 상태를 돌려준다. */
export async function operatorStatus(): Promise<'ok' | 'unauthenticated' | 'forbidden' | 'unavailable'> {
  try {
    await requireOperator();
    return 'ok';
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401) return 'unauthenticated';
      if (e.status === 403) return 'forbidden';
    }
    return 'unavailable';
  }
}
