import 'server-only';
// 로컬 DB(PGlite) 구현. Supabase 구현과 같은 RPC·같은 권한 역할로 호출한다.
import { HttpError } from '@/lib/api/http';
import { mapDbError } from '@/lib/api/db-errors';
import type { AdminAudit, PublicOpinion } from '@/lib/domain/types';
import { asAuthServer, asRole, getLocalDb } from './local-db';
import { verifyPassword } from './local-auth';
import type { AdminRow, OperatorStore, PublicStore, RawConfig, SubmitParams, SubmitReceipt } from './types';

const ADMIN_SELECT =
  'id, category, language, public_lat, public_lon, original_text, allow_map, allow_player, summary, status, include_in_player, version, created_at';

function dbError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const err = e as { message?: string; code?: string };
  return mapDbError({ message: err?.message, code: err?.code });
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw dbError(e);
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toRow(r: Record<string, unknown>): AdminRow {
  return { ...(r as AdminRow), created_at: iso(r.created_at) };
}

export const localPublicStore: PublicStore = {
  readPublicOpinions: (mode) => guard(async () => {
    const r = await asRole('service_role', null, (tx) =>
      tx.query<{ result: { data: PublicOpinion[] } }>('select public.read_public_opinions($1) as result', [mode]));
    return r.rows[0]?.result?.data ?? [];
  }),
  readPublicConfig: () => guard(async () => {
    const r = await asRole('service_role', null, (tx) => tx.query<{ result: RawConfig }>('select public.read_public_config() as result'));
    if (!r.rows[0]?.result) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    return r.rows[0].result;
  }),
  submitOpinion: (p: SubmitParams) => guard(async () => {
    const r = await asRole('service_role', null, (tx) => tx.query<{ result: SubmitReceipt }>(
      'select public.submit_opinion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result',
      [p.request_key, p.fingerprint, p.key_hash, p.grid_version, p.cell_x, p.cell_y, p.category, p.language,
        p.original_text, p.allow_map, p.allow_player, p.notice_version]));
    if (!r.rows[0]?.result) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    return r.rows[0].result;
  }),
  rateEnv: async () => {
    const { secret } = await getLocalDb();
    const own = process.env.RATE_LIMIT_HMAC_SECRET;
    // 로컬 DB는 PC 한 대에서 돌리는 개발·시연용이다. 신뢰 IP 헤더가 없으면 모든 요청이 한 버킷을 공유한다.
    return {
      NODE_ENV: 'development',
      RATE_LIMIT_HMAC_SECRET: own && own.length >= 32 ? own : secret,
      TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER,
    };
  },
};

export function localOperatorStore(userId: string): OperatorStore {
  const as = <T>(fn: Parameters<typeof asRole<T>>[2]) => asRole<T>('authenticated', userId, fn);
  return {
    userId,
    listOpinions: ({ status, page, pageSize }) => guard(async () => {
      const where = status === 'all' ? 'deleted_at is null' : 'deleted_at is null and status = $3';
      const params: unknown[] = [pageSize, (page - 1) * pageSize];
      if (status !== 'all') params.push(status);
      return as(async (tx) => {
        const rows = await tx.query<Record<string, unknown>>(
          `select ${ADMIN_SELECT} from public.opinions where ${where} order by created_at desc, id desc limit $1 offset $2`, params);
        const count = await tx.query<{ n: number }>(
          `select count(*)::int as n from public.opinions where ${status === 'all' ? 'deleted_at is null' : 'deleted_at is null and status = $1'}`,
          status === 'all' ? [] : [status]);
        return { rows: rows.rows.map(toRow), total: count.rows[0]?.n ?? 0 };
      });
    }),
    getOpinion: (id) => guard(async () => as(async (tx) => {
      const row = await tx.query<Record<string, unknown>>(
        `select ${ADMIN_SELECT}, notice_version from public.opinions where id = $1 and deleted_at is null`, [id]);
      if (!row.rows[0]) return null;
      const audit = await tx.query<Record<string, unknown>>(
        'select actor_id, action, version, created_at from public.admin_audit_logs where opinion_id = $1 order by created_at, id', [id]);
      return {
        row: toRow(row.rows[0]),
        audit: audit.rows.map((a) => ({ ...(a as AdminAudit), created_at: iso(a.created_at) })),
      };
    })),
    action: (p) => guard(async () => {
      const r = await as((tx) => tx.query<{ result: { id: string; status: string; version: number; deleted: boolean } }>(
        'select public.admin_opinion_action($1,$2,$3,$4,$5) as result',
        [p.id, p.expected_version, p.action, p.summary, p.include_in_player]));
      if (!r.rows[0]?.result) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      return r.rows[0].result;
    }),
    setTestAutoPublish: (enabled) => guard(async () => {
      const r = await as((tx) => tx.query<{ result: { test_auto_publish: boolean } }>(
        'select public.admin_set_test_auto_publish($1) as result', [enabled]));
      return Boolean(r.rows[0]?.result?.test_auto_publish);
    }),
  };
}

/** 활성 담당자인지 RLS가 걸린 담당자 역할로 다시 확인한다(Supabase와 같은 방식). */
export async function localMembershipActive(userId: string): Promise<boolean> {
  return guard(async () => {
    const r = await asRole('authenticated', userId, (tx) =>
      tx.query<{ active: boolean }>('select active from public.operator_memberships where user_id = $1', [userId]));
    return Boolean(r.rows[0]?.active);
  });
}

/** 세션이 발급된 뒤 비밀번호가 바뀌었거나 계정이 지워졌으면 세션을 받지 않는다. */
export async function localAccountValid(userId: string, issuedAtS: number): Promise<boolean> {
  return guard(async () => {
    const r = await asAuthServer((tx) => tx.query<{ updated_at: Date | string }>(
      'select updated_at from local_app.accounts where user_id = $1', [userId]));
    const row = r.rows[0];
    if (!row) return false;
    return Math.floor(new Date(row.updated_at).getTime() / 1000) <= issuedAtS;
  });
}

/** 이메일·비밀번호 확인. 성공하면 user id. 계정이 없을 때도 같은 시간이 걸리도록 해시를 계산한다. */
export async function localSignIn(email: string, password: string): Promise<string | null> {
  const row = await guard(async () => {
    const r = await asAuthServer((tx) => tx.query<{ user_id: string; password_hash: string }>(
      'select user_id, password_hash from local_app.accounts where email = $1', [email.trim().toLowerCase()]));
    return r.rows[0] ?? null;
  });
  const ok = verifyPassword(password, row?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  return row && ok ? row.user_id : null;
}
