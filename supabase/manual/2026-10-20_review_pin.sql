-- 포항 생활의견 지도 · 2026-10-20 DB 업데이트 (담당자 검토용 정확한 핀: 지도 핀 + 로드뷰 핀)
-- Supabase SQL Editor에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 결과가 같습니다.
-- 실행하면 새로 등록되는 의견부터 글쓴이가 꽂은 지도 핀 좌표와 로드뷰 핀 방향·시점이 저장되고,
-- 담당자 상세 화면에서 지도와 로드뷰에 그 핀이 보입니다. 공개 지도·플레이어에는 그대로 약 200m 대표 위치만 나갑니다.
-- 위치 안내 문구가 바뀌어 공개 안내 버전이 2026-10-20-v2로 올라갑니다.
-- 실행 전에는 지금처럼 동작합니다(핀은 저장하지 않고 등록만 됨). 2026-10-19 SQL을 먼저 실행해 두어야 합니다.
-- 앱을 새 버전으로 배포한 뒤에 실행하세요(먼저 실행하면 바뀐 안내 문구가 나오기 전에 새 안내 버전으로 기록됨).
-- 내용은 supabase/migrations/20261020090000_review_pin.sql 과 같습니다.

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

-- 확인: 아래 결과가 2026-10-20-v2 이고 review_pin 이 true 이면 적용된 것입니다.
select notice_version, (select (public.read_public_config()->>'review_pin')) as review_pin from public.service_settings;
