// 지도 공급자 어댑터 설정. 공급자는 학교와 확정 전이므로 환경 변수로만 주입한다.
// 개발 서버(next dev)에서만 OSM 표준 타일을 개발용으로 사용하고, 화면에 개발용임을 표시한다.
// 운영 빌드에서 설정이 없으면 지도 대신 목록과 안내를 보여준다(임의 공급자 사용 금지).
export type MapProvider = { url: string; attribution: string; maxZoom: number; dev: boolean };

export function mapProvider(): MapProvider | null {
  const url = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION;
  if (url && attribution) return { url, attribution, maxZoom: 19, dev: false };
  if (process.env.NODE_ENV === 'development') {
    return {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      dev: true,
    };
  }
  return null;
}

// 지도 초기 화면. 수집 지역이나 기본 등록 좌표가 아니라 처음 보여줄 화면 범위일 뿐이다.
export const INITIAL_VIEW = { lat: 36.04, lon: 129.365, zoom: 12 };
