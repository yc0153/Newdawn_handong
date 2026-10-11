import { redirect } from 'next/navigation';

// 기존 시연 경로(?view=...)를 정규 경로로 연결한다. 기본 목적지는 공개 지도다.
const VIEWS: Record<string, string> = { browse: '/map', place: '/submit', player: '/player' };

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { view } = await searchParams;
  const target = typeof view === 'string' && VIEWS[view] ? VIEWS[view] : '/map';
  redirect(target);
}
