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
  /** DB가 담당자 검토용 정확한 핀(review_pin)을 저장할 수 있으면 true. 그때만 브라우저가 핀을 보낸다. */
  review_pin?: boolean;
};

/**
 * 담당자 검토용 로드뷰 핀: 글쓴이가 로드뷰에서 핀을 꽂은 방향과 그때 보던 시점.
 * 사진이 아니라 카카오 로드뷰를 같은 자리·같은 시점으로 다시 여는 데 쓴다.
 */
export type ReviewRoadview = { pano_id: number; pin_pan: number; pin_tilt: number; view_pan: number; view_tilt: number; view_zoom: number };
/**
 * 담당자 검토용 정확한 핀(고른 약 200m 칸 안의 좌표 + 있으면 로드뷰 핀).
 * 담당자 상세 화면에서만 읽는다. 공개 API·플레이어·목록·로그에는 넣지 않고, 의견을 삭제하면 함께 지운다.
 */
export type ReviewPin = { lat: number; lon: number; roadview: ReviewRoadview | null };

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

export type AdminDetail = AdminOpinion & { notice_version: string; audit_logs: AdminAudit[]; review_pin: ReviewPin | null };

export type ApiError = { error: { code: string; message: string; field?: string } };
