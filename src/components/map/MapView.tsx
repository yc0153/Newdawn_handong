'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { MapProps } from './types';

// 지도는 브라우저 전용이므로 서버 렌더링에서 제외한다.
const loading = () => <div className="leaflet-host leaflet-host--loading" aria-hidden="true" />;
const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false, loading });
const KakaoMap = dynamic(() => import('./KakaoMap'), { ssr: false, loading });

/** 카카오 키가 있으면 카카오 지도, 불러오기에 실패하면 타일 지도로 대신 보여준다. */
export default function MapView({ provider, ...rest }: MapProps) {
  const [kakaoFailed, setKakaoFailed] = useState(false);
  if (provider?.kind === 'kakao' && !kakaoFailed) {
    return <KakaoMap {...rest} provider={provider} onFail={() => setKakaoFailed(true)} />;
  }
  const tiles = provider?.kind === 'kakao' ? provider.fallback : provider;
  return <LeafletMap {...rest} provider={tiles ?? null} />;
}
