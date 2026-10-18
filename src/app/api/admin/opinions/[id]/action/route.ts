import { assertSameOrigin, fromHttpError, HttpError, isUuid, json, logRequest, readJsonObject } from '@/lib/api/http';
import { AdminInputError, parseAdminAction } from '@/lib/api/admin-dto';
import { requireOperator } from '@/lib/backend/operator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = performance.now();
  try {
    assertSameOrigin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, 'INVALID_ID');
    const operator = await requireOperator();
    const body = await readJsonObject(request);
    let input;
    try {
      input = parseAdminAction(body);
    } catch (e) {
      if (e instanceof AdminInputError) throw new HttpError(e.code === 'INVALID_SUMMARY' ? 422 : 400, e.code, e.field);
      throw e;
    }
    const r = await operator.action({
      id,
      expected_version: input.expected_version,
      action: input.action,
      summary: input.action === 'save_summary' ? input.summary : null,
      include_in_player: input.action === 'set_player' ? input.include_in_player : null,
    });
    logRequest('admin/action', 200, started);
    return json({ id: r.id, status: r.status, version: r.version, deleted: r.deleted });
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('admin/action', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
