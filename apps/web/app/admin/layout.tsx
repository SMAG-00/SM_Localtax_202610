import type { Metadata } from "next";
import type { ReactNode } from "react";

// 백오피스(/admin) — 모든 화면 검색 노출 차단(noindex). AI 도우미 런처를 두지 않는다 (PRD-01A 3장 백오피스 · ADM-01)
export const metadata: Metadata = {
  title: { default: "편집국", template: "%s · 편집국" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-ivory">{children}</div>;
}
