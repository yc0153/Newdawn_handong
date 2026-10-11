-- 로컬 개발 전용. 운영·원격 DB에 실행하지 않는다.
-- 이 사각형은 화면 개발과 검수를 위한 테스트 영역이며 실제 수집 지역이 아니다.
-- 실제 지역은 학교가 확정한 뒤 별도 운영 절차로 allowed_cells에 넣는다.
-- 의견 데이터는 넣지 않는다(가상 의견 금지).

insert into public.allowed_cells(cell_x, cell_y)
select x, y from generate_series(28, 48) as x, generate_series(18, 52) as y
on conflict do nothing;

update public.service_settings set submissions_enabled = true where singleton;
