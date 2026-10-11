import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import PageHero from '@/components/PageHero';
import SiteFooter from '@/components/SiteFooter';
import SubmitFlow from '@/components/SubmitFlow';

export const metadata: Metadata = { title: '의견 남기기' };

export default function SubmitPage() {
  return (
    <>
      <SiteHeader active="submit" />
      <main className="page">
        <PageHero title="submit.title" lead="submit.lead" />
        <SubmitFlow />
      </main>
      <SiteFooter />
    </>
  );
}
