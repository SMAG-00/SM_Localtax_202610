// 역할별 메뉴 시험 (ADM-01 · PRD-00 6장 운영 역할 분리) — 기대 메뉴는 PRD 수용 기준을 옮긴 표이고, 구현에서 계산하지 않는다.
//  · 편집국 외 역할 4종의 화면에 기사 승인·정렬(·발행) 메뉴 0
//  · 편집자 화면에 상품·광고·전문가 등재·브랜드 관리 편집 메뉴 0
import { describe, expect, test } from "vitest";
import type { StaffRole, Viewer } from "@/lib/access";
import {
  ADMIN_MENU_IDS,
  ALL_MENU_IDS,
  DAILY_MENU_IDS,
  APPROVE_SORT_PUBLISH_MENU_IDS,
  MENU_GROUPS,
  OPERATIONS_MENU_IDS,
  activeMenuId,
  adminDailyMenu,
  adminMenu,
  adminMenuGroups,
  groupOfMenuId,
} from "./menu";

const viewer = (roles: StaffRole[], isAdmin = false): Viewer => ({ userId: "u-1", email: "staff@example.test", isAdmin, roles });
const ids = (v: Viewer) => adminMenu(v).map((m) => m.id);

const EXPECTED: [string, Viewer, string[]][] = [
  ["기자", viewer(["reporter"]), ["dashboard", "assignments", "articles", "realestate-weekly", "situations", "media", "inquiries"]],
  [
    "편집 책임자 — 분야·사전 편집 메뉴·제휴 준비, 제휴사는 편집 메뉴 아님(목록 화면만 읽기)",
    viewer(["editor"]),
    ["dashboard", "assignments", "articles", "reviews", "placement", "home", "amendments", "links", "calc-links", "campaigns", "realestate-weekly", "hub-points", "source-review", "review", "brief", "guides", "ordinances", "issues", "issue-tags", "ai-desk", "stats", "channels", "library", "reports", "regions", "projects", "supply", "dev-methods", "finance", "local-news", "situations", "media", "categories", "dictionaries", "query-terms", "qna", "solved-cases", "readiness", "seo", "inquiries", "pages"],
  ],
  ["편집 책임자 + 기자", viewer(["editor", "reporter"]), ["dashboard", "assignments", "articles", "reviews", "placement", "home", "amendments", "links", "calc-links", "campaigns", "realestate-weekly", "hub-points", "source-review", "review", "brief", "guides", "ordinances", "issues", "issue-tags", "ai-desk", "stats", "channels", "library", "reports", "regions", "projects", "supply", "dev-methods", "finance", "local-news", "situations", "media", "categories", "dictionaries", "query-terms", "qna", "solved-cases", "readiness", "seo", "inquiries", "pages"]],
  ["세무 감수위원 — 상황 카드·허브 지방세 포인트·단계 「지방세로 읽기」는 감수 서명만", viewer(["reviewer"]), ["dashboard", "articles", "reviews", "hub-points", "guides", "ordinances", "issues", "rulesets", "national-calc", "accuracy", "eval", "quality", "project-lenses", "dev-methods", "finance", "situations"]],
  ["광고·협찬 담당 — 제휴사 관리", viewer(["ad_ops"]), ["dashboard", "campaigns", "sponsored", "partners", "inquiries", "pages"]],
  ["스토어·구독 담당", viewer(["store_ops"]), ["dashboard", "orgs", "store", "inquiries"]],
  ["브랜드 관리 담당", viewer(["brand_ops"]), ["dashboard", "brand"]],
  ["전문가 담당", viewer(["expert_ops"]), ["dashboard", "experts"]],
  [
    "관리자(역할 없음) — 편집 행위 메뉴 없음, 원문 검수·측정 지표·제휴 준비·설정·회원·역할",
    viewer([], true),
    ["dashboard", "assignments", "articles", "campaigns", "realestate-weekly", "source-review", "review", "brief", "pipelines", "guides", "ordinances", "issues", "issue-tags", "ai-desk", "stats", "channels", "library", "security", "feeds", "licenses", "orgs", "reports", "rulesets", "national-calc", "accuracy", "eval", "quality", "regions", "projects", "supply", "dev-methods", "finance", "local-news", "situations", "media", "people", "categories", "dictionaries", "query-terms", "sponsored", "partners", "store", "brand", "experts", "qna", "solved-cases", "metrics", "readiness", "seo", "inquiries", "pages", "settings", "members"],
  ],
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

  test("관리자만 — 측정 지표·설정·회원·역할 메뉴 (편집 책임자·편집국 외 역할 0)", () => {
    for (const roles of [["editor"], ["reporter"], ["reviewer"], ["ad_ops"], ["store_ops"], ["brand_ops"], ["expert_ops"]] as StaffRole[][]) {
      const menu = ids(viewer(roles));
      for (const id of ADMIN_MENU_IDS) expect(menu).not.toContain(id);
    }
    for (const id of ADMIN_MENU_IDS) expect(ids(viewer([], true))).toContain(id);
  });

  test("편집자 — 상품·광고·전문가·브랜드 메뉴 0 (제휴사 관리 메뉴도 광고 편집 메뉴로 친다)", () => {
    expect(OPERATIONS_MENU_IDS).toContain("partners");
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

describe("메뉴 묶음 (F4)", () => {
  test("그룹은 7개이고 이름·순서가 권고안 그대로다", () => {
    expect(MENU_GROUPS.map((g) => g.label)).toEqual(["기사 만들기·발행", "배치·노출", "지방세 자료·연결", "검수·품질", "분야 콘텐츠", "수익·제휴", "운영·설정"]);
  });

  test("날마다 쓰는 메뉴 + 더 보기 그룹 항목이 모든 메뉴 항목을 정확히 한 번씩 나눠 갖고, 모르는 항목 id는 없다", () => {
    const listed = [...DAILY_MENU_IDS, ...MENU_GROUPS.flatMap((g) => [...g.itemIds])];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ALL_MENU_IDS].sort());
  });

  test.each(EXPECTED)("%s — 묶음 메뉴가 보이는 항목 집합을 바꾸지 않는다", (_name, v, expected) => {
    const groups = adminMenuGroups(v);
    const shown = [...adminDailyMenu(v), ...groups.flatMap((g) => g.items)].map((i) => i.id);
    expect(shown.sort()).toEqual([...expected].sort());
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });

  test("기자 — 날마다 쓰는 메뉴와 더 보기 안의 그룹 3개", () => {
    expect(adminDailyMenu(viewer(["reporter"])).map((i) => i.label)).toEqual(["첫 화면", "기사", "사진 보관함"]);
    expect(adminMenuGroups(viewer(["reporter"])).map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ["기사 만들기·발행", ["기사 기획"]],
      ["배치·노출", ["금주 부동산 재테크", "상황 카드"]],
      ["운영·설정", ["문의함"]],
    ]);
  });

  test("항목이 없는 그룹은 숨긴다 — 역할 없음은 더 보기 그룹 0개(첫 화면만), 브랜드 담당은 하나", () => {
    expect(adminMenuGroups(viewer([]))).toEqual([]);
    expect(adminDailyMenu(viewer([])).map((i) => i.id)).toEqual(["dashboard"]);
    expect(adminMenuGroups(viewer(["brand_ops"])).map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([["ops", ["brand"]]]);
  });

  test("날마다 쓰는 메뉴 — 편집 책임자는 첫 화면·기사·사진·검토·브리핑, 관리자는 + 측정 지표(순서 고정), 광고 담당은 첫 화면만", () => {
    expect(adminDailyMenu(viewer(["editor"])).map((i) => i.id)).toEqual(["dashboard", "articles", "media", "reviews", "brief"]);
    expect(adminDailyMenu(viewer([], true)).map((i) => i.id)).toEqual(["dashboard", "articles", "media", "brief", "metrics"]);
    expect(adminDailyMenu(viewer(["ad_ops"])).map((i) => i.id)).toEqual(["dashboard"]);
  });

  test("관리자 — 7개 그룹이 모두 보이고 항목은 그룹 목록 순서", () => {
    const groups = adminMenuGroups(viewer([], true));
    expect(groups.map((g) => g.id)).toEqual(MENU_GROUPS.map((g) => g.id));
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["assignments", "people", "guides", "ai-desk"]);
  });

  test("groupOfMenuId — 항목이 속한 그룹, 모르는 id는 빈 문자열", () => {
    expect(groupOfMenuId("situations")).toBe("place");
    expect(groupOfMenuId("members")).toBe("ops");
    expect(groupOfMenuId("nope")).toBe("");
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
    ["/admin/situations", "situations"],
    ["/admin/situations/7", "situations"],
    ["/admin/media", "media"],
    ["/admin/categories", "categories"],
    ["/admin/dictionaries", "dictionaries"],
    ["/admin/query-terms", "query-terms"],
    ["/admin/news-readiness", "readiness"],
    ["/admin/news-readiness/requirements", "readiness"],
    ["/admin/seo", "seo"],
    ["/admin/projects", "projects"],
    ["/admin/projects/5", "projects"],
    ["/admin/projects/lenses", "projects"],
    ["/admin/partners", ""],
    ["/admin/unknown", ""],
  ])("%s → %s", (path, expected) => {
    expect(activeMenuId(menu, path)).toBe(expected);
  });

  test("관리자의 설정·회원 화면, 광고 담당의 제휴사 화면", () => {
    const admin = adminMenu(viewer([], true));
    expect(activeMenuId(admin, "/admin/settings")).toBe("settings");
    expect(activeMenuId(admin, "/admin/members")).toBe("members");
    expect(activeMenuId(admin, "/admin/metrics")).toBe("metrics");
    expect(activeMenuId(adminMenu(viewer(["editor"])), "/admin/metrics")).toBe("");
    expect(activeMenuId(adminMenu(viewer(["ad_ops"])), "/admin/partners")).toBe("partners");
  });

  test("세무 감수위원의 단계 「지방세로 읽기」 감수 화면 (W4 16단계) — 편집 책임자 + 감수위원이면 더 긴 주소의 메뉴", () => {
    expect(activeMenuId(adminMenu(viewer(["reviewer"])), "/admin/projects/lenses")).toBe("project-lenses");
    expect(activeMenuId(adminMenu(viewer(["reviewer"])), "/admin/projects/5")).toBe("");
    expect(activeMenuId(adminMenu(viewer(["editor", "reviewer"])), "/admin/projects/lenses")).toBe("project-lenses");
    expect(activeMenuId(adminMenu(viewer(["editor", "reviewer"])), "/admin/projects/5")).toBe("projects");
  });

  test("광고 담당의 기사 화면은 '광고·협찬 콘텐츠' 메뉴", () => {
    expect(activeMenuId(adminMenu(viewer(["ad_ops"])), "/admin/articles/9")).toBe("sponsored");
  });
});
