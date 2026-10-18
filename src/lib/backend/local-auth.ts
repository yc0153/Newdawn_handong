// 로컬 DB 모드의 담당자 로그인. Supabase Auth 대신 쓰며, 같은 규칙을 지킨다.
// - 비밀번호는 scrypt 해시로만 저장한다.
// - 세션은 서버 비밀값으로 서명한 쿠키(HttpOnly)이고, 요청마다 DB의 활성 담당자 명단을 다시 확인한다.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const LOCAL_SESSION_COOKIE = 'pom_local_admin';
export const LOCAL_SESSION_TTL_S = 8 * 60 * 60;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFC'), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isSafeInteger(x) && x > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(password.normalize('NFC'), salt, KEYLEN, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}

export type LocalSession = { sub: string; iat: number; exp: number };

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSession(sub: string, secret: string, nowS = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ sub, iat: nowS, exp: nowS + LOCAL_SESSION_TTL_S })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 서명·만료·형식을 확인한다. 실패하면 null. 권한은 호출한 쪽이 DB에서 다시 확인한다. */
export function verifySession(token: string | undefined, secret: string, nowS = Math.floor(Date.now() / 1000)): LocalSession | null {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(payload, secret), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<LocalSession>;
    if (typeof s.sub !== 'string' || !UUID.test(s.sub)) return null;
    if (typeof s.iat !== 'number' || typeof s.exp !== 'number') return null;
    if (s.exp <= nowS || s.iat > nowS + 60) return null;
    return { sub: s.sub, iat: s.iat, exp: s.exp };
  } catch {
    return null;
  }
}
