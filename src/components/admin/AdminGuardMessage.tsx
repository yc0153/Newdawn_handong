import AdminHeader from './AdminHeader';

export default function AdminGuardMessage({ status }: { status: 'forbidden' | 'unavailable' }) {
  return (
    <>
      <AdminHeader />
      <main className="admin-main admin-main--narrow">
        <section className="card">
          <h1>{status === 'forbidden' ? '담당자 권한이 없습니다.' : '지금은 확인할 수 없습니다.'}</h1>
          <p className="muted">
            {status === 'forbidden'
              ? '활성 담당자 명단에 있는 계정만 원문을 볼 수 있습니다. 권한이 필요하면 운영 책임자에게 요청하세요.'
              : '서비스 설정 또는 연결을 확인한 뒤 다시 시도해 주세요.'}
          </p>
        </section>
      </main>
    </>
  );
}
