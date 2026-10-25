"use client";

import { Header, type HeaderNavLink, type HeaderSectionKey, type HeaderUtilityKey } from "@ltr/ui";
import { usePathname } from "next/navigation";
import { sectionOfPath } from "@/lib/site/chrome-view";

// 공개 헤더 (HOME-02) — 상단 메뉴 4대 분야(분야마다 하위 메뉴 — 기사 있는 하위 분야 + 뉴스 전체) + 공개 승인된 유틸 메뉴. 화면 전환에서는 레이아웃이 다시 그려지지 않으므로
// 지금 보는 분야(aria-current)는 브라우저의 주소에서 계산한다. 로그인 버튼은 회원 화면(W2-e)이 생기면 둔다 — 없는 화면으로 가는 링크 0.
// 바로가기는 헤더에 두지 않는다 - 홈 바로가기 블록만 (PO 2026-10-26)
export function SiteHeader({ utilities, submenus }: { utilities: readonly HeaderUtilityKey[]; submenus: Partial<Record<HeaderSectionKey, HeaderNavLink[]>> }) {
  const pathname = usePathname();
  return <Header utilities={utilities} submenus={submenus} currentSection={sectionOfPath(pathname)} />;
}
