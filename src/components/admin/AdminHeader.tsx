'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AdminHeader({ showLogout = true }: { showLogout?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await createClient().auth.signOut(); } finally {
      router.replace('/admin/login');
      router.refresh();
    }
  }
  return (
    <header className="admin-header">
      <Link href="/admin/opinions" className="admin-header__title">포항 생활의견 지도 · 담당자 검토</Link>
      <nav className="admin-header__nav">
        <a href="/map" target="_blank" rel="noopener">공개 지도 ↗</a>
        <a href="/player" target="_blank" rel="noopener">플레이어 ↗</a>
        {showLogout ? <button type="button" className="btn btn--small" onClick={logout} disabled={busy}>로그아웃</button> : null}
      </nav>
    </header>
  );
}
