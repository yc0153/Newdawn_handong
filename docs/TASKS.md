# 구현 순서와 완료 조건

아래 모든 단계는 첫 출시의 P0 범위다. 각 단계 검증이 다음 단계의 전제다. 계획 문서만 쓰고 종료하지 않는다. 원격 변경은 사용자의 별도 명시 요청 범위에서 수행한다.

## 단계 0 기반과 외부 설정

현재 최소 Next 프로젝트·공통 함수·SQL을 확인한다. npm ci → npm run check. Supabase 로컬 개발을 준비하고 migration을 적용한다. 실제 담당자 allowlist·허용 지역·지도 공급자·도메인은 운영값으로 구분한다.

완료: clean install·lint·typecheck·build·도메인 단위·DB 테스트 통과. 로컬 Supabase로 재검증할 항목은 VERIFICATION에 남기고, 연결 후 generated types를 만든다. .env.example에 실키 없음. registration은 기본 disabled.

## 단계 1 데이터와 API 보안

API.md와 openapi.json의 public/config, public/opinions, opinions, 관리자 조회·action을 구현한다. 사용자에게 빈 등록 성공을 반환하지 않는다. JSON allowlist·8KB limit·Origin·verified operator·trusted IP HMAC과 DB error mapping을 구현한다. 공용 read RPC·submit RPC만 secret client를 사용한다.

완료: anon/일반 로그인/담당자 권한 행렬, RPC 직접 접근, 모든 공개 조합, 멱등 동시성, 429, 409 version, deleted retry 검수. no-store 응답과 로그 redaction 확인. public payload에 허용 4종 외 필드 없음.

## 단계 2 실제 지도와 공개 탐색

지도 공급자 어댑터 + Leaflet MapCanvas + 핀·목록·선택 + 분야 필터. 정규 경로와 query alias를 구현한다. 같은 cell의 여러 의견을 선택할 수 있게 한다. 실제 지도·출처·확대축소·0건·필터0건·조회 실패·지도 장애 안내를 구현한다.

완료: T01~T03, T09. 모바일·PC·키보드·언어 전환. 가상 데이터를 실제 의견으로 표시하지 않음. 지도 APIkey는 공급자 규칙에 맞춰 도메인 제한.

## 단계 3 위치 태그와 의견 등록

직접 /submit 진입, 허용 셀 클릭 즉시 패널, 영역 밖·위치 실패 안내, 변경 시 draft 유지. 분야·언어·글자 수·공개 선택·등록 중 잠금·동일 요청 키 재시도·완료 화면을 구현한다. draft는 브라우저 메모리에만 저장한다.

완료: T04~T07, T11. 원좌표 미전송·미저장·미로그. 타임아웃 후 retry 1건. 둘 다 공개 false도 성공. map false/player true는 서버 거절. 필수 위치 없이 성공 처리 없음.

## 단계 4 담당자 운영

이메일·비밀번호 로그인·로그아웃, 목록·상세·원문·수동 요약·검토 상태·공개·숨김·상영 포함·삭제·최소 이력. 사용자 공개 설정은 읽기 전용. published summary 수정은 hide 선행. 두 담당자 version conflict 안내를 구현한다.

완료: T08~T11, T14. 일반 계정·비활성 담당자 API와 직접 DB 접근 실패. 삭제 직후 공개 조회에서 제외. 원문 또는 이력을 일반 응답에 싣지 않음.

## 단계 5 플레이어와 철회 신선도

큰 요약·분야·대략 위치·map emphasis·index/total·controls·fullscreen·keyboard. 0/1/여러 건, 초기 정지, 12초 순환, 수동 이동 후 정지. 지도와 플레이어에 공통 30초 polling·60초 만료·offline/hidden 즉시 숨김·복귀 재검증을 적용한다.

완료: T10, T12~T13, stale race 검수. 12초 타이머가 복제되지 않음. 현재 사례 철회 후 옛 카드 없음. 지도 장애와 공개 데이터 장애를 구분. reduced-motion 지원.

## 단계 6 연결 검수와 운영 인계

같은 의견 1건을 직접 작성 주소·메인 연결 → 위치 선택 → 등록 → 담당자 검토 → map/player → 숨김/삭제까지 검수한다. ko/en·모바일·글자 확대·키보드·공유망 제한·실패를 확인한다. 허용 지역·지도 약관·안내문·파기기간·담당자·실환경 키·학교 주소 확정 후 출시 점검표를 완료한다.

완료: ACCEPTANCE 전체 통과. 실제 환경 미검증은 명시. 배포를 별도 요청받았을 때 실제 도메인에서 cookie·cache·철회·iframe 정책을 재검수하고 두 진입 주소와 플레이어 주소를 학교에 전달한다. 결과보고서·운영 안내서는 별도 요청 산출물이다.
