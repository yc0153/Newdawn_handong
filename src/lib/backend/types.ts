// 저장소 경계. Supabase와 로컬 DB(PGlite)가 같은 모양으로 구현한다.
// 실패는 HttpError(안전한 코드)로 던진다. SQL·원문은 오류에 넣지 않는다.
import type { RateEnv } from '@/lib/api/submission';
import type { AdminAudit, PublicConfig, PublicOpinion } from '@/lib/domain/types';

export type SubmitParams = {
  request_key: string;
  fingerprint: string;
  key_hash: string;
  grid_version: string;
  cell_x: number;
  cell_y: number;
  category: string;
  language: string;
  original_text: string;
  allow_map: boolean;
  allow_player: boolean;
  notice_version: string;
};

/** published는 테스트 모드 자동 공개가 켜진 DB에서만 true가 될 수 있다. */
export type SubmitReceipt = { reference: string; created: boolean; published?: boolean };

export type RawConfig = Partial<PublicConfig> & { test_auto_publish?: boolean };

export interface PublicStore {
  readPublicOpinions(mode: 'browse' | 'player'): Promise<PublicOpinion[]>;
  readPublicConfig(): Promise<RawConfig>;
  submitOpinion(p: SubmitParams): Promise<SubmitReceipt>;
  /** 빈도 제한 키를 만들 때 쓰는 설정. 로컬 DB는 비밀값이 없으면 DB에 둔 값을 쓴다. */
  rateEnv(): Promise<RateEnv>;
}

export type AdminRow = {
  id: string;
  category: string;
  language: string;
  public_lat: number;
  public_lon: number;
  original_text: string;
  allow_map: boolean;
  allow_player: boolean;
  summary: string | null;
  status: string;
  include_in_player: boolean;
  version: number;
  created_at: string;
  notice_version?: string;
};

export type AdminActionParams = {
  id: string;
  expected_version: number;
  action: string;
  summary: string | null;
  include_in_player: boolean | null;
};

export type AdminActionResult = { id: string; status: string; version: number; deleted: boolean };

export interface OperatorStore {
  userId: string;
  listOpinions(q: { status: string; page: number; pageSize: number }): Promise<{ rows: AdminRow[]; total: number }>;
  getOpinion(id: string): Promise<{ row: AdminRow; audit: AdminAudit[] } | null>;
  action(p: AdminActionParams): Promise<AdminActionResult>;
  setTestAutoPublish(enabled: boolean): Promise<boolean>;
}
