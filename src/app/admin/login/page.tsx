import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AdminHeader from '@/components/admin/AdminHeader';
import LoginForm from '@/components/admin/LoginForm';
import { operatorStatus } from '@/lib/supabase/operator';

export const metadata: Metadata = { title: '로그인' };

export default async function LoginPage() {
  if ((await operatorStatus()) === 'ok') redirect('/admin/opinions');
  return (
    <>
      <AdminHeader showLogout={false} />
      <main className="admin-main admin-main--narrow">
        <LoginForm />
      </main>
    </>
  );
}
