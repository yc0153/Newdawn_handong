import 'server-only';
import { redirect } from 'next/navigation';
import { HttpError } from '@/lib/api/http';
import { requireOperator } from '@/lib/backend/operator';

/** 담당자 화면 가드. 미로그인은 로그인으로 보내고, 권한 없음·장애는 상태로 돌려준다. */
export async function guardAdminPage(): Promise<{ ok: true; userId: string } | { ok: false; status: 'forbidden' | 'unavailable' }> {
  try {
    const { userId } = await requireOperator();
    return { ok: true, userId };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/admin/login');
    if (e instanceof HttpError && e.status === 403) return { ok: false, status: 'forbidden' };
    return { ok: false, status: 'unavailable' };
  }
}
