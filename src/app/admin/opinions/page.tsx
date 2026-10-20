import type { Metadata } from 'next';
import AdminHeader from '@/components/admin/AdminHeader';
import { isLocalBackend } from '@/lib/backend/mode';
import AdminList from '@/components/admin/AdminList';
import AdminGuardMessage from '@/components/admin/AdminGuardMessage';
import { guardAdminPage } from '@/lib/supabase/admin-page';

export const metadata: Metadata = { title: '등록 의견' };

export default async function AdminOpinionsPage() {
  const guard = await guardAdminPage();
  if (!guard.ok) return <AdminGuardMessage status={guard.status} />;
  return (
    <>
      <AdminHeader localAuth={isLocalBackend()} active="list" />
      <main className="admin-main"><AdminList /></main>
    </>
  );
}
