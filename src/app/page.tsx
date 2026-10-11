export default function Home() {
  return <main>
    <p className="eyebrow">개발 준비 · Next.js + Supabase</p>
    <h1>포항 생활의견 지도</h1>
    <p className="lead">개발 PRD와 기반 코드가 준비되었습니다.</p>
    <section aria-labelledby="status"><h2 id="status">현재 상태</h2>
      <p>이 화면은 최소 실행 프로젝트입니다. 실제 지도, 의견 등록, 담당자 검토와 플레이어는 다음 개발 단계에서 구현합니다.</p>
      <p>운영 수집 지역과 지도 공급자를 확정하기 전에는 의견 등록을 열지 않습니다.</p>
    </section>
    <section aria-labelledby="next"><h2 id="next">개발 시작</h2>
      <ol><li>AI_START.md의 프롬프트와 이 폴더를 개발 AI에게 전달합니다.</li>
        <li>PRD.md와 docs/TASKS.md 순서로 기능을 구현합니다.</li>
        <li>실제 Supabase 연결과 전체 흐름을 검수합니다.</li></ol>
    </section>
    <a href="https://lip.center">LIP 메인으로</a>
  </main>;
}
