import 'server-only';
// 로컬 DB 모드: 내장 Postgres(PGlite, WASM)를 프로젝트 폴더의 .local-db에 둔다.
// Supabase와 같은 supabase/migrations SQL을 그대로 적용하므로 RPC·RLS·트리거·제약이 같다.
// Supabase에만 있는 것(역할 anon/authenticated/service_role, auth.users, auth.uid())은 최소한으로 흉내 낸다.
// 한 프로세스만 이 폴더를 열 수 있다(.local-db/server.lock, 10초마다 갱신).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { hashPassword, verifyPassword } from './local-auth';

export type LocalDb = { db: PGlite; secret: string; dir: string | null };
type Role = 'service_role' | 'authenticated' | 'anon';

const STATE = Symbol.for('pohang-opinion-map.local-db');
type State = {
  ready?: Promise<LocalDb>;
  queue: Promise<unknown>;
  /** 열기에 실패하면 잠깐 같은 오류를 돌려줘 요청마다 DB를 다시 만들지 않는다. */
  failure?: { at: number; error: Error };
  heartbeat?: ReturnType<typeof setInterval>;
  exitHook?: boolean;
};
function state(): State {
  const g = globalThis as typeof globalThis & { [STATE]?: State };
  if (!g[STATE]) g[STATE] = { queue: Promise.resolve() };
  return g[STATE];
}

export const DEFAULT_LOCAL_ADMIN_EMAIL = 'admin@local.test';
const ACCOUNT_FILE = 'admin-account.txt';
const LOCK_FILE = 'server.lock';
const LOCK_REFRESH_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 5_000;
/** 한 작업(트랜잭션)이 이보다 오래 걸리면 기다리던 요청에 503을 돌려준다(Supabase 경로의 10초와 비슷하게). */
export const LOCAL_JOB_TIMEOUT_MS = 15_000;

function isMemory(raw: string) {
  return raw === 'memory://' || raw === ':memory:';
}

/** LOCAL_DB_DIR(기본 .local-db). memory:// 이면 저장하지 않는 임시 DB(테스트용). */
export function localDbLocation(env = process.env): string | null {
  const raw = env.LOCAL_DB_DIR?.trim() || '.local-db';
  return isMemory(raw) ? null : path.resolve(/* turbopackIgnore: true */ process.cwd(), raw);
}

function projectFile(...parts: string[]) {
  return path.join(/* turbopackIgnore: true */ process.env.LOCAL_PROJECT_ROOT?.trim() || process.cwd(), ...parts);
}

const BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text unique, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
create schema if not exists local_app;
revoke all on schema local_app from public;
create table if not exists local_app.meta(key text primary key, value text not null);
create table if not exists local_app.migrations(name text primary key, applied_at timestamptz not null default now());
create table if not exists local_app.accounts(
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
`;

/**
 * 폴더 잠금. 서버가 켜져 있는 동안 10초마다 잠금 파일 시각을 갱신한다.
 * 다른 프로세스의 잠금이 30초 안에 갱신됐으면 열지 않는다. 창을 닫아 남은 잠금은 30초 뒤 자동으로 무시된다
 * (pid 재사용으로 엉뚱한 프로세스를 '살아 있음'으로 보지 않도록 pid 대신 갱신 시각을 본다).
 */
function claimFolder(dir: string) {
  const file = path.join(dir, LOCK_FILE);
  if (existsSync(file)) {
    let owner = NaN;
    try { owner = Number(JSON.parse(readFileSync(file, 'utf8')).pid); } catch { /* 깨진 잠금은 무시 */ }
    const fresh = Date.now() - statSync(file).mtimeMs < LOCK_STALE_MS;
    if (owner !== process.pid && fresh) {
      throw new Error(`LOCAL_DB_BUSY: 다른 서버가 ${dir}를 쓰고 있습니다. 먼저 켠 서버 창을 닫고 30초 뒤 다시 실행하세요.`);
    }
  }
  const write = () => { try { writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch { /* ignore */ } };
  write();
  const s = state();
  if (s.heartbeat) clearInterval(s.heartbeat);
  s.heartbeat = setInterval(write, LOCK_REFRESH_MS);
  s.heartbeat.unref?.();
  if (!s.exitHook) {
    s.exitHook = true;
    process.once('exit', () => { const d = localDbLocation(); if (d) releaseFolder(d); });
  }
}

function releaseFolder(dir: string) {
  const s = state();
  if (s.heartbeat) { clearInterval(s.heartbeat); s.heartbeat = undefined; }
  try {
    const file = path.join(dir, LOCK_FILE);
    if (existsSync(file) && Number(JSON.parse(readFileSync(file, 'utf8')).pid) === process.pid) rmSync(file, { force: true });
  } catch { /* ignore */ }
}

async function meta(db: PGlite | Transaction, key: string) {
  const r = await db.query<{ value: string }>('select value from local_app.meta where key = $1', [key]);
  return r.rows[0]?.value ?? null;
}
async function setMeta(db: PGlite | Transaction, key: string, value: string) {
  await db.query('insert into local_app.meta(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, value]);
}

/** 파일 맨 앞·뒤의 begin; / commit; 줄을 걷어 내고, 적용 기록과 함께 한 트랜잭션으로 실행한다. */
export function wrapMigration(sql: string, name: string): string {
  const body = sql.replace(/^\s*begin\s*;\s*$/im, '').replace(/^\s*commit\s*;\s*$(?![\s\S]*^\s*commit\s*;)/im, '');
  const quoted = name.replace(/'/g, "''");
  return `begin;\n${body}\ninsert into local_app.migrations(name) values ('${quoted}');\ncommit;`;
}

async function migrate(db: PGlite) {
  const dir = projectFile('supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('select name from local_app.migrations')).rows.map((r) => r.name));
  for (const name of files) {
    if (done.has(name)) continue;
    try {
      await db.exec(wrapMigration(readFileSync(path.join(dir, name), 'utf8'), name));
    } catch (e) {
      await db.exec('rollback').catch(() => undefined);
      throw new Error(`LOCAL_DB_MIGRATION_FAILED: ${name}: ${(e as Error).message}`);
    }
  }
}

/** 처음 한 번만: 테스트 배포와 같은 포항시 전체 격자를 열고 등록을 켠다. */
async function ensureArea(db: PGlite) {
  if (await meta(db, 'area')) return;
  const count = (await db.query<{ n: number }>('select count(*)::int as n from public.allowed_cells')).rows[0].n;
  if (count === 0) {
    try {
      await db.exec(readFileSync(projectFile('supabase', 'dev', 'pohang_whole_city.sql'), 'utf8'));
    } catch (e) {
      await db.exec('rollback').catch(() => undefined);
      throw new Error(`LOCAL_DB_AREA_FAILED: ${(e as Error).message}`);
    }
  }
  await db.exec('update public.service_settings set submissions_enabled = true where singleton');
  await setMeta(db, 'area', 'pohang_whole_city');
}

async function ensureSecret(db: PGlite) {
  let secret = await meta(db, 'secret');
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    await setMeta(db, 'secret', secret);
  }
  return secret;
}

/** 담당자 계정 한 개를 보장한다. LOCAL_ADMIN_PASSWORD가 있으면 그 값으로 맞추고, 없으면 처음에 만들어 파일로 알려 준다. */
function adminEnv(env = process.env) {
  const email = (env.LOCAL_ADMIN_EMAIL?.trim() || DEFAULT_LOCAL_ADMIN_EMAIL).toLowerCase();
  const wanted = env.LOCAL_ADMIN_PASSWORD ?? '';
  if (wanted && wanted.length < 8) throw new Error('LOCAL_ADMIN_PASSWORD는 8자 이상이어야 합니다.');
  return { email, wanted };
}

async function ensureOperator(db: PGlite, dir: string | null) {
  const { email, wanted } = adminEnv();
  const existing = (await db.query<{ user_id: string; password_hash: string }>(
    'select user_id, password_hash from local_app.accounts where email = $1', [email])).rows[0];
  let userId = existing?.user_id;
  let created = false;
  if (wanted) {
    if (!existing) {
      created = true;
      userId = randomUUID();
      await db.query('insert into auth.users(id, email) values ($1, $2)', [userId, email]);
      await db.query('insert into local_app.accounts(user_id, email, password_hash) values ($1, $2, $3)', [userId, email, hashPassword(wanted)]);
    } else if (!verifyPassword(wanted, existing.password_hash)) {
      await db.query('update local_app.accounts set password_hash = $2, updated_at = now() where user_id = $1', [userId, hashPassword(wanted)]);
    }
  } else if (!existing) {
    const hasAccount = (await db.query('select 1 from local_app.accounts limit 1')).rows.length > 0;
    if (hasAccount) return;
    const password = randomBytes(9).toString('base64url');
    created = true;
    userId = randomUUID();
    await db.query('insert into auth.users(id, email) values ($1, $2)', [userId, email]);
    await db.query('insert into local_app.accounts(user_id, email, password_hash) values ($1, $2, $3)', [userId, email, hashPassword(password)]);
    if (dir) {
      writeFileSync(path.join(dir, ACCOUNT_FILE),
        `로컬 DB 담당자 계정 (이 PC에서만 쓰는 테스트 계정)\r\n주소: /admin/login\r\n이메일: ${email}\r\n비밀번호: ${password}\r\n` +
        `바꾸려면 .env.local에 LOCAL_ADMIN_EMAIL / LOCAL_ADMIN_PASSWORD를 넣고 서버를 다시 켜세요.\r\n`);
      console.info(`[로컬 DB] 담당자 계정을 만들었습니다. 로그인 정보: ${path.join(dir, ACCOUNT_FILE)}`);
    }
  }
  // 새로 만든 계정만 활성 담당자로 넣는다. 이미 있는 계정의 활성 여부(DB에서 끈 것 포함)는 건드리지 않는다.
  if (userId && created) {
    await db.query('insert into public.operator_memberships(user_id, active) values ($1, true) on conflict (user_id) do nothing', [userId]);
  }
}

async function open(): Promise<LocalDb> {
  if (process.env.VERCEL) throw new Error('LOCAL_DB_UNSUPPORTED: Vercel에서는 로컬 DB를 쓸 수 없습니다. DATA_BACKEND=supabase로 두세요.');
  adminEnv(); // 설정 오류는 DB를 만들기 전에 알린다
  const dir = localDbLocation();
  if (dir) {
    mkdirSync(dir, { recursive: true });
    claimFolder(dir);
  }
  let db: PGlite | null = null;
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    db = await PGlite.create(dir ?? undefined);
    await db.exec(BOOTSTRAP);
    await migrate(db);
    await ensureArea(db);
    const secret = await ensureSecret(db);
    await ensureOperator(db, dir);
    return { db, secret, dir };
  } catch (e) {
    // 실패한 인스턴스를 남기지 않는다(남기면 요청마다 메모리가 늘고 같은 폴더를 여러 번 연다).
    if (db) await db.close().catch(() => undefined);
    if (dir) releaseFolder(dir);
    throw e;
  }
}

export function getLocalDb(): Promise<LocalDb> {
  const s = state();
  if (!s.ready) {
    if (s.failure && Date.now() - s.failure.at < RETRY_AFTER_FAILURE_MS) return Promise.reject(s.failure.error);
    s.ready = open().then((db) => { s.failure = undefined; return db; }, (e) => {
      s.ready = undefined;
      s.failure = { at: Date.now(), error: e as Error };
      console.error(`[로컬 DB] 열지 못했습니다: ${(e as Error).message}`);
      throw e;
    });
  }
  return s.ready;
}

/**
 * 한 번에 한 작업만 실행한다(PGlite는 연결이 하나). 각 작업은 하나의 트랜잭션이다.
 * 기다림이 길어지면 호출한 쪽에는 시간 초과로 알리되, 다음 작업은 앞 작업이 실제로 끝난 뒤에 시작한다.
 */
function serial<T>(fn: () => Promise<T>, timeoutMs = LOCAL_JOB_TIMEOUT_MS): Promise<T> {
  const s = state();
  const run = s.queue.then(fn, fn);
  s.queue = run.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('LOCAL_DB_TIMEOUT')), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Supabase에서 같은 요청이 받는 권한으로 실행한다.
 * service_role = 서버 비밀키 RPC, authenticated + sub = 로그인한 담당자 JWT.
 */
export async function asRole<T>(role: Role, sub: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const { db } = await getLocalDb();
  return serial(() => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  }));
}

/** 로컬 계정 확인처럼 Supabase Auth 서버가 하던 일. 공개·담당자 데이터 처리에는 쓰지 않는다. */
export async function asAuthServer<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const { db } = await getLocalDb();
  return serial(() => db.transaction(fn));
}

/** 테스트용: 열린 DB를 닫고 상태를 비운다. */
export async function closeLocalDb() {
  const s = state();
  const ready = s.ready;
  s.ready = undefined;
  s.failure = undefined;
  if (!ready) return;
  const { db, dir } = await ready.catch(() => ({ db: null, dir: null }));
  if (db) await serial(() => db.close());
  if (dir) releaseFolder(dir);
}
