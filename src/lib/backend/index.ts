import 'server-only';
import { backendMode } from './mode';
import type { PublicStore } from './types';

export { backendMode, isLocalBackend } from './mode';
export type * from './types';

/** 공개 화면·의견 등록이 쓰는 저장소. 로컬 DB 코드는 로컬 모드에서만 불러온다. */
export async function publicStore(): Promise<PublicStore> {
  if (backendMode() === 'local') return (await import('./local')).localPublicStore;
  return (await import('./supabase')).supabasePublicStore;
}
