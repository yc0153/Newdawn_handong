import { createPublicRpcClient } from '@/lib/supabase/privileged';
import { assertSameOrigin, fromHttpError, HttpError, isUuid, json, logRequest, readJsonObject, UPSTREAM_TIMEOUT_MS } from '@/lib/api/http';
import { mapDbError } from '@/lib/api/db-errors';
import { fingerprint, rateKeyHash } from '@/lib/api/submission';
import { validateSubmission, ValidationError } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

const MESSAGE = '의견이 등록되었습니다. 담당자가 확인하기 전에는 공개되지 않습니다.';
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
      submission = validateSubmission(body);
    } catch (e) {
      if (e instanceof ValidationError) {
        const field = e.code === 'INVALID_CELL' || e.code === 'INVALID_GRID' ? 'location' : e.field;
        throw new HttpError(SHAPE_ERRORS.has(e.code) ? 400 : 422, e.code, field);
      }
      throw e;
    }
    const keyHash = rateKeyHash(request.headers, process.env);
    let client;
    try { client = createPublicRpcClient(); } catch { throw new HttpError(503, 'CONFIG_INCOMPLETE'); }
    const { data, error } = await client
      .rpc('submit_opinion', {
        p_request_key: key.toLowerCase(),
        p_fingerprint: fingerprint(submission),
        p_key_hash: keyHash,
        p_grid_version: submission.grid_version,
        p_cell_x: submission.cell_x,
        p_cell_y: submission.cell_y,
        p_category: submission.category,
        p_language: submission.language,
        p_original_text: submission.original_text,
        p_allow_map: submission.allow_map,
        p_allow_player: submission.allow_player,
        p_notice_version: submission.notice_version,
      })
      .abortSignal(AbortSignal.timeout(UPSTREAM_TIMEOUT_MS));
    if (error || !data) throw mapDbError(error);
    const receipt = data as { reference: string; created: boolean };
    const status = receipt.created ? 201 : 200;
    logRequest('opinions', status, started);
    return json({ reference: receipt.reference, message: MESSAGE }, status);
  } catch (e) {
    const res = fromHttpError(e);
    logRequest('opinions', res.status, started, e instanceof HttpError ? e.code : 'UNEXPECTED');
    return res;
  }
}

