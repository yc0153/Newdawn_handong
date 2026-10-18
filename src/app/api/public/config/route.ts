import { errorResponse, HttpError, json, logRequest } from '@/lib/api/http';
import { serverReadyForSubmissions } from '@/lib/api/submission';
import { publicStore } from '@/lib/backend';
import type { PublicConfig } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = performance.now();
  try {
    const store = await publicStore();
    const raw = await store.readPublicConfig();
    const body: PublicConfig = {
      grid_version: raw.grid_version as PublicConfig['grid_version'],
      notice_version: raw.notice_version as string,
      // DB 설정과 서버 빈도 제한 설정이 모두 준비되어야 등록 가능으로 표시한다.
      submissions_enabled: Boolean(raw.submissions_enabled) && serverReadyForSubmissions(await store.rateEnv()),
      allowed_cells: (raw.allowed_cells ?? []).map((c) => ({ cell_x: c.cell_x, cell_y: c.cell_y })),
      // 테스트 모드(검토 없이 바로 공개). 새 SQL을 적용하기 전 DB에는 값이 없으므로 꺼짐으로 본다.
      test_auto_publish: raw.test_auto_publish === true,
    };
    logRequest('public/config', 200, started);
    return json(body);
  } catch (err) {
    const code = err instanceof HttpError && err.code === 'CONFIG_INCOMPLETE' ? 'CONFIG_INCOMPLETE' : 'SERVICE_UNAVAILABLE';
    logRequest('public/config', 503, started, code);
    return errorResponse(503, code);
  }
}
