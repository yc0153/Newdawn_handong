import type { NextRequest } from 'next/server';
import { fromHttpError, HttpError, json, logRequest, UPSTREAM_TIMEOUT_MS } from '@/lib/api/http';
import { requireOperator } from '@/lib/supabase/operator';
import { ADMIN_COLUMNS, toAdminOpinion } from '@/lib/api/admin-dto';

export const dynamic = 'force-dynamic';

const STATUSES = ['all', 'pending', 'published', 'hidden'];

export async function GET(request: NextRequest) {
  const started = performance.now();
  try {
    const q = request.nextUrl.searchParams;
    const status = q.get('status') ?? 'all';
    const page = Number(q.get('page') ?? '1');
    const pageSize = Number(q.get('page_size') ?? '50');
    if (!STATUSES.includes(status) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new HttpError(400, 'INVALID_QUERY');
    }
    const { supabase } = await requireOperator();
    let query = supabase
      .from('opinions')
      .select(ADMIN_COLUMNS, { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .abortSignal(AbortSignal.timeout(UPSTREAM_TIMEOUT_MS));
    if (status !== 'all') query = query.eq('status', status);
    const { data, error, count } = await query;
    if (error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    logRequest('admin/opinions', 200, started);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return json({ data: (data ?? []).map((r: any) => toAdminOpinion(r)), page, page_size: pageSize, total: count ?? 0 });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/opinions', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
