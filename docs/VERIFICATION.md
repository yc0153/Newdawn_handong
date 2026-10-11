# 개발 패키지 검증 결과

검증일 2026년 10월 6일. 제품 기능은 구현 전이다.

## 통과한 확인

- 원문 제안서8쪽·PRD5쪽을 추출하고 화면 시안을 렌더링하여 검토했다. 복사본 SHA-256이 원본과 일치한다.
- 원문 M01/M02/S01/S02/S03/A01/A02/P01과 T01~T14를 PRD·검수표에 반영했다. 개발 기본값과 운영 미정은 별도로 기록했다.
- Node.js22.18.0에서 정확한 버전과 lockfile로 npm ci 성공.
- ESLint10.12.0 + Next 공식 lint plugin + TypeScript ESLint 조합으로 lint 통과.
- next typegen + TypeScript 검사 통과. 빌드 전에도 경로 타입을 생성한다.
- 도메인 테스트6개 통과: 다국어 글자수·공백·NFC, 동의 종속·필드허용, 격자 round-trip/간격, 요약길이, 신선도경계, player index.
- 격리된 PGlite DB 테스트4개 통과: SQL 생성, RLS·grants·비담당자 차단, 등록비활성·설정없음 차단, 길이·동의·위치, 대표점 JS/SQL 일치, 승인/상영/숨김/삭제, 최소이력, 멱등재시도·body충돌·삭제후재시도, 버전충돌, 10분/일일 제한과 rollback, Unicode 공백의 JS/SQL 일치.
- Next.js16.3.8 최적화 빌드 통과. 최소 실행 화면을 로컬 서버·브라우저에서 확인했다.
- OpenAPI JSON 파싱·로컬 component reference 해석 확인. 별도 OpenAPI 규격 validator를 실행했다는 뜻은 아니다.
- 로컬 Markdown 링크와 ZIP 무결성 확인. ZIP에 node_modules·빌드캐시·실제 환경변수·비밀키를 포함하지 않는다.

## 아직 구현하거나 검증하지 않은 범위

실제 지도 공급자 연결, 공개 탐색·작성·완료 UI, HTTP API, 담당자 로그인·목록·상세, 플레이어와 polling/Abort 제어, 전체 T01~T14 연결 검수는 다음 개발 단계다. 신선도 순수함수 테스트가 실제 브라우저의 철회 반영을 증명하지 않는다.

PGlite는 Supabase 역할과 auth.uid를 모형화했다. 실제 Supabase Auth·JWT·PostgREST·secret/public key·RLS advisor·다중 요청의 네트워크 동시성은 확인하지 않았다. 로컬/개발 Supabase에 migration을 적용한 뒤 반드시 재검증한다. 클라우드 프로젝트를 만들거나 원격 DB를 변경하거나 배포하지 않았다.

실제 수집 지역, 지도 공급자·사용 조건, 운영 계정, 안내·보유기간, 도메인·학교 연결 방식은 운영 전에 확정한다. allowed_cells는 비어 있고 submissions_enabled는 false다.
