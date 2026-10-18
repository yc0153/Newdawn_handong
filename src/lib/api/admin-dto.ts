import type { AdminAudit, AdminOpinion } from '@/lib/domain/types';

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
