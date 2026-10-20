import 'server-only';
// Supabase 구현. 공개 경로는 서버 비밀키 RPC, 담당자 경로는 검증된 담당자 JWT client로만 실행한다.
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, UPSTREAM_TIMEOUT_MS } from '@/lib/api/http';
import { mapDbError } from '@/lib/api/db-errors';
import { ADMIN_COLUMNS, REVIEW_PIN_COLUMNS, toAudit, toReviewPin } from '@/lib/api/admin-dto';
import { createPublicRpcClient } from '@/lib/supabase/privileged';
import type { AdminAudit, PublicOpinion } from '@/lib/domain/types';
import { OVERVIEW_ROW_LIMIT, type AdminRow, type OperatorStore, type PublicStore, type RawConfig, type SubmitReceipt } from './types';

function client() {
  try { return createPublicRpcClient(); } catch { throw new HttpError(503, 'CONFIG_INCOMPLETE'); }
}

const signal = () => AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

/** RPC가 아직 DB에 없으면(새 SQL 미적용) 그 사실을 알린다. */
function missingFunction(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}
/** 표가 아직 DB에 없으면(새 SQL 미적용). */
function missingTable(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01');
}

export const supabasePublicStore: PublicStore = {
  async readPublicOpinions(mode) {
    const { data, error } = await client().rpc('read_public_opinions', { p_mode: mode }).abortSignal(signal());
    if (error || !data) throw mapDbError(error);
    return (data as { data: PublicOpinion[] }).data ?? [];
  },
  async readPublicConfig() {
    const { data, error } = await client().rpc('read_public_config').abortSignal(signal());
    if (error || !data) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    return data as RawConfig;
  },
  async submitOpinion(p) {
    const args = {
      p_request_key: p.request_key,
      p_fingerprint: p.fingerprint,
      p_key_hash: p.key_hash,
      p_grid_version: p.grid_version,
      p_cell_x: p.cell_x,
      p_cell_y: p.cell_y,
      p_category: p.category,
      p_language: p.language,
      p_original_text: p.original_text,
      p_allow_map: p.allow_map,
      p_allow_player: p.allow_player,
      p_notice_version: p.notice_version,
    };
    const call = (pin: boolean) => client().rpc('submit_opinion', pin ? { ...args, p_review_pin: p.review_pin } : args).abortSignal(signal());
    let { data, error } = await call(p.review_pin !== null);
    // 새 SQL(정확한 핀) 적용 전 DB: 예전 함수로 등록만 하고 핀은 저장하지 않는다.
    if (p.review_pin !== null && missingFunction(error)) ({ data, error } = await call(false));
    if (error || !data) throw mapDbError(error);
    return data as SubmitReceipt;
  },
  async rateEnv() {
    return process.env;
  },
};

export function supabaseOperatorStore(supabase: SupabaseClient, userId: string): OperatorStore {
  return {
    userId,
    async listOpinions({ status, page, pageSize }) {
      let query = supabase
        .from('opinions')
        .select(ADMIN_COLUMNS, { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)
        .abortSignal(signal());
      if (status !== 'all') query = query.eq('status', status);
      const { data, error, count } = await query;
      if (error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      return { rows: (data ?? []) as unknown as AdminRow[], total: count ?? 0 };
    },
    async getOpinion(id) {
      const s = signal();
      const row = await supabase
        .from('opinions')
        .select(ADMIN_COLUMNS + ',notice_version')
        .eq('id', id)
        .is('deleted_at', null)
        .abortSignal(s)
        .maybeSingle();
      if (row.error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      if (!row.data) return null;
      const audit = await supabase
        .from('admin_audit_logs')
        .select('actor_id,action,version,created_at')
        .eq('opinion_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .abortSignal(s);
      if (audit.error) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      const pin = await supabase.from('opinion_review_pins').select(REVIEW_PIN_COLUMNS).eq('opinion_id', id).abortSignal(s).maybeSingle();
      // 새 SQL 적용 전에는 표가 없다 → 핀 없음으로 본다.
      if (pin.error && !missingTable(pin.error)) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      return {
        row: row.data as unknown as AdminRow,
        audit: ((audit.data ?? []) as AdminAudit[]).map(toAudit),
        review_pin: pin.error ? null : toReviewPin(pin.data as Record<string, unknown> | null),
      };
    },
    async action(p) {
      const { data, error } = await supabase
        .rpc('admin_opinion_action', {
          p_id: p.id,
          p_expected_version: p.expected_version,
          p_action: p.action,
          p_summary: p.summary,
          p_include_in_player: p.include_in_player,
        })
        .abortSignal(signal());
      if (error || !data) throw mapDbError(error);
      return data as { id: string; status: string; version: number; deleted: boolean };
    },
    async overview() {
      const s = signal();
      // 건수는 행 상한과 관계없이 정확히 센다(head 요청은 행을 받지 않는다).
      const count = () => supabase.from('opinions').select('id', { count: 'exact', head: true }).is('deleted_at', null).abortSignal(s);
      const categories = ['transport', 'language', 'environment', 'other'];
      const [total, pending, published, hidden, inPlayer, waiting, rows, ...cats] = await Promise.all([
        count(),
        count().eq('status', 'pending'),
        count().eq('status', 'published'),
        count().eq('status', 'hidden'),
        count().eq('status', 'published').eq('include_in_player', true),
        count().eq('status', 'published').eq('allow_player', true).eq('include_in_player', false),
        supabase.from('opinions').select(ADMIN_COLUMNS).is('deleted_at', null)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(OVERVIEW_ROW_LIMIT).abortSignal(s),
        ...categories.map((c) => count().eq('category', c)),
      ]);
      const all = [total, pending, published, hidden, inPlayer, waiting, rows, ...cats];
      if (all.some((r) => r.error)) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
      return {
        counts: {
          total: total.count ?? 0, pending: pending.count ?? 0, published: published.count ?? 0, hidden: hidden.count ?? 0,
          in_player: inPlayer.count ?? 0, player_waiting: waiting.count ?? 0,
        },
        by_category: Object.fromEntries(categories.map((c, i) => [c, cats[i].count ?? 0])),
        rows: (rows.data ?? []) as unknown as AdminRow[],
      };
    },
    async setTestAutoPublish(enabled, hours) {
      const { data, error } = await supabase.rpc('admin_set_test_auto_publish', { p_enabled: enabled, p_hours: hours }).abortSignal(signal());
      if (missingFunction(error)) throw new HttpError(503, 'MIGRATION_REQUIRED');
      if (error || !data) throw mapDbError(error);
      const r = data as { test_auto_publish?: boolean; test_auto_publish_until?: string | null };
      return { enabled: Boolean(r.test_auto_publish), until: r.test_auto_publish_until ?? null };
    },
  };
}
