import { brand } from "../../brand";
import { UiLink } from "../link";
import { HeaderNav, type HeaderNavLink } from "./HeaderNav";

/** 4대 분야 `section` 값 (PRD-01A ART-01) */
export type HeaderSectionKey = "tax" | "realestate" | "finance" | "local";
/** 유틸 메뉴 항목 */
export type HeaderUtilityKey = "calc" | "experts" | "store" | "edu" | "search";

/** 상단 메뉴 — 정확히 4개, 이 순서 (PRD_최종 §4.1, HOME-02) */
export const HEADER_SECTIONS: ReadonlyArray<{ key: HeaderSectionKey; label: string; href: string }> = [
  { key: "tax", label: "지방세·부동산세금", href: "/tax" },
  { key: "realestate", label: "부동산재테크", href: "/realestate" },
  { key: "finance", label: "부동산금융", href: "/finance" },
  { key: "local", label: "지자체뉴스", href: "/local" },
];

/** 유틸 메뉴 — 공개 승인된 항목만 이 순서로 최대 5개 (HOME-02) */
export const HEADER_UTILITIES: ReadonlyArray<{ key: HeaderUtilityKey; label: string; href: string }> = [
  { key: "calc", label: "계산기", href: "/calc" },
  { key: "experts", label: "전문가 소개", href: "/experts" },
  { key: "store", label: "구독·도서", href: "/store" },
  { key: "edu", label: "교육", href: "/edu" },
  { key: "search", label: "검색", href: "/search" },
];

export type HeaderProps = {
  /** 유틸 메뉴 자리 — 기능 플래그가 켜진(공개 승인된) 항목. 넘긴 순서와 상관없이 HOME-02 순서로 보이고, 없으면 유틸 메뉴 요소 0 */
  utilities?: readonly HeaderUtilityKey[];
  /** 지금 보고 있는 분야 — aria-current="page" */
  currentSection?: HeaderSectionKey;
  /**
   * 분야별 하위 메뉴 — 분야 데이터(CAT-01)에서 만든 하위 분야 + 공통 `뉴스 전체` (HOME-02). 주는 쪽(공개 화면 틀)이 기사 있는 하위 분야만 넘긴다.
   * 없거나 빈 분야는 펼침 단추 요소 0
   */
  submenus?: Partial<Record<HeaderSectionKey, readonly HeaderNavLink[]>>;
  /** 작은 로그인 버튼 — 주 버튼 컴포넌트가 아니다 (R2 계수 제외) */
  account?: { label: string; href: string };
};

/**
 * 헤더 — SM 헤더 그대로 (PRD-00 8.6): bg-navy-800 · 텍스트 워드마크(17px 800 흰 글자 + 오렌지 가운뎃점) · 링크 14px 600 navy-100 ·
 * 버튼 rounded-lg hermes-500 + navy-900 굵은 글자. 유틸 메뉴 자리를 더했다 (DS-02). 회사·정책 링크와 AI 도우미는 헤더에 두지 않는다 (HELP-05·HOME-02).
 * 화면 순서: 워드마크 → 분야 메뉴 → 유틸 메뉴 → 계정 버튼 (모바일은 워드마크 · 계정 버튼 · [메뉴] 한 줄, 그 아래 펼친 메뉴).
 */
export function Header({ utilities = [], currentSection, account, submenus = {} }: HeaderProps) {
  const enabled = new Set(utilities);
  const utilityLinks = HEADER_UTILITIES.filter((u) => enabled.has(u.key));
  const sections = HEADER_SECTIONS.map((s) => ({ ...s, children: submenus[s.key] ?? [] }));
  return (
    <header data-ui="header" className="bg-navy-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 px-4 py-2">
        <UiLink
          href="/"
          className="order-1 mr-auto inline-flex min-h-11 items-center text-[17px] font-extrabold tracking-tight text-white transition hover:text-hermes-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:mr-4"
        >
          {/* 워드마크 — 앞 낱말과 뒤 낱말을 띄어쓰기 하나로 잇는다 (가운뎃점 없음) */}
          {brand.wordmark.lead} {brand.wordmark.tail}
        </UiLink>
        <HeaderNav sections={sections} utilities={utilityLinks} currentSection={currentSection} />
        {account && (
          <UiLink
            href={account.href}
            className="order-2 inline-flex min-h-11 items-center rounded-lg bg-hermes-500 px-4 text-[14px] font-bold text-navy-900 transition hover:bg-hermes-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:order-3 lg:ml-3"
          >
            {account.label}
          </UiLink>
        )}
      </div>
    </header>
  );
}
