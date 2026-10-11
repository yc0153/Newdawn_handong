import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import PageHero from '@/components/PageHero';
import SiteFooter from '@/components/SiteFooter';
import CompleteView from '@/components/CompleteView';

export const metadata: Metadata = { title: '의견 등록 완료' };

export default function CompletePage() {
  return (
    <>
      <SiteHeader active="submit" />
      <main className="page page--narrow">
        <PageHero title="submit.title" lead="submit.lead" />
        <CompleteView />
      </main>
      <SiteFooter />
    </>
  );
}
