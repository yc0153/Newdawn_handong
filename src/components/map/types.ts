import type { Category } from '@/lib/domain/types';
import type { MapProvider } from '@/lib/map/provider';

export type PinGroup = { key: string; lat: number; lon: number; count: number; category: Category; active: boolean; label: string };

export type MapProps = {
  provider: MapProvider | null;
  ariaLabel: string;
  groups?: PinGroup[];
  onPinSelect?: (key: string) => void;
  allowedCells?: { cell_x: number; cell_y: number }[];
  tag?: { lat: number; lon: number; label: string } | null;
  /** 클릭·Enter 위치. 받는 쪽은 서버에 격자 번호만 보내고, 원좌표는 화면 표시(핀)에만 쓴다. */
  onPick?: (lat: number, lon: number) => void;
  focus?: { lat: number; lon: number; zoom?: number; token: number } | null;
  fit?: 'allowed' | 'pins' | null;
  reducedMotion?: boolean;
  onTileStatus?: (status: 'ok' | 'failed') => void;
  reloadToken?: number;
  compact?: boolean;
};
