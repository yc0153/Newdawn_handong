import { assertSameOrigin, fromHttpError, HttpError, isUuid, json, logRequest, readJsonObject } from '@/lib/api/http';
import { fingerprint, rateKeyHash } from '@/lib/api/submission';
import { validateSubmission, ValidationError } from '@/lib/domain/validation';
import { publicStore } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const MESSAGE = '의견이 등록되었습니다. 담당자가 확인하기 전에는 공개되지 않습니다.';
const MESSAGE_PUBLISHED = '의견이 등록되었습니다. 테스트 모드라 검토 없이 바로 공개되었습니다.';
const SHAPE_ERRORS = new Set(['INVALID_BODY', 'INVALID_FIELDS']);

export async function POST(request: Request) {
  const started = performance.now();
  try {
    assertSameOrigin(request);
    const key = request.headers.get('idempotency-key');
    if (!isUuid(key)) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY');
    const body = await readJsonObject(request);
    let submission;
    try {
      submission = validateSubmission(body, null);
    } catch (e) {
      if (e instanceof ValidationError) {
        const field = e.code === 'INVALID_CELL' || e.code === 'INVALID_GRID' || e.code === 'INVALID_PIN' ? 'location' : e.field;
        throw new HttpError(SHAPE_ERRORS.has(e.code) ? 400 : 422, e.code, field);
      }
      throw e;
    }
    const store = await publicStore();
    const keyHash = rateKeyHash(request.headers, await store.rateEnv());
    const receipt = await store.submitOpinion({
      request_key: key.toLowerCase(),
      fingerprint: fingerprint(submission),
      key_hash: keyHash,
      grid_version: submission.grid_version,
      cell_x: submission.cell_x,
      cell_y: submission.cell_y,
      category: submission.category,
      language: submission.language,
      original_text: submission.original_text,
      allow_map: submission.allow_map,
      allow_player: submission.allow_player,
      notice_version: submission.notice_version,
      review_pin: submission.review_pin ?? null,
    });
    const status = receipt.created ? 201 : 200;
    const published = receipt.published === true;
    logRequest('opinions', status, started);
    return json({ reference: receipt.reference, message: published ? MESSAGE_PUBLISHED : MESSAGE, published }, status);
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('opinions', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}
