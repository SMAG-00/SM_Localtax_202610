import type { Metadata } from "next";
import type { ReactNode } from "react";

// 계정 화면(/account…) — 로그인한 본인만 쓰는 화면이라 검색 노출 차단(noindex), 공개 메뉴에 없다 (W2-e 2.3 · 2.4)
export const metadata: Metadata = {
  title: { default: "내 계정", template: "%s · 내 계정" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-ivory">{children}</div>;
}
