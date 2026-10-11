'use client';
import dynamic from 'next/dynamic';
import type { LeafletMapProps } from './LeafletMap';

// Leaflet은 브라우저 전용이므로 서버 렌더링에서 제외한다.
const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => <div className="leaflet-host leaflet-host--loading" aria-hidden="true" />,
});

export default function MapView(props: LeafletMapProps) {
  return <LeafletMap {...props} />;
}
