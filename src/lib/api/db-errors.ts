import { HttpError } from './http';

// DB 예외 문구 → 안전한 HTTP 오류. SQL·원문·내부 정보는 응답에 넣지 않는다.
const MAP: Record<string, [number, string?]> = {
  SUBMISSIONS_DISABLED: [503],
  INVALID_GRID: [422, 'location'],
  OUTSIDE_AREA: [422, 'location'],
  INVALID_NOTICE: [422, 'notice_version'],
  TEXT_TOO_SHORT: [422, 'original_text'],
  TEXT_TOO_LONG: [422, 'original_text'],
  INVALID_CONSENT: [422, 'allow_player'],
  INVALID_CATEGORY: [422, 'category'],
  INVALID_LANGUAGE: [422, 'language'],
  INVALID_REQUEST: [400],
  IDEMPOTENCY_CONFLICT: [409],
  RATE_LIMITED: [429],
  PUBLIC_DATA_LIMIT: [503],
  INVALID_MODE: [400],
  FORBIDDEN: [403],
  NOT_FOUND: [404],
  OPINION_DELETED: [404],
  VERSION_CONFLICT: [409],
  HIDE_BEFORE_EDIT: [409],
  INVALID_TRANSITION: [409],
  IMMUTABLE_SUBMISSION: [409],
  INVALID_SUMMARY: [422, 'summary'],
  PUBLICATION_NOT_ALLOWED: [422],
  PLAYER_NOT_ALLOWED: [422, 'include_in_player'],
  INVALID_ACTION: [400],
};

export function mapDbError(error: { message?: string; code?: string } | null | undefined): HttpError {
  const message = error?.message ?? '';
  const code = Object.keys(MAP).find((k) => message === k || message.startsWith(k + ' ') || message.startsWith(k + ':'));
  if (code) {
    const [status, field] = MAP[code];
    return new HttpError(status, code === 'OPINION_DELETED' ? 'NOT_FOUND' : code, field);
  }
  if (error?.code === '42501') return new HttpError(403, 'FORBIDDEN');
  return new HttpError(503, 'SERVICE_UNAVAILABLE');
}
