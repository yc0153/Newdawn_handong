import { createPublicRpcClient } from '@/lib/supabase/privileged';
import { errorResponse, json, logRequest, UPSTREAM_TIMEOUT_MS } from '@/lib/api/http';
import { serverReadyForSubmissions } from '@/lib/api/submission';
import type { PublicConfig } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = performance.now();
  let client;
  try { client = createPublicRpcClient(); } catch {
    logRequest('public/config', 503, started, 'CONFIG_INCOMPLETE');
    return errorResponse(503, 'CONFIG_INCOMPLETE');
  }
  const { data, error } = await client.rpc('read_public_config').abortSignal(AbortSignal.timeout(UPSTREAM_TIMEOUT_MS));
  if (error || !data) {
    logRequest('public/config', 503, started, 'SERVICE_UNAVAILABLE');
    return errorResponse(503, 'SERVICE_UNAVAILABLE');
  }
  const raw = data as PublicConfig;
  const body: PublicConfig = {
    grid_version: raw.grid_version,
    notice_version: raw.notice_version,
    // DB 설정과 서버 빈도 제한 설정이 모두 준비되어야 등록 가능으로 표시한다.
    submissions_enabled: Boolean(raw.submissions_enabled) && serverReadyForSubmissions(process.env),
    allowed_cells: (raw.allowed_cells ?? []).map((c) => ({ cell_x: c.cell_x, cell_y: c.cell_y })),
  };
  logRequest('public/config', 200, started);
  return json(body);
}
