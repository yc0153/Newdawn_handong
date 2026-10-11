import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import PageHero from '@/components/PageHero';
import SiteFooter from '@/components/SiteFooter';
import MapExplorer from '@/components/MapExplorer';

export const metadata: Metadata = { title: '공개 의견 지도' };

export default function MapPage() {
  return (
    <>
      <SiteHeader active="map" />
      <main className="page">
        <PageHero title="map.title" lead="map.lead" />
        <MapExplorer />
      </main>
      <SiteFooter />
    </>
  );
}
