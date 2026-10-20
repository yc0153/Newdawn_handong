import { fromHttpError, HttpError, json, logRequest } from '@/lib/api/http';
import { requireOperator } from '@/lib/backend/operator';
import { toAdminOpinion, type AdminRowInput } from '@/lib/api/admin-dto';
import { OVERVIEW_ROW_LIMIT } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';

// 담당자 첫 화면(전체 현황): 상태·분야별 건수와 최신 의견 위치. 원문은 앞부분만 보낸다(전체는 상세 화면에서).
const PREVIEW = 80;

export async function GET() {
  const started = performance.now();
  try {
    const operator = await requireOperator();
    const o = await operator.overview();
    const items = o.rows.map((r) => {
      const a = toAdminOpinion(r as AdminRowInput);
      return {
        id: a.id, category: a.category, status: a.status, location: a.location, summary: a.summary,
        preview: [...(a.original_text ?? '')].slice(0, PREVIEW).join(''),
        allow_map: a.allow_map, allow_player: a.allow_player, include_in_player: a.include_in_player, created_at: a.created_at,
      };
    });
    logRequest('admin/overview', 200, started);
    return json({ counts: o.counts, by_category: o.by_category, items, truncated: o.counts.total > items.length, limit: OVERVIEW_ROW_LIMIT });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/overview', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
