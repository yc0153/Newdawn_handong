import type { Metadata } from 'next';
import PlayerView from '@/components/PlayerView';

export const metadata: Metadata = { title: '현황 상영' };

export default function PlayerPage() {
  return <PlayerView />;
}
