"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LinkProvider, type UiLinkProps } from "@ltr/ui";

/**
 * 공개 화면의 사이트 안 링크 — Next.js 링크로 새로고침 없는 화면 전환 (FND-09). 외부 링크·새 창은 @ltr/ui UiLink가 보통의 a 요소로 둔다.
 * 미리 받기(prefetch)는 끈다 — 공개 화면은 모두 요청 때 그리는 화면이라 미리 받을 수 있는 것이 경로 모양뿐이고,
 * 화면에 보이는 링크마다 서버 요청이 생긴다. 누르면 그때 받아 화면을 바꾼다 (설계 9장 #19).
 */
function SiteLink(props: UiLinkProps) {
  return <Link prefetch={false} {...props} />;
}

// 공개 레이아웃에만 둔다 — 견본(/_design)·백오피스(/admin)는 이 틀 밖이다.
export function SiteLinkProvider({ children }: { children: ReactNode }) {
  return <LinkProvider component={SiteLink}>{children}</LinkProvider>;
}
