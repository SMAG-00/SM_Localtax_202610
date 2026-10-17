// 역할별 메뉴 시험 (ADM-01 · PRD-00 6장 운영 역할 분리) — 기대 메뉴는 PRD 수용 기준을 옮긴 표이고, 구현에서 계산하지 않는다.
//  · 편집국 외 역할 4종의 화면에 기사 승인·정렬(·발행) 메뉴 0
//  · 편집자 화면에 상품·광고·전문가 등재·브랜드 관리 편집 메뉴 0
import { describe, expect, test } from "vitest";
import type { StaffRole, Viewer } from "@/lib/access";
import { APPROVE_SORT_PUBLISH_MENU_IDS, OPERATIONS_MENU_IDS, activeMenuId, adminMenu } from "./menu";

const viewer = (roles: StaffRole[], isAdmin = false): Viewer => ({ userId: "u-1", email: "staff@example.test", isAdmin, roles });
const ids = (v: Viewer) => adminMenu(v).map((m) => m.id);

const EXPECTED: [string, Viewer, string[]][] = [
  ["기자", viewer(["reporter"]), ["dashboard", "assignments", "articles"]],
  ["편집 책임자", viewer(["editor"]), ["dashboard", "assignments", "articles", "reviews", "placement"]],
  ["편집 책임자 + 기자", viewer(["editor", "reporter"]), ["dashboard", "assignments", "articles", "reviews", "placement"]],
  ["세무 감수위원", viewer(["reviewer"]), ["dashboard", "articles", "reviews"]],
  ["광고·협찬 담당", viewer(["ad_ops"]), ["dashboard", "sponsored"]],
  ["스토어·구독 담당", viewer(["store_ops"]), ["dashboard", "store"]],
  ["브랜드 관리 담당", viewer(["brand_ops"]), ["dashboard", "brand"]],
  ["전문가 담당", viewer(["expert_ops"]), ["dashboard", "experts"]],
  ["관리자(역할 없음) — 편집 행위 메뉴 없음", viewer([], true), ["dashboard", "assignments", "articles", "sponsored", "store", "brand", "experts"]],
  ["역할 없음", viewer([]), ["dashboard"]],
];

describe("역할별 메뉴 (ADM-01)", () => {
  test.each(EXPECTED)("%s", (_name, v, expected) => {
    expect(ids(v)).toEqual(expected);
  });

  test("편집국 외 역할 4종 — 승인·정렬·발행 메뉴 0", () => {
    for (const role of ["ad_ops", "store_ops", "brand_ops", "expert_ops"] as const) {
      const menu = ids(viewer([role]));
      for (const id of APPROVE_SORT_PUBLISH_MENU_IDS) expect(menu).not.toContain(id);
    }
  });

  test("편집자 — 상품·광고·전문가·브랜드 메뉴 0", () => {
    for (const roles of [["editor"], ["editor", "reporter"], ["editor", "reviewer"]] as StaffRole[][]) {
      const menu = ids(viewer(roles));
      for (const id of OPERATIONS_MENU_IDS) expect(menu).not.toContain(id);
    }
  });

  test("메뉴 주소는 모두 /admin 아래이고 이름이 겹치지 않는다", () => {
    const all = adminMenu(viewer([], true)).concat(adminMenu(viewer(["editor"])));
    for (const m of all) expect(m.href.startsWith("/admin")).toBe(true);
    const admin = adminMenu(viewer([], true));
    expect(new Set(admin.map((m) => m.label)).size).toBe(admin.length);
  });
});

describe("지금 보는 메뉴 (aria-current)", () => {
  const menu = adminMenu(viewer(["editor"]));
  test.each([
    ["/admin", "dashboard"],
    ["/admin/articles", "articles"],
    ["/admin/articles/12", "articles"],
    ["/admin/articles/new", "articles"],
    ["/admin/reviews/3", "reviews"],
    ["/admin/stories", "assignments"],
    ["/admin/placement", "placement"],
    ["/admin/unknown", ""],
  ])("%s → %s", (path, expected) => {
    expect(activeMenuId(menu, path)).toBe(expected);
  });

  test("광고 담당의 기사 화면은 '광고·협찬 콘텐츠' 메뉴", () => {
    expect(activeMenuId(adminMenu(viewer(["ad_ops"])), "/admin/articles/9")).toBe("sponsored");
  });
});
