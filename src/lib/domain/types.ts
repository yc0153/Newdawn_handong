import type { CATEGORIES, LANGUAGES } from './validation';

export type Category = typeof CATEGORIES[number];
export type Language = typeof LANGUAGES[number];

/** 공개 응답 1건. 이 4종 외의 필드는 공개 경로에 존재하지 않는다. */
export type PublicOpinion = {
  public_id: string;
  category: Category;
  location: { lat: number; lon: number };
  summary: string;
};

export type PublicConfig = {
  grid_version: 'pohang-v1';
  notice_version: string;
  submissions_enabled: boolean;
  allowed_cells: { cell_x: number; cell_y: number }[];
  /** 테스트 모드: 켜져 있으면 지도 공개를 고른 새 의견이 담당자 검토 없이 바로 공개된다. */
  test_auto_publish?: boolean;
};

export type ReviewStatus = 'pending' | 'published' | 'hidden';

export type AdminOpinion = {
  id: string;
  category: Category;
  language: Language;
  location: { lat: number; lon: number };
  original_text: string;
  allow_map: boolean;
  allow_player: boolean;
  summary: string | null;
  status: ReviewStatus;
  include_in_player: boolean;
  version: number;
  created_at: string;
};

export type AdminAudit = {
  actor_id: string;
  action: 'save_summary' | 'publish' | 'hide' | 'set_player' | 'delete' | 'auto_publish';
  version: number;
  created_at: string;
};

export type AdminDetail = AdminOpinion & { notice_version: string; audit_logs: AdminAudit[] };

export type ApiError = { error: { code: string; message: string; field?: string } };
