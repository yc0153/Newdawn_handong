'use client';
// 카카오 지도 SDK를 한 번만 불러온다. services(주소·장소 검색) 라이브러리를 함께 쓴다.
// 이 파일은 SDK에서 실제로 쓰는 부분만 최소한으로 타입을 적는다.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Kakao = any;

let pending: Promise<Kakao> | null = null;

export function loadKakao(appKey: string, sdkUrl: string, timeoutMs = 10_000): Promise<Kakao> {
  const w = window as unknown as { kakao?: Kakao };
  if (w.kakao?.maps?.LatLng) return Promise.resolve(w.kakao);
  if (pending) return pending;
  pending = new Promise<Kakao>((resolve, reject) => {
    const timer = setTimeout(() => { pending = null; reject(new Error('KAKAO_TIMEOUT')); }, timeoutMs);
    const script = document.createElement('script');
    const sep = sdkUrl.includes('?') ? '&' : '?';
    script.src = `${sdkUrl}${sep}appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
    script.async = true;
    script.onerror = () => { clearTimeout(timer); pending = null; script.remove(); reject(new Error('KAKAO_LOAD')); };
    script.onload = () => {
      const k = w.kakao;
      if (!k?.maps?.load) { clearTimeout(timer); pending = null; reject(new Error('KAKAO_LOAD')); return; }
      k.maps.load(() => { clearTimeout(timer); resolve(k); });
    };
    document.head.appendChild(script);
  });
  return pending;
}

/** Leaflet 확대 단계(높을수록 가까움) ↔ 카카오 지도 레벨(낮을수록 가까움). */
export const zoomToLevel = (zoom: number) => Math.min(14, Math.max(1, Math.round(20 - zoom)));
export const levelToZoom = (level: number) => 20 - level;
