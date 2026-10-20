import type { AdminAudit, AdminOpinion, ReviewPin } from '@/lib/domain/types';

// 관리자 화면에 필요한 열만 고른다. 요청 키·지문·빈도 제한 키는 관리자에게도 보내지 않는다.
export const ADMIN_COLUMNS =
  'id,category,language,public_lat,public_lon,original_text,allow_map,allow_player,summary,status,include_in_player,version,created_at';

export type AdminRowInput = Omit<AdminOpinion, 'location'> & { public_lat: number; public_lon: number };

export function toAdminOpinion(r: AdminRowInput): AdminOpinion {
  return {
    id: r.id,
    category: r.category,
    language: r.language,
    location: { lat: r.public_lat, lon: r.public_lon },
    original_text: r.original_text,
    allow_map: r.allow_map,
    allow_player: r.allow_player,
    summary: r.summary,
    status: r.status,
    include_in_player: r.include_in_player,
    version: r.version,
    created_at: r.created_at,
  };
}

/** 담당자 검토용 핀 표의 열. 상세 화면에서만 읽는다. */
export const REVIEW_PIN_COLUMNS = 'lat,lon,pano_id,pin_pan,pin_tilt,view_pan,view_tilt,view_zoom';

/** DB 행 → 핀. 로드뷰 값이 하나라도 없으면 지도 핀만 돌려준다. bigint는 문자열로 올 수 있어 숫자로 바꾼다. */
export function toReviewPin(r: Record<string, unknown> | null | undefined): ReviewPin | null {
  if (!r) return null;
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const lat = n(r.lat), lon = n(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rv = { pano_id: n(r.pano_id), pin_pan: n(r.pin_pan), pin_tilt: n(r.pin_tilt), view_pan: n(r.view_pan), view_tilt: n(r.view_tilt), view_zoom: n(r.view_zoom) };
  return { lat, lon, roadview: Object.values(rv).every(Number.isFinite) ? rv : null };
}

export function toAudit(r: AdminAudit): AdminAudit {
  return { actor_id: r.actor_id, action: r.action, version: r.version, created_at: r.created_at };
}

export type AdminActionInput =
  | { action: 'save_summary'; expected_version: number; summary: string }
  | { action: 'publish' | 'hide' | 'delete'; expected_version: number }
  | { action: 'set_player'; expected_version: number; include_in_player: boolean };

export class AdminInputError extends Error {
  constructor(public code: string, public field?: string) { super(code); }
}

/** action별 허용 필드만 받는다. */
export function parseAdminAction(body: Record<string, unknown>): AdminActionInput {
  const action = body.action;
  const allowed: Record<string, string[]> = {
    save_summary: ['action', 'expected_version', 'summary'],
    publish: ['action', 'expected_version'],
    hide: ['action', 'expected_version'],
    delete: ['action', 'expected_version'],
    set_player: ['action', 'expected_version', 'include_in_player'],
  };
  if (typeof action !== 'string' || !(action in allowed)) throw new AdminInputError('INVALID_ACTION', 'action');
  const keys = allowed[action];
  if (Object.keys(body).some((k) => !keys.includes(k)) || keys.some((k) => !(k in body))) {
    throw new AdminInputError('INVALID_FIELDS');
  }
  const v = body.expected_version;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new AdminInputError('INVALID_VERSION', 'expected_version');
  if (action === 'save_summary') {
    if (typeof body.summary !== 'string') throw new AdminInputError('INVALID_SUMMARY', 'summary');
    return { action, expected_version: v, summary: body.summary };
  }
  if (action === 'set_player') {
    if (typeof body.include_in_player !== 'boolean') throw new AdminInputError('INVALID_FIELDS', 'include_in_player');
    return { action, expected_version: v, include_in_player: body.include_in_player };
  }
  return { action: action as 'publish' | 'hide' | 'delete', expected_version: v };
}
