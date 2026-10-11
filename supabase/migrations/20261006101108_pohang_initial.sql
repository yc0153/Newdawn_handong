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
