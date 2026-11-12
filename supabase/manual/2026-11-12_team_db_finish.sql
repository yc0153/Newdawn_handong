-- 포항 생활의견 지도 · 팀 Supabase로 옮길 때 마지막 단계 (2026-11-12)
-- 순서
--   ① SQL Editor에서 supabase/manual/setup_all.sql 실행 (DB 구조 전체)
--   ② SQL Editor에서 supabase/dev/pohang_whole_city.sql 실행 (의견 받는 지역: 포항시 전체)
--   ③ Authentication → Users → Add user 로 담당자 계정 만들기 (사람마다 따로, Auto Confirm User 켜기, 긴 비밀번호)
--   ④ 아래 이메일 두 개만 실제 담당자 이메일로 바꿔서 이 파일 실행 (사람이 더 있으면 같은 모양으로 추가)
-- 여러 번 실행해도 결과가 같습니다. 비밀번호는 여기에 적지 않습니다.
begin;
-- 의견 받기 켜기 (처음 만든 DB는 꺼져 있음)
update public.service_settings set submissions_enabled = true where singleton;
-- 담당자 명단: ③에서 만든 계정의 이메일
insert into public.operator_memberships(user_id, active)
select u.id, true
from auth.users u
where lower(u.email) in (
  lower('담당자1@example.com'),
  lower('담당자2@example.com')
)
on conflict (user_id) do update set active = true;
commit;

-- 확인: operators가 담당자 수, submissions_enabled가 true, allowed_cells가 29264 근처, notice_version이 2026-10-20-v2 이면 끝
select (select count(*) from public.operator_memberships where active) as operators,
       (select submissions_enabled from public.service_settings where singleton) as submissions_enabled,
       (select count(*) from public.allowed_cells) as allowed_cells,
       (select notice_version from public.service_settings where singleton) as notice_version;
