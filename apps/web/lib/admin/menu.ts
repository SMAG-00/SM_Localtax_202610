// 백오피스 역할별 메뉴 (ADM-01) — 메뉴 항목은 접근 판정 한 함수(lib/access.ts)의 허용 작업에서만 나온다.
// 편집국 외 역할(광고·스토어·브랜드·전문가 담당)에게는 기사 승인·정렬·발행 메뉴가 없고, 편집자에게는 상품·광고·전문가·브랜드 메뉴가 없다.
import { allowedActions, type Action, type Viewer } from "@/lib/access";

export interface MenuItem {
  id: string;
  label: string;
  href: string;
}

interface MenuRule extends MenuItem {
  /** 이 메뉴를 보이는 조건 — 허용 작업 집합으로만 판단한다 */
  when: (actions: ReadonlySet<Action>) => boolean;
  /** 이 메뉴로 치는 화면 주소 앞부분 (지금 보는 메뉴 표시) */
  paths: readonly string[];
}

const RULES: readonly MenuRule[] = [
  { id: "dashboard", label: "첫 화면", href: "/admin", when: () => true, paths: [] },
  { id: "assignments", label: "기사 기획", href: "/admin/stories", when: (a) => a.has("assignment.read"), paths: ["/admin/stories"] },
  { id: "articles", label: "기사", href: "/admin/articles", when: (a) => a.has("article.read"), paths: ["/admin/articles"] },
  {
    id: "reviews",
    label: "검토·발행",
    href: "/admin/reviews",
    when: (a) => a.has("review.desk_edit") || a.has("review.tax_review"),
    paths: ["/admin/reviews"],
  },
  { id: "placement", label: "기사 배치", href: "/admin/placement", when: (a) => a.has("article.sort"), paths: ["/admin/placement"] },
  {
    id: "sponsored",
    label: "광고·협찬 콘텐츠",
    href: "/admin/articles?type=sponsored",
    when: (a) => a.has("sponsored.manage"),
    paths: ["/admin/articles"],
  },
  { id: "store", label: "스토어·구독", href: "/admin/store", when: (a) => a.has("product.manage"), paths: ["/admin/store"] },
  { id: "brand", label: "브랜드 관리", href: "/admin/brand", when: (a) => a.has("brand.manage"), paths: ["/admin/brand"] },
  { id: "experts", label: "전문가 등재", href: "/admin/experts", when: (a) => a.has("expert.manage"), paths: ["/admin/experts"] },
];

/** 기사 승인·정렬·발행 메뉴 — 편집국 외 역할에게 0 (ADM-01 수용 기준) */
export const APPROVE_SORT_PUBLISH_MENU_IDS = ["reviews", "placement"] as const;
/** 상품·광고·전문가 등재·브랜드 관리 메뉴 — 편집자에게 0 (ADM-01 수용 기준) */
export const OPERATIONS_MENU_IDS = ["sponsored", "store", "brand", "experts"] as const;

/** 로그인한 사람의 메뉴 — 순서는 위 목록 순서 */
export function adminMenu(viewer: Viewer): MenuItem[] {
  const actions = new Set(allowedActions(viewer));
  return RULES.filter((r) => r.when(actions)).map(({ id, label, href }) => ({ id, label, href }));
}

/** 지금 보는 화면의 메뉴 id — 첫 화면은 /admin 정확히 일치, 나머지는 주소 앞부분이 가장 긴 것. 없으면 "" */
export function activeMenuId(menu: readonly MenuItem[], pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return menu.some((m) => m.id === "dashboard") ? "dashboard" : "";
  let best = { id: "", length: 0 };
  for (const item of menu) {
    const rule = RULES.find((r) => r.id === item.id);
    for (const prefix of rule?.paths ?? []) {
      const hit = path === prefix || path.startsWith(`${prefix}/`);
      // 같은 길이면 앞 메뉴가 이긴다 — '기사'가 있으면 '기사', 없으면(광고 담당) '광고·협찬 콘텐츠'
      if (hit && prefix.length > best.length) best = { id: item.id, length: prefix.length };
    }
  }
  return best.id;
}
