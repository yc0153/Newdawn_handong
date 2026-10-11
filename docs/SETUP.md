# 개발 환경과 운영 설정

## 1 설치와 최소 실행

이 패키지는 Node.js 22.13 이상인 22 LTS 또는 24 이상을 사용한다. Next.js 자체의 최소 버전은20.9이지만 이 패키지의 ESLint10도 함께 고려한 조건이다. 패키지 버전은 package.json과 package-lock.json으로 고정했다.

```bash
npm ci
npm run check
npm run dev
```

`/`는 `/map`으로 이동한다(`?view=browse|place|player`는 각각 `/map`·`/submit`·`/player`). `check`는 lint·typecheck·unit·db test·build를 실행한다. DB 검증은 격리된 PGlite PostgreSQL로 Supabase role/auth 구조를 모형화하며 실제 Supabase 네트워크 호출은 하지 않는다.

### 가장 빠른 로컬 실행 (Windows·macOS 공통)

준비: Node.js 22 LTS(22.13 이상) 또는 24, Docker Desktop(Windows는 WSL2 사용 설정). Docker Desktop을 켜 둔다.

```bash
npm ci
npm run local:setup      # 로컬 Supabase 시작 → .env.local 작성 → 테스트 영역 열기 → 담당자 계정 생성
npm run dev              # http://localhost:3000
```

- `local:setup`이 마지막에 담당자 이메일·비밀번호를 출력한다(기본 `admin@local.test`). 원하는 계정: `npm run local:setup -- 이메일 비밀번호`.
- 처음 실행은 Supabase 이미지 내려받기로 몇 분 걸린다. 다 쓴 뒤 끄기: `npx supabase stop`.
- 개발 서버는 지도 설정이 비어 있으면 OSM 지도를 개발용으로 표시한다.
- Windows PowerShell에서 `npm.ps1 ... 스크립트를 실행할 수 없으므로` 오류가 나면 `npm.cmd ci`처럼 `npm.cmd`로 실행하거나 명령 프롬프트(cmd)를 쓴다.
- 이 스크립트의 Supabase 시작 단계(1~3)는 Docker 이미지 저장소에 접근할 수 없는 검수 환경에서 실행해 보지 못했다. 4~5단계는 로컬 동등 스택에서 확인했다.

### 로컬에서 전체 흐름 띄우기

1. Docker와 Supabase CLI를 준비하고 `supabase start` → `supabase db reset --local`로 마이그레이션 3개를 적용한다.
2. **로컬 전용 테스트 영역**을 연다: `psql "<로컬 DB URL>" -f supabase/dev/local_dev_setup.sql`. 포항 시내 일부 사각형을 허용 셀로 넣고 등록을 켠다. 실제 수집 지역이 아니며 운영 DB에 실행하지 않는다. 의견 데이터는 넣지 않는다.
3. `.env.local`에 `supabase status`의 API URL·publishable key·secret key와 `RATE_LIMIT_HMAC_SECRET`(32자 이상)을 넣는다. 헤더에 환경 이름을 보이려면 `NEXT_PUBLIC_ENV_LABEL=로컬 개발`.
4. 로컬 담당자 계정: `npm run operator:local -- 이메일 비밀번호` (localhost Supabase에서만 실행됨).
5. `npm run dev` → `http://localhost:3000`. 담당자 화면은 `/admin/login`.

`next dev`에서 지도 공급자 변수가 비어 있으면 OSM 표준 타일을 **개발용**으로 쓰고 화면에 ‘개발용 지도 타일’을 표시한다. 운영 빌드에서는 공급자 변수가 없으면 지도 대신 안내와 목록을 보여준다.

### 검수 명령

| 명령 | 필요한 것 |
| --- | --- |
| `npm run test:unit`, `npm run test:db` | 없음 |
| `npm run test:integration` | 로컬 Supabase + 실행 중인 Next 서버. 서버와 테스트 모두 `TRUSTED_CLIENT_IP_HEADER=x-test-client-ip`로 실행(테스트마다 다른 클라이언트로 보이게 함) |
| `npm run test:e2e` | 위와 같음 + 검수용 타일 서버 `npm run tiles:test` + `.env.local`에 `NEXT_PUBLIC_MAP_TILE_URL=http://127.0.0.1:8099/{z}/{x}/{y}.svg`, `NEXT_PUBLIC_MAP_ATTRIBUTION=검수용 테스트 타일` 후 빌드 |

연결·E2E 테스트는 로컬 DB에 `[연결검수]`·`[E2E]` 표시가 붙은 검수 데이터를 남긴다. 다시 깨끗하게 하려면 `supabase db reset --local`.

## 2 환경 변수

`.env.example`을 `.env.local`로 복사하고 로컬·개발 Supabase 값만 채운다. 공개 URL·publishable key는 브라우저에서 쓸 수 있고 secret key는 서버에서만 쓴다. secret key·rate secret은 채팅·Git·공개 파일에 넣지 않는다.

| 변수 | 용도 | 운영 전 조건 |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 프로젝트 API URL | 해당 프로젝트 확인 |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 담당자 Auth·JWT client | secret를 넣지 않음 |
| SUPABASE_SECRET_KEY | 공개 read/submit RPC server-only | 실제 호스트의 비밀 환경 변수 |
| APP_ORIGIN | Same Origin POST검사 | 배포 도메인과 일치 |
| RATE_LIMIT_HMAC_SECRET | 일일 IP 제한 HMAC | 충분한 길이의 임의 값 |
| TRUSTED_CLIENT_IP_HEADER | 플랫폼이 보장한 client IP header | 헤더명과 신뢰 proxy 동작을 직접 검증 |
| NEXT_PUBLIC_MAP_TILE_URL | 확정 지도 공급자 타일 URL | Leaflet provider에 해당할 때만 사용 |
| NEXT_PUBLIC_MAP_ATTRIBUTION | 지도 출처 | 공급자 약관에 맞춰 표시 |
| NEXT_PUBLIC_ENV_LABEL | 헤더의 환경 표시(선택) | 운영에서는 비움 |
| NEXT_PUBLIC_AREA_LABEL | 화면의 수집 지역 이름(선택) | 학교 확정 후 입력 |
| ALLOWED_FRAME_ANCESTORS | iframe 삽입 허용 출처(빌드 시 반영) | 학교 사이트 출처만 |
| API_ACCESS_LOG | on이면 경로·상태·시간·오류코드만 기록 | 본문·원문·좌표는 기록하지 않음 |

지도 SDK 공급자로 바꾸면 adapter 전용 변수를 추가한다. 지도 public key는 허용 origin/domain 제한을 설정한다. APP_ORIGIN localhost 값은 운영 도메인으로 승격하지 않는다.

## 3 로컬 Supabase

로컬 Supabase를 사용하려면 Docker와 CLI가 필요하다. 생성된 supabase/config.toml에서 port·프로젝트 ID·Auth 설정을 확인한다. config는 CLI 2.118.0이 생성했다.

```bash
supabase --help
supabase start --help
supabase start
supabase db reset --help
supabase db reset --local
```

`db reset --local`은 이 프로젝트의 로컬 DB를 초기화한다. 보존해야 하는 로컬 데이터가 있으면 먼저 dump한다. 원격 DB에 reset하지 않는다. 실제 migrations 적용 이후 SQL 테스트와 Supabase Auth·JWT·RLS·PostgREST의 연결검수를 진행한다. CLI 버전별 명령은 --help를 우선한다.

초기 SQL은 CLI `migration new pohang_initial`로 생성한 파일이다. 실제 DB에서 구조를 반복 수정할 때는 execute SQL → 검증·advisors → db pull/diff로 정리하고 migration history를 중복 기록하지 않는다.

타입 생성은 명령 help 확인 후 수행한다.

```bash
supabase gen types typescript --help
supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

초기 패키지에는 생성 타입이라고 가장한 수동 DB 타입을 넣지 않았다. API·domain 타입은 직접 정의했다.

## 4 실제 클라우드 연결

사용자가 프로젝트 생성·연결을 명시 요청하면 조직·프로젝트·리전·비용을 확정한다. 기존 프로젝트에 이 패키지를 임의 적용하지 않는다. 개발·운영 프로젝트를 분리하고 먼저 개발환경에서 migration·RLS를 검증한다.

Supabase 설정:

- public signup false, anonymous sign-in false. 담당자 개인별 계정만 운영자가 발급.
- Auth Site URL·허용 redirect URL을 실제 Next 주소로 설정. 불필요 wildcard 제거.
- 활성 담당자의 user_id를 operator_memberships에 운영자 권한으로 등록. 앱의 role 편집 UI는 없음.
- Data API exposed schemas에 private를 추가하지 않음. public RPC grants와 RLS를 검토.
- 실제 허용 지역을 allowed_cells로 입력. 학교가 안내·보유기간을 확정하고 submissions_enabled를 true로 전환.
- 현재 notice_version을 서비스 설정과 일치시킴.
- 만료 rate bucket48시간 정리와 보유기간에 따른 파기를 운영 스케줄로 구성. raw payload 백업·로그 접근도 제한.
- Auth 계정 비활성화 시 active=false로 권한 먼저 철회. JWT만으로 권한을 캐시하지 않음.
- advisors 확인, anon·authenticated·operator allow/deny와 secret/public key 동작 검수.

## 5 학교 사이트 연결

최종 `https://배포도메인/map`, `/submit`, `/player`와 query alias를 검증한다. 메인 오른쪽 버튼은 /map이 목적지다. LIP 링크는 기존 메인으로 돌아간다. iframe이면 학교 origin만 frame-ancestors에 허용하고 관리자 화면은 삽입을 막는다. 기본은 독립 링크이며 기존 학교 사이트 자체를 수정하지 않는다.

## 6 출시 확인

학교의 지역·담당자·공개 안내·보유기간·지도 이용 조건·연결방식 확정, 실제 Supabase 연결검수, ACCEPTANCE 통과, 모바일·한영·접근성 검수, 키·로그·cache·빈도제한·철회 검수 후 수집을 시작한다. 비용·규모 수치는 원문에 없으므로 임의 운영 성과나 예상 SLA로 적지 않는다.
