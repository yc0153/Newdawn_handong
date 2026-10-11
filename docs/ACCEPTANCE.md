# 검수 시나리오

원문 T01~T14는 기능 요구이며 아직 제품 검수 완료가 아니다. 각 항목은 실제 API·DB·UI 연결로 확인한다. PGlite 기반 검증은 SQL·로직 기반 검증이고 Supabase 실환경 연결을 대신하지 않는다.

## 원문 검수

| 번호 | 준비·행동 | 기대 결과 |
| --- | --- | --- |
| T01 | 메인 연결·/?view=browse → 작성 버튼 | 공개 지도 먼저, /submit 태그 지도 이동 |
| T02 | 승인 0건·분야 0건·API 실패 각각 | 실제 지도·안내·작성 버튼. 실패를 0건으로 오인하지 않음 |
| T03 | 쿠키 없이 /submit 또는 /?view=place 직접 열기 | 공개·추천 목록 없이 위치 선택부터 |
| T04 | 위치 없음·허용 셀 밖·선택 실패 | 오류·draft 보존, 임의 위치 등록 없음 |
| T05 | 허용 위치 클릭 후 network/DB 확인 | 자동 입력 패널, cell/대표점만 저장·전송 |
| T06 | 입력·설정 후 위치 변경·영역 밖 클릭·다시 유효 선택 | 의견·분야·언어·공개 설정 보존 |
| T07 | 정상 등록·double click·응답 유실 retry·실패 retry | 같은 key+payload 의견 1건, 실패 draft 유지 |
| T08 | 미검토·선택없음·숨김·삭제 의견으로 API 호출 | 공개 지도·플레이어 모두 해당 항목 없음 |
| T09 | 승인 후 pin/list 선택·분야 변경 | 요약·대표점만 공개, 같은 public_id 연동 |
| T10 | 지도·player를 연 뒤 다른 담당자가 hide/delete | 이후 서버 조회 즉시 제외, 활성 화면 최대60초 내 제거 |
| T11 | 새 입력·둘 다 false·지도만 true·지도 off | 기본 꺼짐, 미선택 등록, player 제외, 종속 설정 해제 |
| T12 | player eligible 0/1/3건 | 참여 안내/단일 정지/초기정지·재생 후12초 순환 |
| T13 | 자동재생 중 수동 이동·fullscreen·offline·visibilitychange | 수동 이동 정지, fullscreen 정상, old case 숨김·복귀 검증 |
| T14 | anon·일반 Auth·비활성 operator로 raw read/mutate | UI·API·DB·RPC 모두 거절 |

## 추가 기술 검수

| 번호 | 시나리오 | 기대 결과 |
| --- | --- | --- |
| X01 | Unicode·NFC·한글·영어·기타·탭·NBSP·9/10/500/501자 | 클라이언트·서버·DB 같은 경계 |
| X02 | `<script>`·HTML 이벤트 문자열 | 평문 표시, 실행 없음. SQL parameter binding |
| X03 | allow_map=false/allow_player=true 및 unknown field | 422 또는400, DB 0건 |
| X04 | 동일 key의 서로 다른 payload·동시 요청 | 409 또는 최초1건, 영수증 일관 |
| X05 | DB 성공 뒤 응답 유실·삭제 뒤 동일 key retry | 중복·재생성 없음, 같은 reference 반환 |
| X06 | 10분5건·일20건·경계 시간·같은 성공 retry | 초과429, retry 추가 제한 없음, atomic transaction |
| X07 | forwarded-for 조작·trusted proxy 없는 운영 설정 | 허위 IP로 제한 우회 안 됨, 안전한 설정 실패 |
| X08 | 공개/숨김/삭제와 두 공개 선택·상영 포함의 모든 조합 | SQL의 공개 진리표와 일치 |
| X09 | 두 담당자 동일 version 변경 | 1건만 성공·다음409, 감사 이력과 변경 함께커밋 |
| X10 | published 상태에서 summary 직접 수정 | DB와 API 거절. hide 후 수정·republish 가능 |
| X11 | 담당자 allowlist 비활성화·user_metadata isAdmin 조작 | 다음 관리자 요청 거절, 클라이언트 표시로 권한 안 바뀜 |
| X12 | 브라우저·CDN·Next 캐시·직접 reload | no-store, 숨김 항목이 이전 cache로 재등장 안 함 |
| X13 | offline/hidden 이후 옛 fetch가 늦게 성공 | 예전 응답 무효, 재검증 전 card/pin/list 없음 |
| X14 | 공개 조회30초 실패·60초 경과·복귀 성공 | 60초내 card/pin 제거, 복귀 검증 후 정지 상태 |
| X15 | 플레이어 active public_id 삭제·새 항목·필터 변경 | index 범위·총건수 일치, 다른 항목으로 오해안함 |
| X16 | 지도만 장애·API만 장애 | 지도만 실패는 유효 카드 유지, API 만료는 카드 숨김 |
| X17 | 360/768/1440px·200% 글자·keyboard·ko/en 긴줄 | 가로넘침·막힌초점 없음, 입력·선택 작업 가능 |
| X18 | 같은 cell 의견3건 | 각 의견을 선택·읽기 가능, 임의 유실 없음 |
| X19 | /submit/complete 직접 진입·새 의견시작 | 저장 성공 거짓 표시 없음, 새 시작은 draft·key 초기화 |
| X20 | network payload·URL·DB schema·error/log/analytics 조사 | 원좌표·원문 외부분석·비밀키 노출 없음 |
| X21 | 공개 endpoint의 각 DTO key 검사 | 공개 id/category/location/summary 4종만 |
| X22 | allowed_cells 비어있음·등록 disabled | 실제 수집 안 됨, 503·설정 안내 |
| X23 | 정상 DB query 실패 또는 log insert 실패 | 부분 성공·가짜완료 없음, 실패 rollback |
| X24 | clean npm ci·lint·typecheck·unit/db test·build | 통과, lockfile 버전 고정 |
| X25 | 실제 Supabase Auth·JWT·RLS·PostgREST·secret/public key | 로컬 모형에서만 통과한 권한을 실환경 검증 |
| X26 | 전체 공개snapshot5000건과상한 초과 | 측정된 렌더·조회 성능 기록, 초과 시 명시오류 |

권한·공개 조합·멱등·요약 수정·삭제·신선도에 대한 자동화 테스트를 우선한다. 배포 실환경의 cache·proxy·key·지도 약관 확인은 운영 인계에서 별도로 기록한다.
