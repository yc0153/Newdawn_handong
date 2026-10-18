import type { NextRequest } from 'next/server';
import { fromHttpError, HttpError, json, logRequest } from '@/lib/api/http';
import { requireOperator } from '@/lib/backend/operator';
import { toAdminOpinion, type AdminRowInput } from '@/lib/api/admin-dto';

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
    const operator = await requireOperator();
    const { rows, total } = await operator.listOpinions({ status, page, pageSize });
    logRequest('admin/opinions', 200, started);
    return json({ data: rows.map((r) => toAdminOpinion(r as AdminRowInput)), page, page_size: pageSize, total });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/opinions', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
