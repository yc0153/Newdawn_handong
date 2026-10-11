import type { AdminAudit, Category, Language, ReviewStatus } from '@/lib/domain/types';

export const CATEGORY_LABEL: Record<Category, string> = {
  transport: '교통·이동',
  language: '안내·언어',
  environment: '시설·생활환경',
  other: '기타',
};
export const LANGUAGE_LABEL: Record<Language, string> = { ko: '한국어', en: '영어', other: '기타 언어' };
export const STATUS_LABEL: Record<ReviewStatus, string> = { pending: '검토 대기', published: '공개', hidden: '숨김' };
export const ACTION_LABEL: Record<AdminAudit['action'], string> = {
  save_summary: '요약 저장',
  publish: '공개',
  hide: '숨김',
  set_player: '상영 포함 변경',
  delete: '삭제',
};

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(iso));
}
