import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminDetail from '@/components/admin/AdminDetail';
import AdminGuardMessage from '@/components/admin/AdminGuardMessage';
import { guardAdminPage } from '@/lib/supabase/admin-page';
import { isUuid } from '@/lib/api/http';

export const metadata: Metadata = { title: '의견 검토' };

export default async function AdminOpinionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const guard = await guardAdminPage();
  if (!guard.ok) return <AdminGuardMessage status={guard.status} />;
  return (
    <>
      <AdminHeader />
      <main className="admin-main"><AdminDetail id={id} selfId={guard.userId} /></main>
    </>
  );
}
