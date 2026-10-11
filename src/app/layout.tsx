import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';

export const metadata: Metadata = {
  title: { default: '포항 생활의견 지도', template: '%s · 포항 생활의견 지도' },
  description: '포항에 사는 외국인 주민이 생활 경험과 개선 의견을 장소와 함께 남기는 의견 지도',
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f3449' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
