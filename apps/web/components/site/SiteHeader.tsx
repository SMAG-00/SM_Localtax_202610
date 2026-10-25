"use client";

import type { MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics/client";
import { Header, type HeaderNavLink, type HeaderSectionKey, type HeaderShortcut, type HeaderUtilityKey } from "@ltr/ui";
import { sectionOfPath } from "@/lib/site/chrome-view";

// 공개 헤더 (HOME-02) — 상단 메뉴 4대 분야(분야마다 하위 메뉴 — 기사 있는 하위 분야 + 뉴스 전체) + 공개 승인된 유틸 메뉴. 화면 전환에서는 레이아웃이 다시 그려지지 않으므로
// 지금 보는 분야(aria-current)는 브라우저의 주소에서 계산한다. 로그인 버튼은 회원 화면(W2-e)이 생기면 둔다 — 없는 화면으로 가는 링크 0.
export function SiteHeader({ utilities, submenus, shortcuts = [] }: { utilities: readonly HeaderUtilityKey[]; submenus: Partial<Record<HeaderSectionKey, HeaderNavLink[]>>; shortcuts?: readonly HeaderShortcut[] }) {
  const pathname = usePathname();
  // 바로가기 줄 클릭 측정 (shortcut_clicked - 위치 header, 개인 정보 없음). 헤더는 서버 부품이라 여기서 위임으로 받는다
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('nav[aria-label="바로가기"] a');
    if (!a) return;
    const key = shortcuts.find((s) => s.href === a.getAttribute("href"))?.key;
    if (key) void track("shortcut_clicked", { props: { placement: "header", shortcut: key }, keepalive: true });
  };
  return (
    <div onClick={onClick}>
      <Header utilities={utilities} submenus={submenus} shortcuts={shortcuts} currentSection={sectionOfPath(pathname)} />
    </div>
  );
}
