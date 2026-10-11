# 포항 생활의견 지도 개발 패키지

2026년 10월 6일. 두 원문 PDF의 요구사항을 Next.js와 Supabase로 구현하기 위한 로컬 개발 인계 패키지다. 제품 기능은 개발 전이며, 이 패키지에는 PRD, 기술 설계, 초기 DB 마이그레이션, 최소 실행 프로젝트와 검수 기준이 들어 있다.

## 바로 사용하기

1. 이 폴더를 새 개발 작업공간으로 복사하거나 ZIP을 해제한다.
2. 개발 AI에게 [AI_START.md](AI_START.md)의 시작 프롬프트를 전달한다. 이 폴더 전체를 함께 제공한다.
3. AI는 [PRD.md](PRD.md), [기술 설계](docs/ARCHITECTURE.md), [API 계약](docs/API.md), [작업 순서](docs/TASKS.md)를 읽고 순서대로 구현한다.
4. 로컬 실행과 실제 Supabase 연결은 [설정 안내](docs/SETUP.md)를 따른다. 비밀키는 채팅에 붙이지 않는다.

## 파일 안내

| 파일 | 용도 |
| --- | --- |
| PRD.md | 제품 목적, 화면, 기능, 데이터 규칙, 공개 조건, 실패 처리 |
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
| docs/VERIFICATION.md | 이 패키지의 실제 검증 결과와 남은 범위 |
| supabase/migrations/ | CLI가 생성한 초기 마이그레이션 |
| src/lib/domain/ | 입력 검증, 격자화, 플레이어 신선도 공통 함수 |
| src/lib/supabase/ | 브라우저·서버·관리자 인증 연결 기반 |
| reference/ | 원문 PDF의 변경하지 않은 복사본 |

최소 프로젝트는 설정 안내 화면만 제공한다. 지도 UI, 의견 API, 운영 화면, 플레이어는 아직 구현하지 않았다. 미구현 기능을 성공 처리하는 API나 실제 의견처럼 보이는 예시 데이터는 넣지 않았다. 클라우드 프로젝트 생성, 배포, 기존 lip.center 변경은 이 패키지 제작에 포함하지 않는다.
