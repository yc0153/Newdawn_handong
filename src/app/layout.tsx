import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'포항 생활의견 지도 개발 준비',description:'개발 인계 패키지의 최소 실행 프로젝트'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>;
}
