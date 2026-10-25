// 공개 레이아웃의 헤더·바닥글 값 (HOME-02 · HELP-05 · PRD-01A 3장 바닥글) — 순수 함수 (시험 chrome-view.test.ts)
//  · 유틸 메뉴는 화면 틀(getSiteChrome)이 기능 키로 거른 항목만 — 헤더 컴포넌트가 HOME-02 순서로 다시 세운다
//  · 바닥글 링크는 공개 승인된 정책 페이지만 (기능 키 page_*). 개인정보처리방침은 굵게 (HELP-05)
//  · 지금 보는 분야(aria-current)는 주소에서 — 화면 전환에서도 레이아웃은 다시 그려지지 않으므로 브라우저 쪽에서 계산한다
import { HEADER_SECTIONS, HEADER_UTILITIES, type FooterLink, type HeaderNavLink, type HeaderSectionKey, type HeaderUtilityKey } from "@ltr/ui";

/** 바닥글 면책 문구 (PRD-01A 3장 '바닥글 정책 페이지' 골격의 문구) */
export const FOOTER_DISCLAIMER = "이 사이트의 정보는 일반 정보이며 세무 자문이 아닙니다.";

type Link = { key: string; label: string; href: string };

const UTILITY_KEYS = new Set<string>(HEADER_UTILITIES.map((u) => u.key));

/** 화면 틀의 유틸 메뉴 → 헤더가 받는 기능 키 (모르는 키는 버린다) */
export function headerUtilityKeys(utilities: readonly Link[]): HeaderUtilityKey[] {
  return utilities.flatMap((u) => (UTILITY_KEYS.has(u.key) ? [u.key as HeaderUtilityKey] : []));
}

/** 화면 틀의 분야 메뉴 → 헤더 하위 메뉴 (HOME-02 — 분야 데이터의 하위 분야 + 공통 `뉴스 전체`). 모르는 분야 키는 버린다 */
export function headerSubmenus(sections: readonly { key: string; children: readonly Link[] }[]): Partial<Record<HeaderSectionKey, HeaderNavLink[]>> {
  const known = new Set<string>(HEADER_SECTIONS.map((s) => s.key));
  return Object.fromEntries(sections.filter((s) => known.has(s.key)).map((s) => [s.key, s.children.map((c) => ({ key: c.key, label: c.label, href: c.href }))]));
}

/** 화면 틀의 정책 링크 → 바닥글 링크 (개인정보처리방침만 굵게) */
export function footerLinks(policyLinks: readonly Link[]): FooterLink[] {
  return policyLinks.map((p) => ({ label: p.label, href: p.href, ...(p.key === "privacy" ? { emphasis: true } : {}) }));
}

/** 주소 → 지금 보는 4대 분야 (허브와 그 아래 하위 분야 목록). 기사 상세(/news/…)·홈은 분야가 없다 */
export function sectionOfPath(pathname: string | null | undefined): HeaderSectionKey | undefined {
  if (!pathname) return undefined;
  const path = pathname.split(/[?#]/)[0]!;
  return HEADER_SECTIONS.find((s) => path === s.href || path.startsWith(`${s.href}/`))?.key;
}
