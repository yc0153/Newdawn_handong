'use client';
// 카카오 주소·장소 검색 도우미. 브라우저에서 카카오로 직접 요청하며 우리 서버로는 보내지 않는다.
// 결과 좌표는 장소를 고르고 로드뷰를 여는 데만 쓰고, 저장은 약 200m 칸 번호로만 한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Kakao } from './kakao';

export type AddressItem = {
  id: string;
  name?: string;
  road?: string;
  jibun?: string;
  zip?: string;
  lat: number;
  lon: number;
};

const OK = (k: Kakao) => k.maps.services.Status.OK;
const M_PER_DEG_LAT = 111_320;

function coord2Address(k: Kakao, geocoder: any, lat: number, lon: number): Promise<any | null> {
  return new Promise((resolve) => {
    geocoder.coord2Address(lon, lat, (result: any[], status: string) => resolve(status === OK(k) && result?.[0] ? result[0] : null));
  });
}

function toItem(r: any, lat: number, lon: number, name?: string): AddressItem | null {
  const road = r?.road_address?.address_name || undefined;
  const jibun = r?.address?.address_name || undefined;
  if (!road && !jibun) return null;
  const building = r?.road_address?.building_name || undefined;
  return { id: road || jibun, name: name ?? building, road, jibun, zip: r?.road_address?.zone_no || undefined, lat, lon };
}

/** 누른 곳 둘레 몇 군데의 주소를 모아 가까운 순서로 돌려준다(도로명·지번·우편번호). */
export async function nearbyAddresses(k: Kakao, lat: number, lon: number, step = 60): Promise<AddressItem[]> {
  const geocoder = new k.maps.services.Geocoder();
  const dLat = step / M_PER_DEG_LAT;
  const dLon = step / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const offsets: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const found = await Promise.all(offsets.map(async ([dy, dx]) => {
    const pLat = lat + dy * dLat, pLon = lon + dx * dLon;
    const r = await coord2Address(k, geocoder, pLat, pLon);
    return r ? { item: toItem(r, pLat, pLon), dist: Math.hypot(dy, dx) } : null;
  }));
  const seen = new Map<string, { item: AddressItem; dist: number }>();
  for (const f of found) {
    if (!f?.item) continue;
    const prev = seen.get(f.item.id);
    if (!prev || f.dist < prev.dist) seen.set(f.item.id, { item: f.item, dist: f.dist });
  }
  return [...seen.values()].sort((a, b) => a.dist - b.dist).map((v) => v.item);
}

/** 주소 검색 + 장소 이름 검색. rect는 'minLon,minLat,maxLon,maxLat' (포항 범위로 좁힌다). */
export async function searchAddresses(k: Kakao, query: string, rect?: string): Promise<AddressItem[]> {
  const q = query.trim();
  if (!q) return [];
  const geocoder = new k.maps.services.Geocoder();
  const places = new k.maps.services.Places();
  const addrs = new Promise<AddressItem[]>((resolve) => {
    geocoder.addressSearch(q, (result: any[], status: string) => {
      if (status !== OK(k)) return resolve([]);
      resolve(result.map((r) => toItem(r, Number(r.y), Number(r.x))).filter((x): x is AddressItem => !!x));
    }, { size: 10 });
  });
  const named = new Promise<AddressItem[]>((resolve) => {
    places.keywordSearch(q, async (result: any[], status: string) => {
      if (status !== OK(k)) return resolve([]);
      const top = result.slice(0, 10);
      // 장소 결과에는 우편번호가 없어 좌표로 한 번 더 찾는다.
      const filled = await Promise.all(top.map(async (p) => {
        const lat = Number(p.y), lon = Number(p.x);
        const r = await coord2Address(k, geocoder, lat, lon);
        const base = r ? toItem(r, lat, lon, p.place_name) : null;
        return base ?? { id: p.id ?? p.place_name, name: p.place_name, road: p.road_address_name || undefined, jibun: p.address_name || undefined, lat, lon };
      }));
      resolve(filled.map((it, i) => ({ ...it, id: `place-${top[i].id ?? i}`, name: top[i].place_name })));
    }, rect ? { rect, size: 15 } : { size: 15 });
  });
  const [a, b] = await Promise.all([addrs, named]);
  const seen = new Set<string>();
  return [...a, ...b].filter((it) => { const key = `${it.name ?? ''}|${it.road ?? it.jibun}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
