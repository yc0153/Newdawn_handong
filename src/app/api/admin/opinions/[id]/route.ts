import { fromHttpError, HttpError, isUuid, json, logRequest, UPSTREAM_TIMEOUT_MS } from '@/lib/api/http';
import { requireOperator } from '@/lib/supabase/operator';
import { ADMIN_COLUMNS, toAdminOpinion, toAudit } from '@/lib/api/admin-dto';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = performance.now();
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, 'INVALID_ID');
    const { supabase } = await requireOperator();
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const row = await supabase
      .from('opinions')
      .select(ADMIN_COLUMNS + ',notice_version')
      .eq('id', id)
      .is('deleted_at', null)
      .abortSignal(signal)
      .maybeSingle();
    if (row.error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    if (!row.data) throw new HttpError(404, 'NOT_FOUND');
    const audit = await supabase
      .from('admin_audit_logs')
      .select('actor_id,action,version,created_at')
      .eq('opinion_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .abortSignal(signal);
    if (audit.error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row.data as any;
    logRequest('admin/opinion', 200, started);
    return json({ ...toAdminOpinion(r), notice_version: r.notice_version, audit_logs: (audit.data ?? []).map(toAudit) });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/opinion', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
