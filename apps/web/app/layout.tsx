import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brand } from "@ltr/ui";
import { pretendard } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.productName} (개발 중)`,
  // 운영 도메인 전환 전에는 검색 노출을 막는다 (SITE_INDEXING=off). 전환 게이트는 PRD-01A 11장
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
