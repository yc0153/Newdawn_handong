import { assertSameOrigin, fromHttpError, HttpError, json, logRequest, readJsonObject } from '@/lib/api/http';
import { publicStore } from '@/lib/backend';
import { requireOperator } from '@/lib/backend/operator';

export const dynamic = 'force-dynamic';

// 담당자용 서비스 설정. 지금은 테스트 모드(검토 없이 바로 공개) 하나만 다룬다. 켜면 정한 시간 뒤 저절로 꺼진다.
const DEFAULT_HOURS = 12;

export async function GET() {
  const started = performance.now();
  try {
    await requireOperator();
    const raw = await (await publicStore()).readPublicConfig();
    logRequest('admin/settings', 200, started);
    return json({
      test_auto_publish: raw.test_auto_publish === true,
      test_auto_publish_until: raw.test_auto_publish === true ? raw.test_auto_publish_until ?? null : null,
      test_auto_publish_supported: 'test_auto_publish' in raw,
    });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/settings', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}

export async function POST(request: Request) {
  const started = performance.now();
  try {
    assertSameOrigin(request);
    const operator = await requireOperator();
    const body = await readJsonObject(request, 256);
    const keys = Object.keys(body);
    if (typeof body.test_auto_publish !== 'boolean' || keys.some((k) => k !== 'test_auto_publish' && k !== 'hours')) throw new HttpError(400, 'INVALID_FIELDS');
    const hours = body.hours ?? DEFAULT_HOURS;
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 72) throw new HttpError(400, 'INVALID_FIELDS', 'hours');
    const r = await operator.setTestAutoPublish(body.test_auto_publish, hours);
    logRequest('admin/settings', 200, started);
    return json({ test_auto_publish: r.enabled, test_auto_publish_until: r.until });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/settings', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
