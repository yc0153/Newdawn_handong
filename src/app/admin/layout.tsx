import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: '담당자 검토', template: '%s · 담당자 검토' }, robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin" lang="ko">{children}</div>;
}
