-- 포항 생활의견 지도: Supabase SQL Editor에 한 번에 붙여 넣어 실행하는 DB 구성
-- 내용은 supabase/migrations/ 의 5개 파일을 순서대로 이어 붙인 것과 같다. 새 프로젝트에서 한 번만 실행한다.
-- 의견 데이터·실제 지역·담당자는 넣지 않는다(로컬 테스트 영역은 별도 단계).

-- ===== 20261006101108_pohang_initial.sql =====
-- Initial local schema. No production region or operator is seeded.
-- Public raw tables are protected by RLS and explicit grants.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.nonspace_count(p_text text) returns integer
language sql immutable set search_path='' as $$
  select char_length(regexp_replace(normalize(coalesce(p_text,''),NFC),
  U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]', '', 'g'))
$$;
-- Unicode escapes preserve all White_Space characters across file newline normalization.
create table public.operator_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true
);
create table public.allowed_cells (
  cell_x integer not null, cell_y integer not null,
  primary key(cell_x,cell_y)
);
create table public.service_settings (
  singleton boolean primary key default true check(singleton),
  submissions_enabled boolean not null default false,
  notice_version text not null default '2026-10-06-v1'
);
insert into public.service_settings(singleton) values(true);
create table public.opinions (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  cell_x integer not null, cell_y integer not null,
  public_lat double precision generated always as (36.0+(cell_y+0.5)*200.0/6371008.8*180.0/pi()) stored,
  public_lon double precision generated always as (129.3+(cell_x+0.5)*200.0/(6371008.8*cos(36.04*pi()/180.0))*180.0/pi()) stored,
  category text not null check(category in ('transport','language','environment','other')),
  language text not null check(language in ('ko','en','other')),
  original_text text,
  allow_map boolean not null default false,
  allow_player boolean not null default false,
  notice_version text not null,
  summary text,
  status text not null default 'pending' check(status in ('pending','published','hidden')),
  include_in_player boolean not null default false,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(cell_x,cell_y) references public.allowed_cells(cell_x,cell_y),
  check(not allow_player or allow_map),
  check(not include_in_player or (allow_map and allow_player)),
  check(summary is null or (char_length(summary)<=250 and private.nonspace_count(summary)>0)),
  check((deleted_at is null and original_text is not null and char_length(original_text)<=500 and private.nonspace_count(original_text)>=10)
     or (deleted_at is not null and original_text is null and summary is null and status='hidden' and not include_in_player)),
  check(status<>'published' or (allow_map and summary is not null and deleted_at is null))
);
create index opinions_review_idx on public.opinions(status,created_at desc,id) where deleted_at is null;
create index opinions_public_idx on public.opinions(created_at,id) where status='published' and deleted_at is null and allow_map;
create table public.submission_receipts (
  request_key uuid primary key,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  reference text not null unique default ('OP-'||gen_random_uuid()::text),
  opinion_id uuid not null references public.opinions(id),
  created_at timestamptz not null default now()
);
create table public.rate_buckets (
  key_hash text not null check(key_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check(kind in ('10min','day')),
  window_start timestamptz not null,
  count integer not null check(count>0),
  primary key(key_hash,kind,window_start)
);
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  opinion_id uuid not null references public.opinions(id),
  actor_id uuid not null,
  action text not null check(action in ('save_summary','publish','hide','set_player','delete')),
  version integer not null,
  created_at timestamptz not null default now()
);
create index audit_opinion_idx on public.admin_audit_logs(opinion_id,created_at,id);

alter table public.operator_memberships enable row level security;
alter table public.allowed_cells enable row level security;
alter table public.service_settings enable row level security;
alter table public.opinions enable row level security;
alter table public.submission_receipts enable row level security;
alter table public.rate_buckets enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on public.operator_memberships,public.allowed_cells,public.service_settings,public.opinions,
 public.submission_receipts,public.rate_buckets,public.admin_audit_logs from public,anon,authenticated;
grant all on public.operator_memberships,public.allowed_cells,public.service_settings,public.opinions,
 public.submission_receipts,public.rate_buckets,public.admin_audit_logs to service_role;
grant select on public.operator_memberships,public.opinions,public.admin_audit_logs to authenticated;
grant update(summary,status,include_in_player,deleted_at) on public.opinions to authenticated;
create policy membership_self on public.operator_memberships for select to authenticated using(user_id=(select auth.uid()));
create policy operator_read on public.opinions for select to authenticated using (
  exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active)
);
create policy operator_update on public.opinions for update to authenticated using (
  deleted_at is null and exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active)
) with check(exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active));
create policy operator_audit_read on public.admin_audit_logs for select to authenticated using(
 exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active)
);

-- Only trigger needs elevated privilege to insert an immutable audit entry.
create function private.enforce_opinion_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_action text;
begin
  if not exists(select 1 from public.operator_memberships m where m.user_id=v_actor and m.active)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if old.deleted_at is not null then raise exception 'OPINION_DELETED'; end if;
  if (new.id,new.public_id,new.cell_x,new.cell_y,new.category,new.language,new.original_text,
      new.allow_map,new.allow_player,new.notice_version,new.created_at)
     is distinct from
     (old.id,old.public_id,old.cell_x,old.cell_y,old.category,old.language,old.original_text,
      old.allow_map,old.allow_player,old.notice_version,old.created_at)
    then raise exception 'IMMUTABLE_SUBMISSION'; end if;
  if new.deleted_at is not null then
    v_action:='delete'; new.deleted_at:=now();new.original_text:=null;new.summary:=null;
    new.status:='hidden';new.include_in_player:=false;
  elsif old.status='published' and new.summary is distinct from old.summary then
    raise exception 'HIDE_BEFORE_EDIT';
  elsif new.status is distinct from old.status then
    v_action:=case new.status when 'published' then 'publish' when 'hidden' then 'hide' else null end;
    if v_action is null then raise exception 'INVALID_TRANSITION'; end if;
  elsif new.summary is distinct from old.summary then v_action:='save_summary';
  elsif new.include_in_player is distinct from old.include_in_player then v_action:='set_player';
  else return old;
  end if;
  new.version:=old.version+1;
  insert into public.admin_audit_logs(opinion_id,actor_id,action,version) values(old.id,v_actor,v_action,new.version);
  return new;
end;
$$;
revoke all on function private.enforce_opinion_change() from public,anon,authenticated;
create trigger opinions_update_guard before update on public.opinions for each row execute function private.enforce_opinion_change();

create function public.read_public_opinions(p_mode text default 'browse') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; v_count integer;
begin
  if p_mode not in ('browse','player') or p_mode is null then raise exception 'INVALID_MODE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('public_id',o.public_id,'category',o.category,
    'location',jsonb_build_object('lat',o.public_lat,'lon',o.public_lon),'summary',o.summary)
    order by o.created_at,o.id),'[]'::jsonb) into result from (
    select public_id,category,public_lat,public_lon,summary,created_at,id from public.opinions
    where allow_map and status='published' and deleted_at is null and summary is not null
    and (p_mode='browse' or (allow_player and include_in_player))
    order by created_at,id limit 5001
  ) o;
  v_count:=jsonb_array_length(result);
  if v_count>5000 then raise exception 'PUBLIC_DATA_LIMIT'; end if;
  return jsonb_build_object('data',result);
end;
$$;
revoke all on function public.read_public_opinions(text) from public,anon,authenticated;
grant execute on function public.read_public_opinions(text) to service_role;

create function public.read_public_config() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('grid_version','pohang-v1','notice_version',s.notice_version,
  'submissions_enabled',s.submissions_enabled,'allowed_cells',
  coalesce((select jsonb_agg(jsonb_build_object('cell_x',c.cell_x,'cell_y',c.cell_y) order by c.cell_x,c.cell_y)
   from public.allowed_cells c),'[]'::jsonb)) from public.service_settings s where s.singleton
$$;
revoke all on function public.read_public_config() from public,anon,authenticated;
grant execute on function public.read_public_config() to service_role;

create function public.submit_opinion(
 p_request_key uuid,p_fingerprint text,p_key_hash text,p_grid_version text,p_cell_x integer,p_cell_y integer,
 p_category text,p_language text,p_original_text text,p_allow_map boolean,p_allow_player boolean,p_notice_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.submission_receipts%rowtype;v_id uuid;v_count integer;v_time timestamptz:=now();v_text text;
begin
  if p_request_key is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_fingerprint is null
    or p_key_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  select * into r from public.submission_receipts where request_key=p_request_key;
  if found then
    if r.fingerprint<>p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return jsonb_build_object('reference',r.reference,'created',false);
  end if;
  if not coalesce((select submissions_enabled from public.service_settings where singleton),false) then raise exception 'SUBMISSIONS_DISABLED'; end if;
  if p_grid_version is distinct from 'pohang-v1' then raise exception 'INVALID_GRID'; end if;
  if not exists(select 1 from public.allowed_cells where cell_x=p_cell_x and cell_y=p_cell_y) then raise exception 'OUTSIDE_AREA'; end if;
  if p_notice_version is distinct from (select notice_version from public.service_settings where singleton) then raise exception 'INVALID_NOTICE'; end if;
  v_text:=normalize(p_original_text,NFC);
  if v_text is null or private.nonspace_count(v_text)<10 then raise exception 'TEXT_TOO_SHORT'; end if;
  if char_length(v_text)>500 then raise exception 'TEXT_TOO_LONG'; end if;
  if p_allow_map is null or p_allow_player is null or (p_allow_player and not p_allow_map) then raise exception 'INVALID_CONSENT'; end if;
  if p_category is null or p_category not in ('transport','language','environment','other') then raise exception 'INVALID_CATEGORY'; end if;
  if p_language is null or p_language not in ('ko','en','other') then raise exception 'INVALID_LANGUAGE'; end if;
  -- Atomic counters; failed insert or rate limit rolls the whole statement back.
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'10min',to_timestamp(floor(extract(epoch from v_time)/600)*600),1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'day',date_trunc('day',v_time at time zone 'UTC') at time zone 'UTC',1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>20 then raise exception 'RATE_LIMITED'; end if;
  insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version)
  values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version) returning id into v_id;
  insert into public.submission_receipts(request_key,fingerprint,opinion_id) values(p_request_key,p_fingerprint,v_id) returning * into r;
  return jsonb_build_object('reference',r.reference,'created',true);
end;
$$;
revoke all on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text) to service_role;

create function public.admin_opinion_action(p_id uuid,p_expected_version integer,p_action text,p_summary text default null,p_include_in_player boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.opinions%rowtype;
begin
  if not exists(select 1 from public.operator_memberships where user_id=(select auth.uid()) and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into o from public.opinions where id=p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected_version is null or p_expected_version<>o.version then raise exception 'VERSION_CONFLICT'; end if;
  case p_action
   when 'save_summary' then
    if o.status='published' then raise exception 'HIDE_BEFORE_EDIT'; end if;
    if p_summary is null or char_length(normalize(p_summary,NFC))>250 or private.nonspace_count(p_summary)=0 then raise exception 'INVALID_SUMMARY'; end if;
    update public.opinions set summary=normalize(p_summary,NFC) where id=p_id returning * into o;
   when 'publish' then
    if not o.allow_map or o.summary is null then raise exception 'PUBLICATION_NOT_ALLOWED'; end if;
    update public.opinions set status='published' where id=p_id returning * into o;
   when 'hide' then update public.opinions set status='hidden' where id=p_id returning * into o;
   when 'set_player' then
    if p_include_in_player is null or (p_include_in_player and not(o.allow_map and o.allow_player)) then raise exception 'PLAYER_NOT_ALLOWED'; end if;
    update public.opinions set include_in_player=p_include_in_player where id=p_id returning * into o;
   when 'delete' then update public.opinions set deleted_at=now() where id=p_id returning * into o;
   else raise exception 'INVALID_ACTION';
  end case;
  return jsonb_build_object('id',o.id,'status',o.status,'version',o.version,'deleted',o.deleted_at is not null);
end;
$$;
revoke all on function public.admin_opinion_action(uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function public.admin_opinion_action(uuid,integer,text,text,boolean) to authenticated;

-- CHECKs and invoker RPC need this helper; no table data is returned by it.
grant usage on schema private to authenticated,service_role;
revoke all on function private.nonspace_count(text) from public,anon;
grant execute on function private.nonspace_count(text) to authenticated,service_role;
commit;

-- ===== 20261011090000_hide_resets_player_and_cleanup.sql =====
-- 1) 숨김은 상영 포함도 해제한다. 요약을 고친 뒤 다시 공개해도
--    담당자가 상영 포함을 다시 확인하기 전에는 플레이어에 나오지 않는다.
-- 2) 만료된 빈도 제한 버킷(48시간 경과)을 지우는 운영용 함수. 스케줄 등록은 운영 단계에서 한다.
begin;

create or replace function public.admin_opinion_action(p_id uuid,p_expected_version integer,p_action text,p_summary text default null,p_include_in_player boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.opinions%rowtype;
begin
  if not exists(select 1 from public.operator_memberships where user_id=(select auth.uid()) and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into o from public.opinions where id=p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected_version is null or p_expected_version<>o.version then raise exception 'VERSION_CONFLICT'; end if;
  case p_action
   when 'save_summary' then
    if o.status='published' then raise exception 'HIDE_BEFORE_EDIT'; end if;
    if p_summary is null or char_length(normalize(p_summary,NFC))>250 or private.nonspace_count(p_summary)=0 then raise exception 'INVALID_SUMMARY'; end if;
    update public.opinions set summary=normalize(p_summary,NFC) where id=p_id returning * into o;
   when 'publish' then
    if not o.allow_map or o.summary is null then raise exception 'PUBLICATION_NOT_ALLOWED'; end if;
    update public.opinions set status='published' where id=p_id returning * into o;
   when 'hide' then
    update public.opinions set status='hidden',include_in_player=false where id=p_id returning * into o;
   when 'set_player' then
    if p_include_in_player is null or (p_include_in_player and not(o.allow_map and o.allow_player)) then raise exception 'PLAYER_NOT_ALLOWED'; end if;
    update public.opinions set include_in_player=p_include_in_player where id=p_id returning * into o;
   when 'delete' then update public.opinions set deleted_at=now() where id=p_id returning * into o;
   else raise exception 'INVALID_ACTION';
  end case;
  return jsonb_build_object('id',o.id,'status',o.status,'version',o.version,'deleted',o.deleted_at is not null);
end;
$$;
revoke all on function public.admin_opinion_action(uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function public.admin_opinion_action(uuid,integer,text,text,boolean) to authenticated;

create function public.cleanup_expired_rate_buckets() returns integer
language sql security invoker set search_path='' as $$
  with d as (delete from public.rate_buckets where window_start < now() - interval '48 hours' returning 1)
  select count(*)::integer from d
$$;
revoke all on function public.cleanup_expired_rate_buckets() from public,anon,authenticated;
grant execute on function public.cleanup_expired_rate_buckets() to service_role;
commit;

-- ===== 20261011120000_admin_changes_only_via_rpc.sql =====
-- 담당자 변경은 admin_opinion_action RPC로만 한다.
-- 직접 UPDATE 권한을 회수해 버전 충돌 검사·숨김 시 상영 해제·조치별 이력을 우회할 수 없게 한다.
-- RPC는 SECURITY DEFINER로 실행하되, 함수 안과 트리거에서 활성 담당자 명단을 다시 검사한다.
begin;
revoke update on public.opinions from authenticated;
drop policy if exists operator_update on public.opinions;
alter function public.admin_opinion_action(uuid,integer,text,text,boolean) security definer;
revoke all on function public.admin_opinion_action(uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function public.admin_opinion_action(uuid,integer,text,text,boolean) to authenticated;

-- 트리거에서도 한 번의 변경에 하나의 조치만 허용하고, 숨김이면 상영 포함을 해제한다.
create or replace function private.enforce_opinion_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_action text;
begin
  if not exists(select 1 from public.operator_memberships m where m.user_id=v_actor and m.active)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if old.deleted_at is not null then raise exception 'OPINION_DELETED'; end if;
  if (new.id,new.public_id,new.cell_x,new.cell_y,new.category,new.language,new.original_text,
      new.allow_map,new.allow_player,new.notice_version,new.created_at)
     is distinct from
     (old.id,old.public_id,old.cell_x,old.cell_y,old.category,old.language,old.original_text,
      old.allow_map,old.allow_player,old.notice_version,old.created_at)
    then raise exception 'IMMUTABLE_SUBMISSION'; end if;
  if new.deleted_at is not null then
    v_action:='delete'; new.deleted_at:=now();new.original_text:=null;new.summary:=null;
    new.status:='hidden';new.include_in_player:=false;
  else
    if (new.summary is distinct from old.summary)::int + (new.status is distinct from old.status)::int
       + (new.include_in_player is distinct from old.include_in_player and new.status is not distinct from old.status)::int > 1
      then raise exception 'ONE_ACTION_PER_CHANGE'; end if;
    if old.status='published' and new.summary is distinct from old.summary then
      raise exception 'HIDE_BEFORE_EDIT';
    elsif new.status is distinct from old.status then
      v_action:=case new.status when 'published' then 'publish' when 'hidden' then 'hide' else null end;
      if v_action is null then raise exception 'INVALID_TRANSITION'; end if;
      if new.status='hidden' then new.include_in_player:=false; end if;
    elsif new.summary is distinct from old.summary then v_action:='save_summary';
    elsif new.include_in_player is distinct from old.include_in_player then v_action:='set_player';
    else return old;
    end if;
  end if;
  new.version:=old.version+1;
  insert into public.admin_audit_logs(opinion_id,actor_id,action,version) values(old.id,v_actor,v_action,new.version);
  return new;
end;
$$;
revoke all on function private.enforce_opinion_change() from public,anon,authenticated;
commit;

-- ===== 20261019090000_test_auto_publish.sql =====
-- 테스트 모드: 담당자 검토 없이 바로 공개 (기본 꺼짐, 켜도 정한 시간이 지나면 저절로 꺼짐)
-- 팀 테스트에서 "의견을 남겼는데 플레이어에 안 나온다"는 피드백에 대한 선택 기능.
-- 켜져 있는 동안 지도 공개를 선택한 새 의견은 원문 앞 250자를 요약으로 바로 공개하고,
-- 플레이어 공개도 선택했으면 상영에도 포함한다. 작성자의 공개 선택은 그대로 지킨다.
-- 켜고 끄기는 담당자 화면(등록 의견 목록 위 '테스트 모드')에서 하며, 켠 담당자·시각을 기록한다.
-- 자동 공개된 의견에는 '테스트 모드 자동 공개' 이력이 남는다. 정식 운영 전에는 반드시 끈다.
begin;

alter table public.service_settings add column if not exists test_auto_publish_until timestamptz;
alter table public.service_settings add column if not exists test_auto_publish_by uuid;

-- 자동 공개 이력을 남길 수 있게 조치 종류를 넓힌다.
alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check
  check(action in ('save_summary','publish','hide','set_player','delete','auto_publish'));

-- 서비스 설정 변경 이력(누가 언제 테스트 모드를 켜고 껐는지)
create table if not exists public.settings_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  setting text not null check(setting in ('test_auto_publish')),
  value text,
  created_at timestamptz not null default now()
);
alter table public.settings_audit_logs enable row level security;
revoke all on public.settings_audit_logs from public,anon,authenticated;
grant all on public.settings_audit_logs to service_role;
grant select on public.settings_audit_logs to authenticated;
drop policy if exists operator_settings_audit_read on public.settings_audit_logs;
create policy operator_settings_audit_read on public.settings_audit_logs for select to authenticated using(
 exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active)
);

create or replace function public.submit_opinion(
 p_request_key uuid,p_fingerprint text,p_key_hash text,p_grid_version text,p_cell_x integer,p_cell_y integer,
 p_category text,p_language text,p_original_text text,p_allow_map boolean,p_allow_player boolean,p_notice_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.submission_receipts%rowtype;v_id uuid;v_count integer;v_time timestamptz:=now();v_text text;
  v_auto boolean;v_summary text;v_by uuid;
begin
  if p_request_key is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_fingerprint is null
    or p_key_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  select * into r from public.submission_receipts where request_key=p_request_key;
  if found then
    if r.fingerprint<>p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return jsonb_build_object('reference',r.reference,'created',false,
      'published',coalesce((select o.status='published' from public.opinions o where o.id=r.opinion_id),false));
  end if;
  if not coalesce((select submissions_enabled from public.service_settings where singleton),false) then raise exception 'SUBMISSIONS_DISABLED'; end if;
  if p_grid_version is distinct from 'pohang-v1' then raise exception 'INVALID_GRID'; end if;
  if not exists(select 1 from public.allowed_cells where cell_x=p_cell_x and cell_y=p_cell_y) then raise exception 'OUTSIDE_AREA'; end if;
  if p_notice_version is distinct from (select notice_version from public.service_settings where singleton) then raise exception 'INVALID_NOTICE'; end if;
  v_text:=normalize(p_original_text,NFC);
  if v_text is null or private.nonspace_count(v_text)<10 then raise exception 'TEXT_TOO_SHORT'; end if;
  if char_length(v_text)>500 then raise exception 'TEXT_TOO_LONG'; end if;
  if p_allow_map is null or p_allow_player is null or (p_allow_player and not p_allow_map) then raise exception 'INVALID_CONSENT'; end if;
  if p_category is null or p_category not in ('transport','language','environment','other') then raise exception 'INVALID_CATEGORY'; end if;
  if p_language is null or p_language not in ('ko','en','other') then raise exception 'INVALID_LANGUAGE'; end if;
  -- Atomic counters; failed insert or rate limit rolls the whole statement back.
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'10min',to_timestamp(floor(extract(epoch from v_time)/600)*600),1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'day',date_trunc('day',v_time at time zone 'UTC') at time zone 'UTC',1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>20 then raise exception 'RATE_LIMITED'; end if;
  select coalesce(s.test_auto_publish_until>v_time,false), s.test_auto_publish_by into v_auto, v_by
    from public.service_settings s where s.singleton;
  v_auto:=coalesce(v_auto,false) and p_allow_map;
  if v_auto then
    -- 앞뒤 공백을 걷어 낸 원문 앞 250자(넘치면 249자 + …)를 공개 요약으로 쓴다.
    v_summary:=regexp_replace(v_text,U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$','','g');
    if char_length(v_summary)>250 then v_summary:=left(v_summary,249)||'…'; end if;
    insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version,summary,status,include_in_player)
    values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version,v_summary,'published',p_allow_player) returning id into v_id;
    -- 이력의 담당자는 테스트 모드를 켠 사람이다(SQL로 직접 켠 경우 0번).
    insert into public.admin_audit_logs(opinion_id,actor_id,action,version)
    values(v_id,coalesce(v_by,'00000000-0000-0000-0000-000000000000'::uuid),'auto_publish',1);
  else
    insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version)
    values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version) returning id into v_id;
  end if;
  insert into public.submission_receipts(request_key,fingerprint,opinion_id) values(p_request_key,p_fingerprint,v_id) returning * into r;
  return jsonb_build_object('reference',r.reference,'created',true,'published',v_auto);
end;
$$;
revoke all on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text) to service_role;

create or replace function public.read_public_config() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('grid_version','pohang-v1','notice_version',s.notice_version,
  'submissions_enabled',s.submissions_enabled,
  'test_auto_publish',coalesce(s.test_auto_publish_until>now(),false),
  'test_auto_publish_until',case when s.test_auto_publish_until>now() then s.test_auto_publish_until end,
  'allowed_cells',
  coalesce((select jsonb_agg(jsonb_build_object('cell_x',c.cell_x,'cell_y',c.cell_y) order by c.cell_x,c.cell_y)
   from public.allowed_cells c),'[]'::jsonb)) from public.service_settings s where s.singleton
$$;
revoke all on function public.read_public_config() from public,anon,authenticated;
grant execute on function public.read_public_config() to service_role;

-- 담당자만 켜고 끌 수 있다. 활성 담당자 명단을 함수 안에서 다시 확인한다. 켤 때는 1~72시간 뒤 저절로 꺼진다.
create or replace function public.admin_set_test_auto_publish(p_enabled boolean,p_hours integer default 12) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_until timestamptz;
begin
  if not exists(select 1 from public.operator_memberships where user_id=v_actor and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'INVALID_REQUEST'; end if;
  if p_enabled then
    if p_hours is null or p_hours<1 or p_hours>72 then raise exception 'INVALID_REQUEST'; end if;
    v_until:=now()+make_interval(hours=>p_hours);
  end if;
  update public.service_settings set test_auto_publish_until=v_until,test_auto_publish_by=case when p_enabled then v_actor end where singleton;
  insert into public.settings_audit_logs(actor_id,setting,value) values(v_actor,'test_auto_publish',coalesce(v_until::text,'off'));
  return jsonb_build_object('test_auto_publish',p_enabled,'test_auto_publish_until',v_until);
end;
$$;
revoke all on function public.admin_set_test_auto_publish(boolean,integer) from public,anon,service_role;
grant execute on function public.admin_set_test_auto_publish(boolean,integer) to authenticated;
commit;

-- ===== 20261020090000_review_pin.sql =====
-- 담당자 검토용 정확한 핀 (2026-10-20, 팀 요청: 결과를 볼 때 지도·로드뷰에 꽂은 핀까지 같이 보기)
-- 글쓴이가 지도에 꽂은 핀 좌표와, 로드뷰에서 핀을 꽂았으면 그 방향과 그때 보던 로드뷰 시점을 저장한다.
--  - 담당자만 읽는다(활성 담당자 명단 확인). 공개 의견·플레이어·공개 설정 응답에는 들어가지 않는다.
--  - 좌표는 고른 약 200m 칸 안이어야 한다. 사진은 저장하지 않는다(로드뷰는 같은 자리·시점으로 다시 연다).
--  - 의견을 삭제하면 함께 지운다.
--  - 위치 안내 문구가 바뀌므로 공개 안내 버전을 올린다(이전 화면에서 등록하면 '안내 갱신' 후 다시 등록).
begin;

create table if not exists public.opinion_review_pins (
  opinion_id uuid primary key references public.opinions(id) on delete cascade,
  lat double precision not null check(lat between -90 and 90),
  lon double precision not null check(lon between -180 and 180),
  pano_id bigint check(pano_id>0),
  pin_pan double precision check(pin_pan>=0 and pin_pan<360),
  pin_tilt double precision check(pin_tilt between -90 and 90),
  view_pan double precision check(view_pan>=0 and view_pan<360),
  view_tilt double precision check(view_tilt between -90 and 90),
  view_zoom double precision check(view_zoom between -3 and 3),
  created_at timestamptz not null default now(),
  check((pano_id is null and pin_pan is null and pin_tilt is null and view_pan is null and view_tilt is null and view_zoom is null)
     or (pano_id is not null and pin_pan is not null and pin_tilt is not null and view_pan is not null and view_tilt is not null and view_zoom is not null))
);
alter table public.opinion_review_pins enable row level security;
revoke all on public.opinion_review_pins from public,anon,authenticated;
grant all on public.opinion_review_pins to service_role;
grant select on public.opinion_review_pins to authenticated;
drop policy if exists operator_review_pin_read on public.opinion_review_pins;
create policy operator_review_pin_read on public.opinion_review_pins for select to authenticated using(
  exists(select 1 from public.operator_memberships m where m.user_id=(select auth.uid()) and m.active)
  and exists(select 1 from public.opinions o where o.id=opinion_review_pins.opinion_id and o.deleted_at is null)
);

-- 의견 삭제(deleted_at 기록) 때 핀도 지운다.
create or replace function private.drop_review_pin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.opinion_review_pins where opinion_id=new.id;
  return null;
end;
$$;
revoke all on function private.drop_review_pin() from public,anon,authenticated;
drop trigger if exists opinions_drop_review_pin on public.opinions;
create trigger opinions_drop_review_pin after update of deleted_at on public.opinions
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function private.drop_review_pin();

-- 등록 함수에 선택 인자 p_review_pin을 더한다. 같은 이름의 함수가 둘이면 호출이 모호해지므로 예전 것을 지운다.
drop function if exists public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text);
create or replace function public.submit_opinion(
 p_request_key uuid,p_fingerprint text,p_key_hash text,p_grid_version text,p_cell_x integer,p_cell_y integer,
 p_category text,p_language text,p_original_text text,p_allow_map boolean,p_allow_player boolean,p_notice_version text,
 p_review_pin jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.submission_receipts%rowtype;v_id uuid;v_count integer;v_time timestamptz:=now();v_text text;
  v_auto boolean;v_summary text;v_by uuid;
  v_lat double precision;v_lon double precision;v_fx double precision;v_fy double precision;v_rv jsonb;
begin
  if p_request_key is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_fingerprint is null
    or p_key_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  select * into r from public.submission_receipts where request_key=p_request_key;
  if found then
    if r.fingerprint<>p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return jsonb_build_object('reference',r.reference,'created',false,
      'published',coalesce((select o.status='published' from public.opinions o where o.id=r.opinion_id),false));
  end if;
  if not coalesce((select submissions_enabled from public.service_settings where singleton),false) then raise exception 'SUBMISSIONS_DISABLED'; end if;
  if p_grid_version is distinct from 'pohang-v1' then raise exception 'INVALID_GRID'; end if;
  if not exists(select 1 from public.allowed_cells where cell_x=p_cell_x and cell_y=p_cell_y) then raise exception 'OUTSIDE_AREA'; end if;
  if p_notice_version is distinct from (select notice_version from public.service_settings where singleton) then raise exception 'INVALID_NOTICE'; end if;
  v_text:=normalize(p_original_text,NFC);
  if v_text is null or private.nonspace_count(v_text)<10 then raise exception 'TEXT_TOO_SHORT'; end if;
  if char_length(v_text)>500 then raise exception 'TEXT_TOO_LONG'; end if;
  if p_allow_map is null or p_allow_player is null or (p_allow_player and not p_allow_map) then raise exception 'INVALID_CONSENT'; end if;
  if p_category is null or p_category not in ('transport','language','environment','other') then raise exception 'INVALID_CATEGORY'; end if;
  if p_language is null or p_language not in ('ko','en','other') then raise exception 'INVALID_LANGUAGE'; end if;
  -- 담당자 검토용 핀: 고른 칸 안의 좌표만 받는다(격자 계산은 공개 대표점 열과 같은 식, 경계 오차만 허용).
  if p_review_pin is not null and jsonb_typeof(p_review_pin)<>'null' then
    -- 객체인지 먼저 따로 본다(jsonb_object_keys는 배열이면 오류를 내고, OR의 계산 순서는 보장되지 않음).
    if jsonb_typeof(p_review_pin)<>'object' then raise exception 'INVALID_PIN'; end if;
    if jsonb_typeof(p_review_pin->'lat') is distinct from 'number' or jsonb_typeof(p_review_pin->'lon') is distinct from 'number'
      or exists(select 1 from jsonb_object_keys(p_review_pin) k where k not in ('lat','lon','roadview')) then raise exception 'INVALID_PIN'; end if;
    v_lat:=(p_review_pin->>'lat')::double precision; v_lon:=(p_review_pin->>'lon')::double precision;
    v_fx:=6371008.8*(v_lon-129.3)*(pi()/180.0)*cos(36.04*(pi()/180.0))/200.0;
    v_fy:=6371008.8*(v_lat-36.0)*(pi()/180.0)/200.0;
    if v_fx<p_cell_x-1e-6 or v_fx>p_cell_x+1+1e-6 or v_fy<p_cell_y-1e-6 or v_fy>p_cell_y+1+1e-6 then raise exception 'INVALID_PIN'; end if;
    v_rv:=nullif(p_review_pin->'roadview','null'::jsonb);
    if v_rv is not null then
      if jsonb_typeof(v_rv)<>'object' then raise exception 'INVALID_PIN'; end if;
      if jsonb_typeof(v_rv->'pano_id') is distinct from 'number' or coalesce(v_rv->>'pano_id','') !~ '^[1-9][0-9]{0,15}$'
        or exists(select 1 from jsonb_object_keys(v_rv) k where k not in ('pano_id','pin_pan','pin_tilt','view_pan','view_tilt','view_zoom'))
        or jsonb_typeof(v_rv->'pin_pan') is distinct from 'number' or jsonb_typeof(v_rv->'pin_tilt') is distinct from 'number'
        or jsonb_typeof(v_rv->'view_pan') is distinct from 'number' or jsonb_typeof(v_rv->'view_tilt') is distinct from 'number'
        or jsonb_typeof(v_rv->'view_zoom') is distinct from 'number' then raise exception 'INVALID_PIN'; end if;
      if (v_rv->>'pin_pan')::double precision not between 0 and 359.9999999 or (v_rv->>'view_pan')::double precision not between 0 and 359.9999999
        or abs((v_rv->>'pin_tilt')::double precision)>90 or abs((v_rv->>'view_tilt')::double precision)>90
        or abs((v_rv->>'view_zoom')::double precision)>3 then raise exception 'INVALID_PIN'; end if;
    end if;
  end if;
  -- Atomic counters; failed insert or rate limit rolls the whole statement back.
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'10min',to_timestamp(floor(extract(epoch from v_time)/600)*600),1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.rate_buckets(key_hash,kind,window_start,count)
  values(p_key_hash,'day',date_trunc('day',v_time at time zone 'UTC') at time zone 'UTC',1)
  on conflict(key_hash,kind,window_start) do update set count=public.rate_buckets.count+1 returning count into v_count;
  if v_count>20 then raise exception 'RATE_LIMITED'; end if;
  select coalesce(s.test_auto_publish_until>v_time,false), s.test_auto_publish_by into v_auto, v_by
    from public.service_settings s where s.singleton;
  v_auto:=coalesce(v_auto,false) and p_allow_map;
  if v_auto then
    -- 앞뒤 공백을 걷어 낸 원문 앞 250자(넘치면 249자 + …)를 공개 요약으로 쓴다.
    v_summary:=regexp_replace(v_text,U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$','','g');
    if char_length(v_summary)>250 then v_summary:=left(v_summary,249)||'…'; end if;
    insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version,summary,status,include_in_player)
    values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version,v_summary,'published',p_allow_player) returning id into v_id;
    -- 이력의 담당자는 테스트 모드를 켠 사람이다(SQL로 직접 켠 경우 0번).
    insert into public.admin_audit_logs(opinion_id,actor_id,action,version)
    values(v_id,coalesce(v_by,'00000000-0000-0000-0000-000000000000'::uuid),'auto_publish',1);
  else
    insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version)
    values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version) returning id into v_id;
  end if;
  if v_lat is not null then
    insert into public.opinion_review_pins(opinion_id,lat,lon,pano_id,pin_pan,pin_tilt,view_pan,view_tilt,view_zoom)
    values(v_id,v_lat,v_lon,(v_rv->>'pano_id')::bigint,(v_rv->>'pin_pan')::double precision,(v_rv->>'pin_tilt')::double precision,
      (v_rv->>'view_pan')::double precision,(v_rv->>'view_tilt')::double precision,(v_rv->>'view_zoom')::double precision);
  end if;
  insert into public.submission_receipts(request_key,fingerprint,opinion_id) values(p_request_key,p_fingerprint,v_id) returning * into r;
  return jsonb_build_object('reference',r.reference,'created',true,'published',v_auto);
end;
$$;
revoke all on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_opinion(uuid,text,text,text,integer,integer,text,text,text,boolean,boolean,text,jsonb) to service_role;

-- 공개 설정에 '정확한 핀 저장 가능' 표시를 더한다. 브라우저는 이 값이 true일 때만 핀을 보낸다.
create or replace function public.read_public_config() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('grid_version','pohang-v1','notice_version',s.notice_version,
  'submissions_enabled',s.submissions_enabled,
  'test_auto_publish',coalesce(s.test_auto_publish_until>now(),false),
  'test_auto_publish_until',case when s.test_auto_publish_until>now() then s.test_auto_publish_until end,
  'review_pin',true,
  'allowed_cells',
  coalesce((select jsonb_agg(jsonb_build_object('cell_x',c.cell_x,'cell_y',c.cell_y) order by c.cell_x,c.cell_y)
   from public.allowed_cells c),'[]'::jsonb)) from public.service_settings s where s.singleton
$$;
revoke all on function public.read_public_config() from public,anon,authenticated;
grant execute on function public.read_public_config() to service_role;

-- 위치 안내 문구 변경: "공개는 약 200m 대표 지점, 꽂은 핀의 정확한 위치는 담당자 검토에만 사용"
-- 다시 실행해도 이후에 올린 버전을 되돌리지 않도록, 예전 버전일 때만 바꾼다.
update public.service_settings set notice_version='2026-10-20-v2' where singleton and notice_version='2026-10-06-v1';
commit;
