import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AdminHeader from '@/components/admin/AdminHeader';
import { isLocalBackend } from '@/lib/backend/mode';
import LoginForm from '@/components/admin/LoginForm';
import { operatorStatus } from '@/lib/backend/operator';

export const metadata: Metadata = { title: '로그인' };

export default async function LoginPage() {
  if ((await operatorStatus()) === 'ok') redirect('/admin');
  return (
    <>
      <AdminHeader showLogout={false} localAuth={isLocalBackend()} />
      <main className="admin-main admin-main--narrow">
        <LoginForm localAuth={isLocalBackend()} />
      </main>
    </>
  );
}
