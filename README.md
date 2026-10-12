# 포항 생활의견 지도 개발 패키지

두 원문 PDF의 요구사항을 Next.js와 Supabase로 구현한 프로젝트다. 2026년 10월 6일 인계 패키지를 바탕으로 2026년 10월 11일 P0 기능 전체(공개 지도, 위치 태그·등록, 담당자 검토, 플레이어, 철회 신선도)를 로컬에서 구현·검수했다.

**현재 상태:** 로컬 구현·검수 완료, 운영 미배포. 검수 결과와 남은 범위는 [docs/VERIFICATION.md](docs/VERIFICATION.md), 로컬 실행은 [docs/SETUP.md](docs/SETUP.md). 실제 운영 전에는 학교의 수집 지역·지도 공급자·담당자·공개 안내·보유기간·도메인 확정과 실제 Supabase 프로젝트 연결 검수가 필요하다([docs/DECISIONS.md](docs/DECISIONS.md)).

| 화면 | 경로 |
| --- | --- |
| 공개 의견 지도(메인 버튼 목적지) | `/map` (`/`, `/?view=browse`) |
| 위치 태그·의견 작성 | `/submit` (`/?view=place`) |
| 등록 완료 | `/submit/complete` |
| 간담회 플레이어 | `/player` (`/?view=player`) |
| 담당자 로그인·검토 | `/admin/login`, `/admin/opinions` |

## 바로 사용하기

1. `npm ci` → `npm run check`로 기반 검사를 통과하는지 확인한다.
2. [설정 안내](docs/SETUP.md)의 ‘로컬에서 전체 흐름 띄우기’대로 로컬 Supabase·테스트 영역·담당자 계정을 만들고 `npm run dev`.
3. 이어서 개발 AI에게 맡길 때는 이 폴더와 [AGENTS.md](AGENTS.md)를 함께 주고, 남은 일은 [VERIFICATION.md](docs/VERIFICATION.md)의 ‘아직 검증하지 않은 범위’부터 시작한다. 비밀키는 채팅에 붙이지 않는다.

## 파일 안내

| 파일 | 용도 |
| --- | --- |
| PRD.md | 제품 목적, 화면, 기능, 데이터 규칙, 공개 조건, 실패 처리 |
| DESIGN.md | 화면 디자인 규칙(lip.center 기준 색·글꼴·컴포넌트). 화면을 고칠 때 먼저 읽는다 |
| AGENTS.md | 개발 AI의 범위와 보안·완료 보고 규칙 |
| AI_START.md | 그대로 전달할 개발 시작 프롬프트 |
| docs/ARCHITECTURE.md | 데이터 흐름, 권한, 약 200m 격자, 신선도 제어 |
| docs/API.md | 요청·응답, 오류, 멱등성, 관리자 동시 수정 |
| docs/openapi.json | 구현할 HTTP API의 기계 판독 계약 |
| docs/ACCEPTANCE.md | 원문 T01~T14와 추가 기술 검수 시나리오 |
| docs/TASKS.md | 의존성을 반영한 구현 순서와 완료 조건 |
| docs/DECISIONS.md | 확정 요구, 개발 기본값, 학교와 확정할 운영 항목 |
| docs/SOURCE_MAP.md | 원문 페이지와 요구사항의 대응, 원본 해시 |
| docs/SETUP.md | 로컬·클라우드 환경 준비와 출시 전 확인 |
| docs/VERIFICATION.md | 실제 검증 결과와 남은 범위 |
| tests/ | 단위·DB(PGlite)·연결(실스택)·브라우저 E2E 검수 |
| scripts/create-local-operator.mjs | 로컬 전용 담당자 계정 생성 |
| supabase/migrations/ | CLI가 생성한 초기 마이그레이션 |
| src/lib/domain/ | 입력 검증, 격자화, 플레이어 신선도 공통 함수 |
| src/lib/supabase/ | 브라우저·서버·관리자 인증 연결 기반 |
| reference/ | 원문 PDF의 변경하지 않은 복사본 |

실제 의견처럼 보이는 예시 데이터는 넣지 않았다(`supabase/seed.sql`은 비어 있고, `supabase/dev/local_dev_setup.sql`은 로컬 테스트 영역만 연다). 클라우드 프로젝트 생성, 배포, 기존 lip.center 변경은 하지 않았다.
