import type { Metadata } from 'next';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminOverview from '@/components/admin/AdminOverview';
import AdminGuardMessage from '@/components/admin/AdminGuardMessage';
import { guardAdminPage } from '@/lib/supabase/admin-page';
import { isLocalBackend } from '@/lib/backend/mode';

export const metadata: Metadata = { title: '전체 현황' };

/** 담당자 첫 화면. 공개 화면과 분리된 경로(/admin)에서 전체 의견 현황을 본다. */
export default async function AdminHome() {
  const guard = await guardAdminPage();
  if (!guard.ok) return <AdminGuardMessage status={guard.status} />;
  return (
    <>
      <AdminHeader localAuth={isLocalBackend()} active="overview" />
      <main className="admin-main"><AdminOverview /></main>
    </>
  );
}
