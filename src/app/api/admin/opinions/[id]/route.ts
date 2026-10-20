import { fromHttpError, HttpError, isUuid, json, logRequest } from '@/lib/api/http';
import { requireOperator } from '@/lib/backend/operator';
import { toAdminOpinion, toAudit, type AdminRowInput } from '@/lib/api/admin-dto';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = performance.now();
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, 'INVALID_ID');
    const operator = await requireOperator();
    const found = await operator.getOpinion(id);
    if (!found) throw new HttpError(404, 'NOT_FOUND');
    const r = found.row;
    logRequest('admin/opinion', 200, started);
    // 정확한 핀은 담당자 상세에서만 내보낸다(목록·현황·공개 경로에는 없음).
    return json({ ...toAdminOpinion(r as AdminRowInput), notice_version: r.notice_version, audit_logs: found.audit.map(toAudit), review_pin: found.review_pin });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/opinion', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
