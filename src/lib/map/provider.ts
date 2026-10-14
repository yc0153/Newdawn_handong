// 지도 공급자 설정. 공급자는 환경 변수로만 주입한다.
// - 카카오 JavaScript 키가 있으면 카카오 지도(로드뷰·주소 검색 포함)를 쓴다.
//   카카오 SDK를 불러오지 못하면 타일 지도로 대신 보여준다.
// - 타일 지도: NEXT_PUBLIC_MAP_TILE_URL. 개발 서버(next dev)에서만 OSM 표준 타일을 개발용으로 쓴다.
// 운영 빌드에서 둘 다 없으면 지도 대신 목록과 안내를 보여준다(임의 공급자 사용 금지).
export type TileProvider = { kind: 'tiles'; url: string; attribution: string; maxZoom: number; dev: boolean };
export type KakaoProvider = { kind: 'kakao'; appKey: string; sdkUrl: string; fallback: TileProvider | null; dev: false };
export type MapProvider = TileProvider | KakaoProvider;

export function tileProvider(): TileProvider | null {
  const url = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION;
  if (url && attribution) return { kind: 'tiles', url, attribution, maxZoom: 19, dev: false };
  if (process.env.NODE_ENV === 'development') {
    return {
      kind: 'tiles',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      dev: true,
    };
  }
  return null;
}

export function mapProvider(): MapProvider | null {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim();
  if (appKey) {
    return {
      kind: 'kakao',
      appKey,
      sdkUrl: process.env.NEXT_PUBLIC_KAKAO_SDK_URL?.trim() || 'https://dapi.kakao.com/v2/maps/sdk.js',
      fallback: tileProvider(),
      dev: false,
    };
  }
  return tileProvider();
}

// 지도 초기 화면. 수집 지역이나 기본 등록 좌표가 아니라 처음 보여줄 화면 범위일 뿐이다.
export const INITIAL_VIEW = { lat: 36.04, lon: 129.365, zoom: 12 };
