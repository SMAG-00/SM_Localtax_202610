// 작성·수정 계획 시험 — 새 버전·실질 수정일(ART-05 · OPT-07)·「지방세로 읽기」 감수 이어받기(CORE-01)·세무 감수 상태 칸
import { describe, expect, test } from "vitest";
import { EMPTY_CHECKLISTS, readStoredTaxLens } from "./content";
import { desiredTaxReviewStatus, planCreate, planEdit, storeTaxLens } from "./plan";
import { articleRow } from "./test-graph";

const NOW = "2026-10-17T03:00:00.000Z";
const LENS_INPUT = { topics: ["취득세"], points: ["취득일은 잔금일과 등기일 중 빠른 날입니다."], links: [{ kind: "explainer" as const, label: "해설", url: "/tax/a" }], omissionReason: null };
const reviewedLens = (version: number) => ({ topics: ["취득세"], points: ["취득일은 잔금일과 등기일 중 빠른 날입니다."], links: [{ kind: "explainer", label: "해설", url: "/tax/a" }], skip_reason: null, reviewed: true, reviewed_for_version: version });

describe("발행 전 수정", () => {
  test("바뀐 칸만 옮기고, 편집 승인 상태를 pending으로, 승인됨 상태를 검토 중으로 돌린다", () => {
    const before = articleRow({ status: "approved", editorial_status: "approved" });
    const plan = planEdit(before, { title: "새 제목", summary: before.summary }, { now: NOW, updateKind: null, reason: null });
    expect(plan.changed).toEqual(["title"]);
    expect(plan.columns).toMatchObject({ title: "새 제목", editorial_status: "pending", status: "in_review" });
    expect(plan.columns).not.toHaveProperty("summary");
    expect(plan.columns).not.toHaveProperty("substantive_updated_at");
    expect(plan.candidate.version).toBe(before.version + 1);
    expect(plan.titleChanged).toBe(true);
  });
  test("같은 값만 보내면 바뀐 칸이 없다", () => {
    const before = articleRow();
    expect(planEdit(before, { title: before.title, slug: before.slug }, { now: NOW, updateKind: null, reason: null }).changed).toEqual([]);
  });
});

describe("발행 뒤 수정 — 실질 수정일 (OPT-07)", () => {
  const published = articleRow({ status: "published", first_published_at: "2026-10-15T00:00:00+00:00", substantive_updated_at: null });
  test("오탈자는 substantive_updated_at을 바꾸지 않는다", () => {
    const plan = planEdit(published, { title: "고친 제목" }, { now: NOW, updateKind: "typo", reason: "오탈자" });
    expect(plan.columns).toMatchObject({ update_kind: "typo", updated_reason: "오탈자" });
    expect(plan.columns).not.toHaveProperty("substantive_updated_at");
    expect(plan.columns).not.toHaveProperty("editorial_status");
  });
  test("실질 수정·정정은 substantive_updated_at = 지금", () => {
    for (const kind of ["substantive", "correction"] as const) {
      const plan = planEdit(published, { title: "고친 제목" }, { now: NOW, updateKind: kind, reason: "보강" });
      expect(plan.columns.substantive_updated_at, kind).toBe(NOW);
    }
  });
});

describe("「지방세로 읽기」 감수 표시 (CORE-01)", () => {
  test("입력의 감수 표시는 받지 않는다 — 새 박스는 감수 안 됨", () => {
    expect(storeTaxLens({ ...LENS_INPUT, reviewed: true } as typeof LENS_INPUT, null, 0, 1)).toMatchObject({ reviewed: false, reviewed_for_version: null });
  });
  test("박스를 그대로 두고 다른 칸을 고치면 감수 버전이 새 버전으로 옮겨 간다", () => {
    const before = articleRow({ version: 3, tax_lens: reviewedLens(3) });
    const plan = planEdit(before, { title: "제목만 고침" }, { now: NOW, updateKind: null, reason: null });
    expect(readStoredTaxLens(plan.columns.tax_lens)).toMatchObject({ reviewed: true, reviewed_for_version: 4 });
    expect(plan.changed).toEqual(["title"]);
  });
  test("박스 문장을 고치면 감수 버전에 멈춘다 — 재감수 필요", () => {
    const before = articleRow({ version: 3, tax_lens: reviewedLens(3) });
    const plan = planEdit(before, { taxLens: { ...LENS_INPUT, points: ["바꾼 포인트입니다."] } }, { now: NOW, updateKind: null, reason: null });
    expect(readStoredTaxLens(plan.columns.tax_lens)).toMatchObject({ reviewed: true, reviewed_for_version: 3, points: ["바꾼 포인트입니다."] });
    expect(plan.changed).toContain("taxLens");
    expect(plan.omissionReasonChanged).toBe(false);
  });
  test("생략 사유가 새로 생기면 표시한다 — 편집 책임자만 쓸 수 있다", () => {
    const before = articleRow({ tax_lens: null });
    const plan = planEdit(before, { taxLens: { topics: [], points: [], links: [], omissionReason: "후속 기사" } }, { now: NOW, updateKind: null, reason: null });
    expect(plan.omissionReasonChanged).toBe(true);
    const same = planEdit(articleRow(), { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 영향은 후속 기사에서" } }, { now: NOW, updateKind: null, reason: null });
    expect(same.omissionReasonChanged).toBe(false);
  });
});

describe("작성", () => {
  test("초안·버전 1·작성자, 확인 목록은 check_log.checklists", () => {
    const { columns } = planCreate({ slug: "a", title: "t", section: "tax", contentType: "explainer", taxLens: LENS_INPUT }, 42, EMPTY_CHECKLISTS);
    expect(columns).toMatchObject({ origin: "new", status: "draft", version: 1, author_id: 42, slug: "a", content_type: "explainer" });
    expect(columns.check_log).toEqual({ checklists: EMPTY_CHECKLISTS });
    expect(columns.tax_lens).toMatchObject({ topics: ["취득세"], skip_reason: null, reviewed: false });
  });
});

describe("세무 감수 상태 칸", () => {
  test.each([
    ["not_required", true, false, "pending"],
    ["pending", false, false, "not_required"],
    ["approved", true, true, "pending"],
    ["approved", true, false, "approved"],
    ["rejected", false, false, "rejected"],
  ])("%s · 대상 %s · 새 초안 버전 %s → %s", (current, needs, newDraft, expected) => {
    expect(desiredTaxReviewStatus(current, needs, newDraft)).toBe(expected);
  });
});
