import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
import { backendMode } from '@/lib/backend/mode';

// Supabase 담당자 세션 쿠키를 갱신한다. 로컬 DB 모드는 서명 쿠키를 요청마다 직접 검사하므로 할 일이 없다.
export async function proxy(request: NextRequest) {
  if (backendMode() === 'local') return NextResponse.next({ request });
  return updateSession(request);
}
export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
