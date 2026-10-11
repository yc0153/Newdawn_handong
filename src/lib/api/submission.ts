import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { Submission } from '@/lib/domain/validation';
import { HttpError } from './http';

/** 검증·정규화된 허용 필드의 정렬된 JSON을 해시한다. 같은 키의 다른 내용 판별에 사용한다. */
export function fingerprint(s: Submission): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b))));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type RateEnv = {
  NODE_ENV?: string;
  RATE_LIMIT_HMAC_SECRET?: string;
  TRUSTED_CLIENT_IP_HEADER?: string;
};

/**
 * 배포 플랫폼이 보장하는 헤더 하나에서만 클라이언트 IP를 읽는다.
 * 임의 X-Forwarded-For 첫 값은 신뢰하지 않는다. 운영에서 설정이 없으면 등록을 열지 않는다.
 * 원 IP는 저장하지 않고 일 단위로 바뀌는 HMAC만 DB에 보낸다.
 */
export function rateKeyHash(headers: Headers, env: RateEnv, now = new Date()): string {
  const secret = env.RATE_LIMIT_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, 'CONFIG_INCOMPLETE');
  const day = now.toISOString().slice(0, 10);
  const header = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  let client: string;
  if (header) {
    const raw = headers.get(header)?.trim() ?? '';
    // 플랫폼 헤더가 목록 형태이면 플랫폼이 붙인 마지막 값을 사용한다.
    const candidate = raw.includes(',') ? raw.split(',').at(-1)!.trim() : raw;
    if (!isIP(candidate)) throw new HttpError(503, 'CONFIG_INCOMPLETE');
    client = candidate;
  } else if (env.NODE_ENV !== 'production') {
    // 로컬 개발: 모든 요청이 하나의 버킷을 공유한다. 운영으로 승격되지 않는다.
    client = 'local-development';
  } else {
    throw new HttpError(503, 'CONFIG_INCOMPLETE');
  }
  return createHmac('sha256', secret).update(`${day}|${client}`).digest('hex');
}

/** 등록이 가능한 서버 설정인지(빈도 제한 키를 만들 수 있는지) 확인한다. */
export function serverReadyForSubmissions(env: RateEnv): boolean {
  if (!env.RATE_LIMIT_HMAC_SECRET || env.RATE_LIMIT_HMAC_SECRET.length < 32) return false;
  if (env.NODE_ENV === 'production' && !env.TRUSTED_CLIENT_IP_HEADER?.trim()) return false;
  return true;
}
