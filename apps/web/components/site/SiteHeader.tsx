"use client";

import { Header, type HeaderMenuKey, type HeaderNavLink, type HeaderSectionKey, type HeaderUtilityKey } from "@ltr/ui";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { sectionOfPath } from "@/lib/site/chrome-view";

// 공개 헤더 (HOME-02) — 상단 메뉴 4대 분야(분야마다 하위 메뉴 — 기사 있는 하위 분야 + 뉴스 전체) + 바로 메뉴 4개(PO 2026-11-01) + 공개 승인된 유틸 메뉴. 화면 전환에서는 레이아웃이 다시 그려지지 않으므로
// 지금 보는 분야(aria-current)는 브라우저의 주소에서 계산한다. 로그인 버튼은 회원 화면(W2-e)이 생기면 둔다 — 없는 화면으로 가는 링크 0.
// 바로가기는 헤더에 두지 않는다 - 홈 바로가기 블록만 (PO 2026-10-26)
// '편집위원'(PO 2026-11-18)은 로그인한 편집위원·관리자에게만 — 화면 틀은 공용 캐시라 사람별 값을 넣지 않고, 브라우저가 /api/editorial/access로 확인해 더한다
// (확인 전·실패·권한 없음이면 요소 0. 세금계산기 바로 왼쪽 자리는 HEADER_MENU 순서가 정한다)
export function SiteHeader({
  menu,
  utilities,
  submenus,
}: {
  menu: readonly HeaderMenuKey[];
  utilities: readonly HeaderUtilityKey[];
  submenus: Partial<Record<HeaderSectionKey, HeaderNavLink[]>>;
}) {
  const pathname = usePathname();
  const [editorial, setEditorial] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/editorial/access", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { allowed: false }))
      .then((b: { allowed?: unknown }) => alive && setEditorial(b.allowed === true))
      .catch(() => alive && setEditorial(false));
    return () => {
      alive = false;
    };
  }, []);
  const menuKeys: readonly HeaderMenuKey[] = editorial ? [...menu, "editorial"] : menu;
  return <Header menu={menuKeys} utilities={utilities} submenus={submenus} currentSection={sectionOfPath(pathname)} />;
}
