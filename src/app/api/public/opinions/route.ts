import type { NextRequest } from 'next/server';
import { errorResponse, HttpError, json, logRequest } from '@/lib/api/http';
import { publicStore } from '@/lib/backend';
import type { PublicOpinion } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const started = performance.now();
  const mode = request.nextUrl.searchParams.get('mode') ?? 'browse';
  if (mode !== 'browse' && mode !== 'player') return errorResponse(400, 'INVALID_MODE');
  let rows: PublicOpinion[];
  try {
    rows = await (await publicStore()).readPublicOpinions(mode);
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(503, 'SERVICE_UNAVAILABLE');
    if (e.code === 'CONFIG_INCOMPLETE') {
      logRequest('public/opinions', 503, started, e.code);
      return errorResponse(503, e.code);
    }
    const status = e.status === 400 ? 400 : 503;
    logRequest('public/opinions', status, started, e.code);
    return errorResponse(status, status === 400 ? e.code : e.code === 'PUBLIC_DATA_LIMIT' ? e.code : 'SERVICE_UNAVAILABLE');
  }
  // SQL이 고정한 4종 필드를 다시 한 번 명시적으로 고른다. 관리자 DTO를 재사용하지 않는다.
  const body = {
    data: rows.map((o) => ({
      public_id: o.public_id,
      category: o.category,
      location: { lat: o.location.lat, lon: o.location.lon },
      summary: o.summary,
    })),
  };
  logRequest('public/opinions', 200, started);
  return json(body);
}
