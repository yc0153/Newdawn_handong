import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/lib/api/http';
import { createClient } from './server';

export type OperatorContext = { supabase: SupabaseClient; userId: string };

/**
 * 쿠키 세션을 Auth 서버에 검증한 뒤 DB의 활성 담당자 명단을 확인한다.
 * user_metadata·브라우저 표시·로그인 여부만으로는 권한을 주지 않는다.
 * 이후 조회·변경은 같은 JWT client로 실행되어 RLS와 RPC 검사도 다시 적용된다.
 */
export async function requireOperator(): Promise<OperatorContext> {
  let supabase: SupabaseClient;
  try {
    supabase = await createClient();
  } catch {
    throw new HttpError(503, 'CONFIG_INCOMPLETE');
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED');
  const membership = await supabase
    .from('operator_memberships')
    .select('active')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (membership.error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
  if (!membership.data?.active) throw new HttpError(403, 'FORBIDDEN');
  return { supabase, userId: data.user.id };
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
