import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Proposal Builder',
  description: '전시/브랜드 체험관 제안서를 자동 생성하는 MVP',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
