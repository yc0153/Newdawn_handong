-- 포항 생활의견 지도 · 2026-10-19 DB 업데이트 (테스트 모드: 검토 없이 바로 공개)
-- Supabase SQL Editor에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 결과가 같습니다.
-- 실행해도 기본값은 '꺼짐'이라 지금 동작은 바뀌지 않습니다. 켜기·끄기는 담당자 화면(등록 의견 목록 위)에서 하며,
-- 켜면 고른 시간(3·12·24·72시간)이 지나면 저절로 꺼집니다.
-- 내용은 supabase/migrations/20261019090000_test_auto_publish.sql 과 같습니다.

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

-- 확인: 아래 결과에 test_auto_publish_until 열이 보이면 적용된 것입니다(비어 있으면 꺼짐).
select submissions_enabled, test_auto_publish_until from public.service_settings;
