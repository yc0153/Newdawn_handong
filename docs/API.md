# HTTP API 계약

이 API는 다음 개발 단계에서 구현한다. 현재 최소 프로젝트에 성공 응답을 흉내내는 endpoint는 없다. 기계 판독 계약은 openapi.json이다.

## 공통 규칙

JSON 허용 필드만 수신한다. 오류는 `{ "error": { "code": "...", "message": "...", "field": "optional" } }` 형식이며 내부 SQL·원문을 포함하지 않는다. 상태 코드: 400 형식 오류, 401 미인증, 403 담당자 아님·CSRF, 404 없음, 409 멱등 충돌·버전 충돌·상태 충돌, 422 필드·위치 오류, 429 요청 제한, 503 설정 미완료·DB 장애·공개 상한 초과.

모든 아래 응답 `Cache-Control: no-store`. 관리자·등록 요청은 Same Origin만 허용한다. CORS `*`로 원문 API를 노출하지 않는다. 공개 API와 관리자 API의 DTO·client를 분리한다.

## GET /api/public/opinions

query `mode=browse|player`, 기본 browse. SQL의 공개 조건을 매 요청 평가한 전체 snapshot을 반환한다. 순서는 내부 등록 시각 오름차순 + 내부 id, 공개 응답에는 정렬 필드를 추가하지 않는다. 최대 5000건 초과는 `PUBLIC_DATA_LIMIT` 503으로 처리하고 오래된 사례 숨김 규칙을 적용한다. 초기 운영 규모와 함께 상한을 확정한다.

```json
{
  "data": [{
    "public_id": "b0b8ddf0-67bd-4788-9e9f-742cad846223",
    "category": "transport",
    "location": {"lat": 36.0513, "lon": 129.3917},
    "summary": "담당자가 검토한 공개 요약"
  }]
}
```

위 수치는 계약 설명용 가상 예시다. 제품 seed가 아니다. 0건은 `{"data":[]}`. 원문·내부 id·등록번호·언어·등록일·선택 설정·상영 포함·상태를 추가하지 않는다. 필터는 전체 snapshot의 category에 동일 적용하여 지도·목록을 일치시킨다.

## GET /api/public/config

한·영 작성 안내 버전, grid_version, 허용 cell_x/y 목록, submissions_enabled, test_auto_publish(테스트 모드, 2026-10-19 SQL 적용 전 DB는 false)를 반환한다. 비밀정보·원문은 없다. 격자 계산 상수는 grid_version과 함께 클라이언트 코드에 둔다. 허용 셀은 서버 목록과 일치해야 하며 빈 목록이면 위치 선택·등록을 운영 가능으로 표시하지 않는다. 원문에는 config API가 없으며 이는 서버 허용 지역을 클라이언트와 공유하기 위한 구현 선택이다.

## POST /api/opinions

header `Idempotency-Key: UUID`. 서버는 JSON 최대 8KB를 검사한다. 원좌표·위도·경도는 허용 필드가 아니다.

```json
{
  "grid_version": "pohang-v1",
  "cell_x": 41,
  "cell_y": 28,
  "category": "transport",
  "language": "en",
  "original_text": "A multilingual original opinion.",
  "allow_map": false,
  "allow_player": false,
  "notice_version": "2026-10-06-v1"
}
```

서버 처리: request-size·Origin·필드 허용 목록 → NFC·길이·분야·언어·public setting 검증 → grid version·cell int·허용 지역 → canonical fingerprint·trusted IP HMAC → 서비스 전용 submit RPC 트랜잭션.

응답 201 신규 / 200 같은 키 재시도:

```json
{"reference":"OP-독립된참고번호","message":"의견이 등록되었습니다. 담당자가 확인하기 전에는 공개되지 않습니다.","published":false}
```

`published`는 테스트 모드(`service_settings.test_auto_publish`)가 켜져 있고 작성자가 지도 공개를 고른 새 의견일 때만 true다. 이때 원문 앞 250자(넘치면 249자+…)를 요약으로 바로 공개하고, 플레이어 공개도 골랐으면 상영에도 포함한다. 같은 키 재시도(200)는 `published:false`로 돌려준다.

`reference`만으로 원문·상태를 조회할 endpoint는 없다. 같은 키의 다른 payload는 `IDEMPOTENCY_CONFLICT` 409. 정상 저장 후 삭제된 의견을 같은 키로 재시도해도 다시 만들지 않고 영수증만 반환한다. 키는 임의 UUID일 뿐 데이터 복구·조회권한이 아니다. `SUBMISSIONS_DISABLED` 503, `OUTSIDE_AREA` 422, `INVALID_CONSENT` 422, `TEXT_TOO_SHORT`/`TEXT_TOO_LONG` 422, `RATE_LIMITED` 429를 구분한다. 실패 시 같은 화면에서 입력을 보존한다.

## 관리자 인증

`/admin/login`의 이메일·비밀번호로 Supabase Auth 로그인. 공개 sign-up 없음. SSR cookie를 proxy에서 갱신. API마다 verified user + operator_memberships active 조회를 검사하며 DB RLS도 적용한다. user_metadata·브라우저 isAdmin·단순 로그인 여부를 권한 근거로 삼지 않는다. 계정 비활성화는 DB active=false로 다음 요청부터 차단한다.

## GET /api/admin/opinions

query `status=all|pending|published|hidden`, `page>=1`, `page_size=1..100` 기본 50. deleted_at 있는 항목 제외, created_at 내림차순·id 동률 정렬. 항목: 내부 id, category, language, location 대표점, original_text, allow_map, allow_player, summary, status, include_in_player, version, created_at. 응답 `{data:[],page,page_size,total}`. request_key·fingerprint·rate key는 관리자 UI에도 전달하지 않는다.

## GET /api/admin/opinions/{id}

활성 담당자만 조회. 상세는 위 DTO와 notice_version·최소 작업 이력을 포함한다. 없는/삭제된 의견 404. 원문은 평문으로 렌더링한다. 모든 조회·변경은 담당자용 Supabase JWT client로 실행한다.

## POST /api/admin/opinions/{id}/action

body `{action,expected_version,summary? ,include_in_player?}`. `action`에 따라 허용 필드를 검사한다.

| action | 입력·조건 | 결과 |
| --- | --- | --- |
| save_summary | summary 1..250자·공백만 불가. 현재 published면 거절 | 상태 유지, 요약 저장 |
| publish | allow_map=true·유효 요약·미삭제 | status=published |
| hide | 미삭제 | status=hidden, 상영 즉시 제외 |
| set_player | include_in_player boolean. true면 allow_map·allow_player=true | include_in_player 갱신 |
| delete | 미삭제, 명시적 UI 확인 | deleted_at, original_text=null, summary=null, status=hidden, include_in_player=false |

DB에서 행을 잠그고 expected_version을 확인한다. 실제 변경 시 version+1, 최소 감사 이력 INSERT를 같은 트랜잭션으로 커밋한다. 요약 수정·공개가 분리되어 있어 우연히 원문을 자동 공개하지 않는다. 읽기 시점보다 version이 변했으면 `VERSION_CONFLICT` 409. 실패하거나 이력 기록이 실패하면 변경도 롤백한다.

성공 `{id,status,version,deleted}`. 이미 같은 값인 조치는 no-op으로 기존 version을 유지한다. 비밀 정보·raw payload가 오류에 나오지 않도록 DB 오류→안전한 HTTP 오류 code mapping을 작성한다. HTTP를 거치지 않은 authenticated RPC 호출도 비담당자면 거절해야 한다.

## 테스트 모드 설정 (2026-10-19)

`GET /api/admin/settings` → `{test_auto_publish, test_auto_publish_supported}` (활성 담당자만). `supported=false`는 DB에 2026-10-19 SQL이 아직 없다는 뜻이다.

`POST /api/admin/settings` body `{test_auto_publish: boolean}` → `{test_auto_publish}`. Same Origin·활성 담당자만. DB RPC `admin_set_test_auto_publish`가 함수 안에서 담당자 명단을 다시 확인한다. SQL 미적용이면 `MIGRATION_REQUIRED` 503.

## 로컬 DB 모드 (2026-10-19)

`DATA_BACKEND=local`(또는 Supabase 주소가 없고 Vercel이 아닐 때)이면 위 모든 경로가 같은 계약으로 내장 PGlite DB를 쓴다. `supabase/migrations`를 그대로 적용하므로 RPC·RLS·트리거·오류 코드가 같다. 다른 점은 담당자 로그인뿐이다.

- `POST /api/admin/session` body `{email,password}` → 200 `{ok:true}` + HttpOnly 서명 쿠키(8시간). 실패 401 `INVALID_CREDENTIALS`, 담당자 아님 403. Same Origin만.
- `DELETE /api/admin/session` → 쿠키 삭제.
- Supabase 모드에서는 두 경로 모두 404다(로그인은 브라우저의 Supabase Auth).
- 로컬 모드에서 `APP_ORIGIN`을 비우면 요청을 받은 주소를 Same Origin 기준으로 쓴다.

