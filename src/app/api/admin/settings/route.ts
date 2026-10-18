import { assertSameOrigin, fromHttpError, HttpError, json, logRequest, readJsonObject } from '@/lib/api/http';
import { publicStore } from '@/lib/backend';
import { requireOperator } from '@/lib/backend/operator';

export const dynamic = 'force-dynamic';

// 담당자용 서비스 설정. 지금은 테스트 모드(검토 없이 바로 공개) 하나만 다룬다.
export async function GET() {
  const started = performance.now();
  try {
    await requireOperator();
    const raw = await (await publicStore()).readPublicConfig();
    logRequest('admin/settings', 200, started);
    return json({ test_auto_publish: raw.test_auto_publish === true, test_auto_publish_supported: 'test_auto_publish' in raw });
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
    if (Object.keys(body).length !== 1 || typeof body.test_auto_publish !== 'boolean') throw new HttpError(400, 'INVALID_FIELDS');
    const value = await operator.setTestAutoPublish(body.test_auto_publish);
    logRequest('admin/settings', 200, started);
    return json({ test_auto_publish: value });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/settings', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
