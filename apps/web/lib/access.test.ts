// 접근 판정 시험 — PRD-00 6장 편집국 역할표 · ACC-04 · ADM-01 · NAV-06 · NAV-12 · W2-a 설계 §5.
// 기대값은 PRD 표를 옮긴 표(EXPECTED)이고, 구현 코드에서 계산하지 않는다.
import { describe, expect, test } from "vitest";
import {
  ACTION_LIST,
  AUDITED_DENIALS,
  NON_NEWSROOM_ROLES,
  STAFF_ROLES,
  allowedActions,
  can,
  check,
  isStaffRole,
  type Action,
  type ArticleResource,
  type StaffRole,
  type Viewer,
} from "./access";

const viewer = (roles: StaffRole[], isAdmin = false, userId = "u-self"): Viewer => ({
  userId,
  email: isAdmin ? "po@example.test" : "staff@example.test",
  isAdmin,
  roles,
});

const article = (over: Partial<ArticleResource> = {}): ArticleResource => ({
  kind: "article",
  authorUserId: "u-author",
  contentType: "reported_news",
  published: false,
  ...over,
});

// 열 순서: reporter · editor · reviewer · ad_ops · store_ops · brand_ops · expert_ops · 관리자(역할 없음) · 역할 없음
const COLUMNS = ["reporter", "editor", "reviewer", "ad_ops", "store_ops", "brand_ops", "expert_ops", "admin", "none"] as const;
type Column = (typeof COLUMNS)[number];

function viewerFor(column: Column): Viewer {
  if (column === "admin") return viewer([], true);
  if (column === "none") return viewer([]);
  return viewer([column]);
}

const O = true;
const X = false;

/** 대상 없는(역할만 보는) 판정 — PRD-00 6장 표 */
const EXPECTED: Record<Action, readonly boolean[]> = {
  //                         rep ed  rev ad  st  br  ex  adm none
  "article.read":           [O, O, O, X, X, X, X, O, X],
  "article.create":         [O, O, X, O, X, X, X, O, X], // ad_ops는 sponsored만 (대상 판정에서 다시 본다)
  "article.edit":           [O, O, X, O, X, X, X, O, X],
  "article.submit":         [O, O, X, O, X, X, X, O, X],
  "article.tax_lens_skip":  [X, O, X, X, X, X, X, X, X],
  "review.desk_edit":       [X, O, X, X, X, X, X, X, X],
  "review.tax_review":      [X, X, O, X, X, X, X, X, X],
  "review.sponsor_check":   [X, O, X, X, X, X, X, X, X],
  "article.publish":        [X, O, X, X, X, X, X, X, X],
  "article.sort":           [X, O, X, X, X, X, X, X, X],
  "article.hot":            [X, O, X, X, X, X, X, X, X],
  "article.home":           [X, O, X, X, X, X, X, X, X],
  "amendment.record_event":  [X, O, X, X, X, X, X, X, X],
  "amendment.correct_event": [X, O, X, X, X, X, X, X, X],
  "link.manage":             [X, O, X, X, X, X, X, X, X],
  "hub_point.edit":          [X, O, X, X, X, X, X, X, X], // W3 9단계 — 허브 지방세 포인트 초안은 편집 책임자, 감수 서명은 review.tax_review(감수위원)
  "legal_doc.manage":        [X, O, X, X, X, X, X, X, X],
  "source_review.resolve":   [X, O, X, X, X, X, X, O, X], // W4 6단계 — 원문 검수 큐(다시 받기·해결)는 편집 책임자·관리자 (W4 설계 6장)
  "regional.judge":          [X, O, X, X, X, X, X, O, X], // W4 7단계 — 지역 기사 편집자 판정은 편집 책임자, 1인 체제면 관리자(PO) (12장 #7 권고안)
  "regional_link.confirm":   [X, O, X, X, X, X, X, O, X], // W4 13단계 — 지역 연결 후보 찾기·확인·지우기는 편집 책임자·관리자 (REG1-10 '편집자가 확인한 연결만 공개')
  "project.manage":          [X, O, X, X, X, X, X, O, X], // W4 14단계 — 프로젝트 만들기·단계 기록·정정·공개 전환은 편집 책임자·관리자 (6장 '편집 책임자 이상', brand_ops 거부 감사)
  "supply.manage":           [X, O, X, X, X, X, X, O, X], // W4 17단계 — 분양 정보 만들기·고치기·공개 전환은 편집 책임자·관리자 (6장, ad_ops·brand_ops 거부 감사)
  "dev_method.manage":       [X, O, X, X, X, X, X, O, X], // W4 18단계 — 개발방법 내용·비교 항목·사실 행은 편집 책임자·관리자 (6장, 서명은 review.tax_review)
  "article.regional_fields": [O, O, X, X, X, X, X, O, X], // W4 7단계 — 지역 기사 편집 칸(편집 분야·공익적 질문·소재·관계)은 기자·편집 책임자·관리자, 광고·협찬 담당 0
  "column.manage":           [X, O, X, X, X, X, X, X, X],
  "column.signature":        [X, O, X, X, X, X, X, X, X], // W3 8단계 — 시그니처 연재 회차·순서는 칼럼 정렬과 같은 편집 행위 (BR-08)
  "correction.request":     [O, O, X, X, X, X, X, X, X],
  "correction.decide":      [X, O, X, X, X, X, X, X, X],
  "assignment.read":        [O, O, X, X, X, X, X, O, X],
  "assignment.create":      [O, O, X, X, X, X, X, O, X],
  "assignment.update":      [O, O, X, X, X, X, X, O, X],
  "situation.edit":         [O, O, X, X, X, X, X, O, X], // PRD-00 6장 'CMS 작성·상황 카드' — 편집국(기자·편집 책임자)·관리자
  "situation.publish":      [X, O, X, X, X, X, X, X, X], // 공개·허브 배치는 발행 승인·홈 배치와 같은 편집 행위 — 관리자도 editor 필요
  "category.edit":          [X, O, X, X, X, X, X, O, X],
  "dictionary.edit":        [X, O, X, X, X, X, X, O, X],
  "settings.edit":          [X, X, X, X, X, X, X, O, X],
  "policy.edit":            [X, O, X, O, X, X, X, O, X], // 문서별 세부는 canEditPolicy (lib/policy/docs.ts)
  "policy.publish":         [X, X, X, X, X, X, X, O, X], // 게시 승인은 관리자만
  "partner.read":           [X, O, X, O, X, X, X, O, X], // 편집 책임자는 읽기만 (등록·수정은 sponsored.manage)
  "member.read":            [X, X, X, X, X, X, X, O, X],
  "member.suspend":         [X, X, X, X, X, X, X, O, X],
  "member.delete":          [X, X, X, X, X, X, X, O, X],
  "role.grant":             [X, X, X, X, X, X, X, O, X],
  "role.revoke":            [X, X, X, X, X, X, X, O, X],
  "audit.read":             [X, X, X, X, X, X, X, O, X],
  "sponsored.manage":       [X, X, X, O, X, X, X, O, X],
  "product.manage":         [X, X, X, X, O, X, X, O, X],
  "brand.manage":           [X, X, X, X, X, O, X, O, X],
  "brand.approve":          [X, X, X, X, X, X, X, O, X], // W3 7단계 — 증빙 승인·동의서·경력 표시 승인은 관리자(PO)만 (설계 6장)
  "expert.manage":          [X, X, X, X, X, X, O, O, X],
  "metrics.read":           [X, X, X, X, X, X, X, O, X], // GROW-01 지표 대시보드 — PRD-00 6장에 행이 없어 관리자 전권만 (수익 대시보드와 같다, W2-c 설계 9장)
  "readiness.read":         [X, O, X, X, X, X, X, O, X], // NAV-13·14 기사 생산·제휴 준비 대시보드 — PRD-01A 3장 '편집 책임자·관리자만'
  "readiness.requirements": [X, O, X, X, X, X, X, O, X], // NAV-13 규정 버전 등록·확정 — 같은 화면의 담당자(편집 책임자·관리자)
  "query_terms.read":       [X, O, X, X, X, X, X, O, X], // SRCH-03 검색어 집계 — 동의어 사전을 고치는 사람(편집 책임자·관리자)과 같다 (W2-d 설계 8.3)
  "inquiry.read": [O, O, X, O, O, X, X, O, X], // 문의 — 대상 없이는 하나라도 다룰 종류가 있는 역할 (종류별은 아래 표)
  "inquiry.update": [O, O, X, O, O, X, X, O, X], // 문의 — 대상 없이는 하나라도 다룰 종류가 있는 역할 (종류별은 아래 표)
  "inquiry.contact_view": [O, O, X, O, O, X, X, O, X], // 문의 — 대상 없이는 하나라도 다룰 종류가 있는 역할 (종류별은 아래 표)
  "audit.amend": [X, X, X, X, X, X, X, X, X], // 감사 기록 수정·삭제 — 역할과 관계없이 isAuditAdmin(PO)만 (관리자도 거부)
};

describe("역할 × 작업 표 (대상 없음) — PRD-00 6장", () => {
  test("표가 작업 목록 전부를 덮는다", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTION_LIST].sort());
  });
  for (const action of ACTION_LIST) {
    COLUMNS.forEach((column, i) => {
      const expected = EXPECTED[action][i];
      test(`${column} → ${action} = ${expected ? "허용" : "거부"}`, () => {
        expect(can(viewerFor(column), action)).toBe(expected);
      });
    });
  }
});

describe("문의 종류별 열람 역할 (W2-e 7.3) · 감사 기록 수정은 PO만 (10.1)", () => {
  const roleKinds: Array<[StaffRole | "admin", string[]]> = [
    ["reporter", ["tip", "reader_submission"]],
    ["editor", ["tip", "reader_submission", "correction", "assistant_report"]],
    ["ad_ops", ["advertising"]],
    ["store_ops", ["subscription", "product"]],
    ["reviewer", []],
    ["admin", ["tip", "subscription", "advertising", "reader_submission", "correction", "product", "assistant_report"]],
  ];
  for (const [role, kinds] of roleKinds) {
    for (const k of ["tip", "subscription", "advertising", "reader_submission", "correction", "product", "assistant_report"] as const) {
      test(`${role} → ${k} 문의 열람 = ${kinds.includes(k) ? "허용" : "거부"}`, () => {
        const v = role === "admin" ? viewer([], true) : viewer([role]);
        expect(can(v, "inquiry.read", { kind: "inquiry", inquiryKind: k })).toBe(kinds.includes(k));
        expect(can(v, "inquiry.contact_view", { kind: "inquiry", inquiryKind: k })).toBe(kinds.includes(k));
      });
    }
  }
  test("관리자(isAdmin)여도 isAuditAdmin이 없으면 감사 기록 수정 거부 + 감사 대상, PO(isAuditAdmin)는 허용", () => {
    expect(check({ ...viewer([], true), isAuditAdmin: false }, "audit.amend").allowed).toBe(false);
    expect(check({ ...viewer([], false), isAuditAdmin: true }, "audit.amend").allowed).toBe(true);
    expect(AUDITED_DENIALS.has("audit.amend")).toBe(true);
    expect(AUDITED_DENIALS.has("inquiry.update")).toBe(true);
  });
});

describe("편집국 외 역할 4종은 기사 승인·정렬·발행 거부 (ACC-04 · NAV-06)", () => {
  const editorialActs: Action[] = ["review.desk_edit", "article.publish", "article.sort", "article.hot", "article.home"];
  for (const role of NON_NEWSROOM_ROLES) {
    for (const action of editorialActs) {
      test(`${role} → ${action} 거부 + 사유가 있다 + 감사 대상`, () => {
        const decision = check(viewer([role]), action, article());
        expect(decision.allowed).toBe(false);
        if (!decision.allowed) expect(decision.reason).toMatch(/editor/);
        expect(AUDITED_DENIALS.has(action)).toBe(true);
      });
    }
    test(`${role} → 보도기사 작성 거부`, () => {
      expect(can(viewer([role]), "article.create", article({ contentType: "reported_news" }))).toBe(false);
    });
  }
});

describe("칼럼 필자 = 발행 승인자 거부 · 브랜드 관리 담당의 칼럼 승인·정렬 거부 (BR-08 — W3 8단계)", () => {
  test("칼럼 필자 본인인 편집 책임자의 발행 거부 — 사유에 BR-08, 감사 대상", () => {
    const decision = check(viewer(["editor"], false, "u-author"), "article.publish", article({ authorUserId: "u-author", contentType: "opinion" }));
    expect(decision).toEqual({ allowed: false, reason: expect.stringContaining("BR-08") });
    expect(AUDITED_DENIALS.has("article.publish")).toBe(true);
  });
  test("다른 편집 책임자는 그 칼럼을 발행할 수 있다", () => {
    expect(can(viewer(["editor"], false, "u-other"), "article.publish", article({ authorUserId: "u-author", contentType: "opinion" }))).toBe(true);
  });
  test("칼럼이 아닌 기사·필자를 모르는 칼럼은 이 규칙 밖 (보도기사는 편집 승인 단계에서 NAV-12)", () => {
    expect(can(viewer(["editor"], false, "u-author"), "article.publish", article({ authorUserId: "u-author", contentType: "reported_news" }))).toBe(true);
    expect(can(viewer(["editor"], false, "u-author"), "article.publish", article({ authorUserId: null, contentType: "opinion" }))).toBe(true);
  });
  test("관리자여도 editor 없이는 발행 거부", () => {
    expect(can(viewer([], true, "u-other"), "article.publish", article({ contentType: "opinion" }))).toBe(false);
  });
  for (const action of ["review.desk_edit", "article.publish", "article.sort", "article.home", "column.manage", "column.signature"] as const) {
    test(`brand_ops → ${action} 거부 + 감사 대상`, () => {
      expect(can(viewer(["brand_ops"]), action, article({ contentType: "opinion" }))).toBe(false);
      expect(AUDITED_DENIALS.has(action)).toBe(true);
    });
  }
});

describe("지역 기사 판정·편집 분야 — 광고·협찬 담당 거부 + 감사 (W4 7단계 · REG1-17 · PRD_최종 §9.1)", () => {
  for (const action of ["regional.judge", "article.regional_fields"] as const) {
    test(`ad_ops·brand_ops → ${action} 거부 + 사유에 REG1-17 + 감사 대상`, () => {
      for (const role of ["ad_ops", "brand_ops"] as const) {
        const decision = check(viewer([role]), action, article({ contentType: "sponsored" }));
        expect(decision).toEqual({ allowed: false, reason: expect.stringContaining("REG1-17") });
      }
      expect(AUDITED_DENIALS.has(action)).toBe(true);
    });
  }
  test("기자는 편집 분야 칸은 적지만 판정은 못 한다", () => {
    expect(can(viewer(["reporter"]), "article.regional_fields")).toBe(true);
    expect(can(viewer(["reporter"]), "regional.judge")).toBe(false);
  });
});

describe("지역 연결 확인 — 편집 책임자·관리자만, 그 밖은 거부 + 감사 (W4 13단계 · REG1-10)", () => {
  test("기자·감수위원·광고·브랜드 담당 → 거부 + 사유에 REG1-10 + 감사 대상 · 편집 책임자·관리자 허용", () => {
    for (const role of ["reporter", "reviewer", "ad_ops", "brand_ops"] as const) {
      expect(check(viewer([role]), "regional_link.confirm")).toEqual({ allowed: false, reason: expect.stringContaining("REG1-10") });
    }
    expect(can(viewer(["editor"]), "regional_link.confirm")).toBe(true);
    expect(can(viewer([], true), "regional_link.confirm")).toBe(true);
    expect(AUDITED_DENIALS.has("regional_link.confirm")).toBe(true);
  });
});

describe("프로젝트 트래커 — 편집 책임자·관리자만, 그 밖은 거부 + 감사 (W4 14단계 · PR-02)", () => {
  test("기자·감수위원·광고·브랜드·스토어·전문가 담당 → 거부 + 사유에 PR-02 + 감사 대상 · 편집 책임자·관리자 허용", () => {
    for (const role of ["reporter", "reviewer", "ad_ops", "brand_ops", "store_ops", "expert_ops"] as const) {
      expect(check(viewer([role]), "project.manage")).toEqual({ allowed: false, reason: expect.stringContaining("PR-02") });
    }
    expect(can(viewer(["editor"]), "project.manage")).toBe(true);
    expect(can(viewer([], true), "project.manage")).toBe(true);
    expect(AUDITED_DENIALS.has("project.manage")).toBe(true);
  });
});

describe("분양 정보 — 편집 책임자·관리자만, 그 밖은 거부 + 감사 (W4 17단계 · PR-04)", () => {
  test("기자·감수위원·광고·브랜드·스토어·전문가 담당 → 거부 + 사유에 PR-04 + 감사 대상 · 편집 책임자·관리자 허용", () => {
    for (const role of ["reporter", "reviewer", "ad_ops", "brand_ops", "store_ops", "expert_ops"] as const) {
      expect(check(viewer([role]), "supply.manage")).toEqual({ allowed: false, reason: expect.stringContaining("PR-04") });
    }
    expect(can(viewer(["editor"]), "supply.manage")).toBe(true);
    expect(can(viewer([], true), "supply.manage")).toBe(true);
    expect(AUDITED_DENIALS.has("supply.manage")).toBe(true);
  });
});

describe("개발방법 비교 — 편집 책임자·관리자만 적고, 서명은 감수위원만 (W4 18단계 · PR-09·10)", () => {
  test("기자·감수위원·광고·브랜드·스토어·전문가 담당 → 입력 거부 + 사유에 PR-09 + 감사 대상 · 편집 책임자·관리자 허용 · 서명은 reviewer만", () => {
    for (const role of ["reporter", "reviewer", "ad_ops", "brand_ops", "store_ops", "expert_ops"] as const) {
      expect(check(viewer([role]), "dev_method.manage")).toEqual({ allowed: false, reason: expect.stringContaining("PR-09") });
    }
    expect(can(viewer(["editor"]), "dev_method.manage")).toBe(true);
    expect(can(viewer([], true), "dev_method.manage")).toBe(true);
    expect(AUDITED_DENIALS.has("dev_method.manage")).toBe(true);
    expect(can(viewer(["editor"]), "review.tax_review")).toBe(false);
    expect(can(viewer([], true), "review.tax_review")).toBe(false);
    expect(can(viewer(["reviewer"]), "review.tax_review")).toBe(true);
  });
});

describe("작성자와 승인자는 다른 사람 (NAV-12)", () => {
  test("작성 기자 본인인 편집자의 편집 승인 거부", () => {
    const decision = check(viewer(["editor", "reporter"], false, "u-author"), "review.desk_edit", article({ authorUserId: "u-author" }));
    expect(decision).toEqual({ allowed: false, reason: expect.stringContaining("NAV-12") });
  });
  test("다른 편집자의 편집 승인 허용", () => {
    expect(can(viewer(["editor"], false, "u-other"), "review.desk_edit", article({ authorUserId: "u-author" }))).toBe(true);
  });
  test("작성자를 모르는 기사(이관 등)는 역할만 본다", () => {
    expect(can(viewer(["editor"], false, "u-other"), "review.desk_edit", article({ authorUserId: null }))).toBe(true);
  });
  test("관리자이자 편집자라도 자기 기사 승인은 거부", () => {
    expect(can(viewer(["editor"], true, "u-author"), "review.desk_edit", article({ authorUserId: "u-author" }))).toBe(false);
  });
  test("세무 감수는 본인 여부를 보지 않는다 (DB 규칙과 같음)", () => {
    expect(can(viewer(["reviewer"], false, "u-author"), "review.tax_review", article({ authorUserId: "u-author" }))).toBe(true);
  });
});

describe("관리자 — 데이터·설정 전권, 편집 행위는 editor 필요 (W2-a 설계 §5)", () => {
  const admin = viewer([], true);
  test("editor 없는 관리자는 발행 거부", () => {
    const decision = check(admin, "article.publish", article());
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("관리자");
  });
  test("editor 없는 관리자는 편집 승인·정렬·HOT·정정 결정 거부", () => {
    for (const action of ["review.desk_edit", "article.sort", "article.hot", "correction.decide"] as Action[]) {
      expect(can(admin, action, article()), action).toBe(false);
    }
  });
  test("editor 없는 관리자는 세무 감수 서명 거부", () => {
    expect(can(admin, "review.tax_review", article())).toBe(false);
  });
  test("관리자는 역할 부여·회수·설정·감사 조회 허용", () => {
    for (const action of ["role.grant", "role.revoke", "settings.edit", "audit.read", "category.edit", "dictionary.edit"] as Action[]) {
      expect(can(admin, action), action).toBe(true);
    }
  });
  test("editor 역할을 받은 관리자는 남의 기사 발행 허용", () => {
    expect(can(viewer(["editor"], true), "article.publish", article())).toBe(true);
  });
  test("관리자는 발행 전 원고 작성·수정 허용(데이터 전권), 발행된 기사 수정은 editor 필요", () => {
    expect(can(admin, "article.edit", article({ published: false }))).toBe(true);
    expect(can(admin, "article.edit", article({ published: true }))).toBe(false);
  });
});

describe("운영 설정·회원 정지는 관리자만, 거부는 감사 대상 (ADM-02)", () => {
  test("editor의 설정 편집·계정 정지 거부 + 감사 대상", () => {
    for (const action of ["settings.edit", "member.suspend"] as Action[]) {
      const decision = check(viewer(["editor"]), action);
      expect(decision.allowed, action).toBe(false);
      if (!decision.allowed) expect(decision.reason).toContain("관리자");
      expect(AUDITED_DENIALS.has(action), action).toBe(true);
    }
  });
  test("브랜드 공개 승인(증빙 승인·동의서·경력 표시) — 브랜드 관리 담당도 거부 + 감사 대상, 관리자만 허용 (W3 7단계 설계 6장)", () => {
    const decision = check(viewer(["brand_ops"]), "brand.approve");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("관리자");
    expect(AUDITED_DENIALS.has("brand.approve")).toBe(true);
    expect(can(viewer(["brand_ops"]), "brand.manage")).toBe(true);
    expect(can(viewer([], true), "brand.approve")).toBe(true);
  });
  test("제휴사 — 편집 책임자는 열람만, 등록·수정은 광고·협찬 담당과 관리자", () => {
    expect(can(viewer(["editor"]), "partner.read")).toBe(true);
    expect(can(viewer(["editor"]), "sponsored.manage")).toBe(false);
    expect(can(viewer(["ad_ops"]), "sponsored.manage")).toBe(true);
    expect(can(viewer(["reporter"]), "partner.read")).toBe(false);
  });
});

describe("역할 부여는 관리자만 (ACC-04)", () => {
  test("editor의 역할 부여 거부 + 감사 대상", () => {
    expect(can(viewer(["editor"]), "role.grant")).toBe(false);
    expect(AUDITED_DENIALS.has("role.grant")).toBe(true);
  });
  test("모든 서비스 역할이 역할 부여 거부", () => {
    for (const role of STAFF_ROLES) expect(can(viewer([role]), "role.grant"), role).toBe(false);
  });
  test("역할 없는 회원(가입 메타데이터에 역할을 넣어도 roles는 비어 있다)은 아무 작업도 못 한다", () => {
    expect(allowedActions(viewer([]))).toEqual([]);
  });
});

describe("sponsored와 발행 뒤 수정", () => {
  test("ad_ops는 sponsored 작성·수정 허용, 보도기사 수정 거부", () => {
    const ad = viewer(["ad_ops"]);
    expect(can(ad, "article.create", article({ contentType: "sponsored" }))).toBe(true);
    expect(can(ad, "article.edit", article({ contentType: "sponsored" }))).toBe(true);
    expect(can(ad, "article.edit", article({ contentType: "explainer" }))).toBe(false);
  });
  test("ad_ops는 sponsored만 열람", () => {
    const ad = viewer(["ad_ops"]);
    expect(can(ad, "article.read", article({ contentType: "sponsored" }))).toBe(true);
    expect(can(ad, "article.read", article({ contentType: "reported_news" }))).toBe(false);
  });
  test("기자·편집자는 sponsored 작성 거부 (편집 책임자는 표기 확인만)", () => {
    expect(can(viewer(["reporter"]), "article.create", article({ contentType: "sponsored" }))).toBe(false);
    expect(can(viewer(["editor"]), "article.create", article({ contentType: "sponsored" }))).toBe(false);
    expect(can(viewer(["editor"]), "review.sponsor_check", article({ contentType: "sponsored" }))).toBe(true);
  });
  test("발행된 기사 수정은 기자 거부, 편집자 허용", () => {
    expect(can(viewer(["reporter"]), "article.edit", article({ published: true }))).toBe(false);
    expect(can(viewer(["editor"]), "article.edit", article({ published: true }))).toBe(true);
  });
  test("발행 전 원고는 기자가 수정·검토 요청", () => {
    expect(can(viewer(["reporter"]), "article.edit", article())).toBe(true);
    expect(can(viewer(["reporter"]), "article.submit", article())).toBe(true);
  });
  test("세무 감수위원은 원고를 쓰지 않는다", () => {
    expect(can(viewer(["reviewer"]), "article.create", article())).toBe(false);
    expect(can(viewer(["reviewer"]), "article.edit", article())).toBe(false);
  });
});

describe("역할 값", () => {
  test("7종만 역할로 인정한다", () => {
    expect(STAFF_ROLES).toEqual(["reporter", "editor", "reviewer", "ad_ops", "store_ops", "brand_ops", "expert_ops"]);
    expect(isStaffRole("editor")).toBe(true);
    expect(isStaffRole("admin")).toBe(false);
    expect(isStaffRole("Editor")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
  test("여러 역할을 가진 기자·감수위원은 두 역할의 작업을 모두 한다", () => {
    const both = viewer(["reporter", "reviewer"]);
    expect(can(both, "article.create", article())).toBe(true);
    expect(can(both, "review.tax_review", article())).toBe(true);
    expect(can(both, "article.publish", article())).toBe(false);
  });
});

describe("상황 카드 (UX-05 · PRD-00 6장) — 쓰기는 편집국·관리자, 공개·허브 배치는 편집 책임자, 감수 서명은 세무 감수위원", () => {
  test("공개·허브 배치 거부는 감사 대상 — 기자·감수위원·editor 없는 관리자·편집국 외 역할 모두 거부", () => {
    expect(AUDITED_DENIALS.has("situation.publish")).toBe(true);
    for (const v of [viewer(["reporter"]), viewer(["reviewer"]), viewer([], true), ...NON_NEWSROOM_ROLES.map((r) => viewer([r]))]) {
      const decision = check(v, "situation.publish");
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toContain("editor");
    }
    expect(can(viewer(["editor"]), "situation.publish")).toBe(true);
  });

  test("세무 감수위원은 상황 카드 문장을 고치지 못하고 감수 서명만 한다 — 편집자는 서명하지 못한다", () => {
    expect(can(viewer(["reviewer"]), "situation.edit")).toBe(false);
    expect(can(viewer(["reviewer"]), "review.tax_review")).toBe(true);
    expect(can(viewer(["editor"]), "review.tax_review")).toBe(false);
    expect(can(viewer([], true), "review.tax_review")).toBe(false);
  });
});

describe("측정 지표 대시보드 (/admin/metrics — GROW-01, W2-c 설계 9장)", () => {
  test("관리자만 — 편집 책임자·기자·편집국 외 역할은 사유와 함께 거부, 읽기라 거부를 감사 로그에 남기지 않는다", () => {
    expect(check(viewer([], true), "metrics.read")).toEqual({ allowed: true });
    for (const roles of [["editor"], ["reporter"], ["reviewer"], ["ad_ops"], ["store_ops"], ["brand_ops"], ["expert_ops"], ["editor", "reporter"]] as StaffRole[][]) {
      expect(check(viewer(roles), "metrics.read")).toEqual({ allowed: false, reason: "관리자만 할 수 있습니다" });
    }
    expect(AUDITED_DENIALS.has("metrics.read")).toBe(false);
  });
});

describe("기사 생산·제휴 준비 (/admin/news-readiness — NAV-13·14, W2-c 설계 8.5)", () => {
  test("편집 책임자·관리자만 열람·규정 버전 등록 — 기자·세무 감수위원·편집국 외 역할은 사유와 함께 거부", () => {
    for (const v of [viewer(["editor"]), viewer([], true), viewer(["editor", "reporter"])]) {
      expect(check(v, "readiness.read")).toEqual({ allowed: true });
      expect(check(v, "readiness.requirements")).toEqual({ allowed: true });
    }
    for (const roles of [["reporter"], ["reviewer"], ["ad_ops"], ["store_ops"], ["brand_ops"], ["expert_ops"], []] as StaffRole[][]) {
      expect(check(viewer(roles), "readiness.read")).toEqual({ allowed: false, reason: "기사 생산·제휴 준비 화면은 편집 책임자와 관리자만 봅니다 (PRD-01A 3장)" });
      expect(check(viewer(roles), "readiness.requirements")).toEqual({ allowed: false, reason: "제휴 규정 버전은 편집 책임자와 관리자만 적고 확정합니다 (NAV-13)" });
    }
  });
  test("규정 버전 등록·확정 거부는 감사 대상, 열람 거부는 아니다", () => {
    expect(AUDITED_DENIALS.has("readiness.requirements")).toBe(true);
    expect(AUDITED_DENIALS.has("readiness.read")).toBe(false);
  });
});

describe("검색어 집계 (/admin/query-terms — SRCH-03, W2-d 설계 8.3)", () => {
  test("편집 책임자·관리자만 — 기자·세무 감수위원·편집국 외 역할·역할 없음은 사유와 함께 거부, 열람 거부는 감사 대상이 아니다", () => {
    for (const v of [viewer(["editor"]), viewer([], true), viewer(["editor", "reporter"])]) expect(check(v, "query_terms.read")).toEqual({ allowed: true });
    for (const roles of [["reporter"], ["reviewer"], ["ad_ops"], ["store_ops"], ["brand_ops"], ["expert_ops"], []] as StaffRole[][]) {
      expect(check(viewer(roles), "query_terms.read")).toEqual({ allowed: false, reason: "검색어 집계는 편집 책임자와 관리자만 봅니다" });
    }
    expect(AUDITED_DENIALS.has("query_terms.read")).toBe(false);
  });
});
