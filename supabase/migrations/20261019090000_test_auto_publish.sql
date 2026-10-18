-- 테스트 모드: 담당자 검토 없이 바로 공개 (기본 꺼짐)
-- 팀 테스트에서 "의견을 남겼는데 플레이어에 안 나온다"는 피드백에 대한 선택 기능.
-- 켜져 있으면 지도 공개를 선택한 새 의견은 원문 앞 250자를 요약으로 바로 공개하고,
-- 플레이어 공개도 선택했으면 상영에도 포함한다. 작성자의 공개 선택은 그대로 지킨다.
-- 켜고 끄기는 담당자 화면(등록 의견 목록 위 '테스트 모드') 또는 아래 RPC로 한다. 정식 운영 전에는 반드시 끈다.
begin;

alter table public.service_settings add column if not exists test_auto_publish boolean not null default false;

create or replace function public.submit_opinion(
 p_request_key uuid,p_fingerprint text,p_key_hash text,p_grid_version text,p_cell_x integer,p_cell_y integer,
 p_category text,p_language text,p_original_text text,p_allow_map boolean,p_allow_player boolean,p_notice_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.submission_receipts%rowtype;v_id uuid;v_count integer;v_time timestamptz:=now();v_text text;
  v_auto boolean;v_summary text;
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
  v_auto:=p_allow_map and coalesce((select test_auto_publish from public.service_settings where singleton),false);
  if v_auto then
    -- 앞뒤 공백을 걷어 낸 원문 앞 250자(넘치면 249자 + …)를 공개 요약으로 쓴다.
    v_summary:=regexp_replace(v_text,U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$','','g');
    if char_length(v_summary)>250 then v_summary:=left(v_summary,249)||'…'; end if;
    insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version,summary,status,include_in_player)
    values(p_cell_x,p_cell_y,p_category,p_language,v_text,p_allow_map,p_allow_player,p_notice_version,v_summary,'published',p_allow_player) returning id into v_id;
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
  'submissions_enabled',s.submissions_enabled,'test_auto_publish',s.test_auto_publish,'allowed_cells',
  coalesce((select jsonb_agg(jsonb_build_object('cell_x',c.cell_x,'cell_y',c.cell_y) order by c.cell_x,c.cell_y)
   from public.allowed_cells c),'[]'::jsonb)) from public.service_settings s where s.singleton
$$;
revoke all on function public.read_public_config() from public,anon,authenticated;
grant execute on function public.read_public_config() to service_role;

-- 담당자만 켜고 끌 수 있다. 활성 담당자 명단을 함수 안에서 다시 확인한다.
create or replace function public.admin_set_test_auto_publish(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.operator_memberships where user_id=(select auth.uid()) and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'INVALID_REQUEST'; end if;
  update public.service_settings set test_auto_publish=p_enabled where singleton;
  return jsonb_build_object('test_auto_publish',p_enabled);
end;
$$;
revoke all on function public.admin_set_test_auto_publish(boolean) from public,anon,service_role;
grant execute on function public.admin_set_test_auto_publish(boolean) to authenticated;
commit;
