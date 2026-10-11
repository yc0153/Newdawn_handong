import { NextResponse } from 'next/server';

export const MAX_BODY_BYTES = 8 * 1024;
export const UPSTREAM_TIMEOUT_MS = 10_000;

const NO_STORE = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, public field?: string) {
    super(code);
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_JSON: '요청 형식이 올바르지 않습니다.',
  INVALID_BODY: '요청 형식이 올바르지 않습니다.',
  INVALID_FIELDS: '허용되지 않은 항목이 포함되었습니다.',
  PAYLOAD_TOO_LARGE: '요청이 너무 큽니다.',
  UNSUPPORTED_MEDIA_TYPE: 'JSON 요청만 받습니다.',
  INVALID_IDEMPOTENCY_KEY: '요청 키가 올바르지 않습니다.',
  CROSS_ORIGIN: '허용되지 않은 요청 출처입니다.',
  INVALID_MODE: '조회 방식이 올바르지 않습니다.',
  INVALID_GRID: '위치 정보가 올바르지 않습니다.',
  INVALID_CELL: '위치 정보가 올바르지 않습니다.',
  OUTSIDE_AREA: '의견을 받을 수 있는 영역 밖입니다.',
  INVALID_CATEGORY: '분야를 선택해 주세요.',
  INVALID_LANGUAGE: '작성 언어를 선택해 주세요.',
  INVALID_TEXT: '의견을 입력해 주세요.',
  TEXT_TOO_SHORT: '의견을 공백 제외 10자 이상 입력해 주세요.',
  TEXT_TOO_LONG: '의견은 500자 이하로 입력해 주세요.',
  INVALID_CONSENT: '플레이어 공개는 지도 공개를 선택한 경우에만 가능합니다.',
  INVALID_NOTICE: '공개 안내가 갱신되었습니다. 안내를 다시 확인해 주세요.',
  IDEMPOTENCY_CONFLICT: '같은 요청 키로 다른 내용이 전송되었습니다.',
  RATE_LIMITED: '짧은 시간에 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  SUBMISSIONS_DISABLED: '지금은 의견 등록을 받지 않습니다.',
  CONFIG_INCOMPLETE: '서비스 설정이 완료되지 않았습니다.',
  SERVICE_UNAVAILABLE: '일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  PUBLIC_DATA_LIMIT: '공개 데이터가 처리 한도를 넘었습니다.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
  FORBIDDEN: '담당자 권한이 없습니다.',
  NOT_FOUND: '의견을 찾을 수 없습니다.',
  INVALID_ID: '의견 번호가 올바르지 않습니다.',
  INVALID_QUERY: '조회 조건이 올바르지 않습니다.',
  INVALID_ACTION: '지원하지 않는 조치입니다.',
  INVALID_VERSION: '버전 정보가 올바르지 않습니다.',
  VERSION_CONFLICT: '다른 담당자가 먼저 변경했습니다. 최신 내용을 다시 불러와 주세요.',
  HIDE_BEFORE_EDIT: '공개 중인 요약은 먼저 숨긴 뒤 수정할 수 있습니다.',
  INVALID_SUMMARY: '요약은 공백만으로 만들 수 없고 250자 이하여야 합니다.',
  PUBLICATION_NOT_ALLOWED: '작성자가 지도 공개를 선택하고 요약이 저장된 의견만 공개할 수 있습니다.',
  PLAYER_NOT_ALLOWED: '작성자가 지도·플레이어 공개를 모두 선택한 의견만 상영에 포함할 수 있습니다.',
};

export function errorResponse(status: number, code: string, field?: string) {
  const error: { code: string; message: string; field?: string } = {
    code,
    message: MESSAGES[code] ?? MESSAGES.SERVICE_UNAVAILABLE,
  };
  if (field) error.field = field;
  return json({ error }, status);
}

export function fromHttpError(e: unknown) {
  if (e instanceof HttpError) return errorResponse(e.status, e.code, e.field);
  return errorResponse(503, 'SERVICE_UNAVAILABLE');
}

/** 같은 출처의 브라우저 요청만 허용한다. APP_ORIGIN이 없으면 안전하게 실패한다. */
export function assertSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new HttpError(503, 'CONFIG_INCOMPLETE');
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(expected).origin) throw new HttpError(403, 'CROSS_ORIGIN');
}

/** 본문을 최대 크기까지만 읽고 JSON 객체로 파싱한다. */
export async function readJsonObject(request: Request, max = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type)) throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) throw new HttpError(400, 'PAYLOAD_TOO_LARGE');
  if (!request.body) throw new HttpError(400, 'INVALID_JSON');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(400, 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'INVALID_BODY');
  return parsed as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** 경로·상태·소요시간·안전한 오류 코드만 기록한다. 본문·원문·좌표·키는 남기지 않는다. */
export function logRequest(route: string, status: number, startedAt: number, code?: string) {
  if (process.env.API_ACCESS_LOG !== 'on') return;
  console.info(JSON.stringify({ route, status, ms: Math.round(performance.now() - startedAt), code }));
}
