// 기사 템플릿 시험 — 정량형(NAV-10)·정성형(NAV-11)·세법 해설·해결 사례(CAT-05)·광고·협찬(ART-10).
// 템플릿이 만든 요청 본문을 실제 API 입력 검사(parseArticleInput · parseChecklistsInput)에 넣어 통과하는지 본다.
import { describe, expect, test } from "vitest";
import type { StaffRole, Viewer } from "@/lib/access";
import { EMPTY_CHECKLISTS, parseChecklistsInput } from "@/lib/server/articles/content";
import { parseArticleInput } from "@/lib/server/articles/input";
import { ARTICLE_TEMPLATES, newArticlePayload, suggestSlug, templateById, templateForMethod, templatesFor, validateNewArticle, type NewArticleForm, type TemplateId } from "./templates";

const viewer = (roles: StaffRole[], isAdmin = false): Viewer => ({ userId: "u-1", email: "s@example.test", isAdmin, roles });

function form(templateId: TemplateId, over: Partial<NewArticleForm> = {}): NewArticleForm {
  const t = templateById(templateId);
  return {
    templateId,
    title: "가온시 상반기 취득세 18.4% 감소",
    slug: "gaon-acquisition-tax-2026h1",
    summary: "",
    section: t.defaultSection ?? "local",
    categoryId: "",
    reportingMethod: t.reportingMethod ?? "",
    legalBasisDate: t.needsLegalBasisDate ? "2026-10-01" : "",
    label: t.needsLabel ? "ad" : "none",
    partnerId: "",
    storyAssignmentId: null,
    ...over,
  };
}

describe("템플릿 목록과 역할", () => {
  test("5종 — 정량형 보도 · 정성형 보도 · 세법 해설 · 해결 사례 · 광고·협찬", () => {
    expect(ARTICLE_TEMPLATES.map((t) => t.id)).toEqual(["quantitative", "qualitative", "explainer", "solved_case", "sponsored"]);
  });

  test.each([
    ["기자", viewer(["reporter"]), ["quantitative", "qualitative", "explainer", "solved_case"]],
    ["편집 책임자", viewer(["editor"]), ["quantitative", "qualitative", "explainer", "solved_case"]],
    ["광고·협찬 담당 — 광고·협찬만", viewer(["ad_ops"]), ["sponsored"]],
    ["세무 감수위원 — 작성 권한 없음", viewer(["reviewer"]), []],
    ["스토어 담당 — 작성 권한 없음", viewer(["store_ops"]), []],
  ])("%s", (_n, v, expected) => {
    expect(templatesFor(v).map((t) => t.id)).toEqual(expected);
  });

  test("기획의 취재 방식으로 템플릿을 고른다 — 혼합형은 정량형 템플릿에 취재 방식 혼합형", () => {
    expect(templateForMethod("quantitative")).toEqual({ templateId: "quantitative", reportingMethod: "quantitative" });
    expect(templateForMethod("qualitative")).toEqual({ templateId: "qualitative", reportingMethod: "qualitative" });
    expect(templateForMethod("mixed")).toEqual({ templateId: "quantitative", reportingMethod: "mixed" });
    expect(templateForMethod(null)).toEqual({ templateId: "quantitative", reportingMethod: "quantitative" });
  });
});

describe("템플릿 요청 본문은 API 입력 검사를 통과한다", () => {
  test.each(ARTICLE_TEMPLATES.map((t) => [t.id] as const))("%s", (id) => {
    const payload = newArticlePayload(form(id));
    const parsed = parseArticleInput(payload, "create");
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    const checklists = parseChecklistsInput(payload.checklists ?? {}, EMPTY_CHECKLISTS);
    expect(checklists.ok).toBe(true);
  });

  test("정량형 — reported_news · quantitative, 그래프·표 표기(축·단위·출처) 칸이 있는 표와 정량형 확인 목록 3칸", () => {
    const p = newArticlePayload(form("quantitative"));
    expect(p.contentType).toBe("reported_news");
    expect(p.reportingMethod).toBe("quantitative");
    const blocks = (p.body as { blocks: { type: string; chart?: unknown }[] }).blocks;
    expect(blocks.map((b) => b.type)).toEqual(["key_summary", "paragraph", "table", "paragraph"]);
    expect(blocks[2]!.chart).toEqual({ axis: "", unit: "", source: "" });
    expect(p.checklists).toEqual({ quantitative: { sourceCrossCheck: null, limitations: null, relatedPartyCheck: null } });
  });

  test("혼합형 — 정량형·정성형 확인 목록을 모두 둔다", () => {
    const p = newArticlePayload(form("quantitative", { reportingMethod: "mixed" }));
    expect(p.reportingMethod).toBe("mixed");
    expect(Object.keys(p.checklists as object).sort()).toEqual(["qualitative", "quantitative"]);
  });

  test("정성형 — 인터뷰 인용 블록과 정성형 기록 4칸(취재 질문·현장·반대 관점·이해관계)", () => {
    const p = newArticlePayload(form("qualitative"));
    expect(p.reportingMethod).toBe("qualitative");
    const blocks = (p.body as { blocks: { type: string; origin?: string; refId?: unknown }[] }).blocks;
    const quote = blocks.find((b) => b.type === "quote");
    expect(quote).toMatchObject({ origin: "interview", refId: null });
    expect(p.checklists).toEqual({ qualitative: { interviewQuestions: null, fieldRecord: null, counterPerspective: null, conflictsOfInterest: null } });
  });

  test("세법 해설 — explainer, 취재 방식 없음, 법령 기준일, FAQ 2개", () => {
    const p = newArticlePayload(form("explainer"));
    expect(p.contentType).toBe("explainer");
    expect(p.reportingMethod).toBeUndefined();
    expect(p.legalBasisDate).toBe("2026-10-01");
    const faq = (p.body as { blocks: { type: string; items?: unknown[] }[] }).blocks.find((b) => b.type === "faq");
    expect(faq?.items).toHaveLength(2);
  });

  test("해결 사례 — 하위 유형 solved_case와 4칸(상황·쟁점·결과·교훈)", () => {
    const p = newArticlePayload(form("solved_case"));
    expect(p.subtype).toBe("solved_case");
    expect(p.solvedCase).toEqual({ situation: "", issue: "", result: "", lesson: "", resultEvidence: [] });
  });

  test("광고·협찬 — sponsored와 표기 하나, 공동 기획이면 제휴사 번호", () => {
    expect(newArticlePayload(form("sponsored", { label: "ad" }))).toMatchObject({ contentType: "sponsored", label: "ad" });
    const co = newArticlePayload(form("sponsored", { label: "co_planned", partnerId: "7" }));
    expect(co).toMatchObject({ contentType: "sponsored", label: "co_planned", partnerId: 7 });
  });

  test("하위 분야·기획 연결은 번호로, 빈 값은 보내지 않는다", () => {
    const p = newArticlePayload(form("quantitative", { categoryId: "14", storyAssignmentId: 3, summary: "  " }));
    expect(p.categoryId).toBe(14);
    expect(p.storyAssignmentId).toBe(3);
    expect("summary" in p).toBe(false);
    expect("categoryId" in newArticlePayload(form("quantitative"))).toBe(false);
  });
});

describe("새 기사 입력 확인 — 칸마다 오류 문장", () => {
  test("통과하는 입력은 오류 0", () => {
    for (const t of ARTICLE_TEMPLATES) expect(validateNewArticle(form(t.id))).toEqual({});
  });

  test("제목·주소·분야가 비면 각 칸에 오류", () => {
    const errors = validateNewArticle(form("quantitative", { title: "  ", slug: "", section: "" }));
    expect(Object.keys(errors).sort()).toEqual(["new-section", "new-slug", "new-title"]);
  });

  test.each([["has space"], ["a/b"], ["video"], ["photo"], ["popular"]])("주소 '%s'는 거부", (slug) => {
    expect(validateNewArticle(form("quantitative", { slug }))["new-slug"]).toBeTruthy();
  });

  test("세법 해설은 법령 기준일이 필요하고, 없는 날짜는 거부", () => {
    expect(validateNewArticle(form("explainer", { legalBasisDate: "" }))["new-legal-basis-date"]).toBeTruthy();
    expect(validateNewArticle(form("explainer", { legalBasisDate: "2026-02-30" }))["new-legal-basis-date"]).toBeTruthy();
  });

  test("광고·협찬은 표기를 하나 골라야 하고(없음 불가), 공동 기획은 제휴사가 필요", () => {
    expect(validateNewArticle(form("sponsored", { label: "none" }))["new-label"]).toBeTruthy();
    expect(validateNewArticle(form("sponsored", { label: "co_planned", partnerId: "" }))["new-partner"]).toBeTruthy();
  });

  test("보도 템플릿은 취재 방식이 3종 중 하나여야 한다", () => {
    expect(validateNewArticle(form("qualitative", { reportingMethod: "" }))["new-reporting-method"]).toBeTruthy();
  });
});

describe("새 기사 — 머리 글자 상한 (휴대폰 첫 화면 R1)", () => {
  test("제목 40자·요약 60자까지, 넘으면 칸 오류", () => {
    expect(validateNewArticle(form("explainer", { title: "가".repeat(40), summary: "나".repeat(60) }))).toEqual({});
    const errors = validateNewArticle(form("explainer", { title: "가".repeat(41), summary: "나".repeat(61) }));
    expect(errors["new-title"]).toBe("제목은 40자 이하여야 합니다 (지금 41자 — 휴대폰 첫 화면 글자 기준 R1)");
    expect(errors["new-summary"]).toBe("요약은 60자 이하여야 합니다 (지금 61자 — 휴대폰 첫 화면 글자 기준 R1)");
  });
});

describe("주소 제안", () => {
  test("한국 날짜(UTC+9) + 짧은 글자", () => {
    expect(suggestSlug(new Date("2026-10-17T16:30:00Z"), "a1b2")).toBe("20261018-a1b2");
    expect(suggestSlug(new Date("2026-10-17T14:59:59Z"), "zz")).toBe("20261017-zz");
  });
});
