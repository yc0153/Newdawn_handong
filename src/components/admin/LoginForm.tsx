'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError('이메일 또는 비밀번호를 확인해 주세요.'); return; }
      router.replace('/admin/opinions');
      router.refresh();
    } catch {
      setError('지금은 로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card admin-login" onSubmit={submit} noValidate>
      <h1>담당자 로그인</h1>
      <p className="muted">학교가 발급한 개인별 계정으로 로그인합니다. 회원가입은 제공하지 않습니다.</p>
      <div className="field">
        <label htmlFor="a-email">이메일</label>
        <input id="a-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="a-password">비밀번호</label>
        <input id="a-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error ? <p className="state state--error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy || !email || !password}>{busy ? '확인 중…' : '로그인'}</button>
    </form>
  );
}
