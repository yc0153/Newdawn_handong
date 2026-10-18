// 데이터 저장소 선택. Supabase가 아직 없어도 PC 한 대에서 같은 API로 돌려 볼 수 있게 한다.
// - DATA_BACKEND=local    : 내장 Postgres(PGlite)를 .local-db 폴더에 두고 같은 SQL·RPC로 처리
// - DATA_BACKEND=supabase : 기존 Supabase 연결
// - 비워 두면: Supabase 주소가 없고 Vercel이 아닐 때만 local, 그 밖에는 supabase
export type BackendMode = 'supabase' | 'local';

type ModeEnv = Record<string, string | undefined>;

export function backendMode(env: ModeEnv = process.env): BackendMode {
  const v = env.DATA_BACKEND?.trim().toLowerCase();
  if (v === 'local') return 'local';
  if (v === 'supabase') return 'supabase';
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim() && !env.VERCEL) return 'local';
  return 'supabase';
}

export const isLocalBackend = (env: ModeEnv = process.env) => backendMode(env) === 'local';
