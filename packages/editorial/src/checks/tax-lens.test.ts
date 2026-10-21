// 01B CORE-01 「지방세로 읽기」 — 대상 기사 판정, 발행 차단(박스·생략 사유·감수), 저장 규칙
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import { CONTENT_TYPES, SECTIONS, type ArticleForPublish, type ContentType, type Section, type TaxLens } from "../model";
import { isTaxLensTarget, pointLineProblems, validateTaxLensForSave } from "./tax-lens";

const q = QUANTITATIVE_NEWS;
const lens = q.taxLens!;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);
const save = (patch: Partial<TaxLens>) => validateTaxLensForSave({ ...lens, ...patch }, BASE_CONTEXT);
const saveIds = (patch: Partial<TaxLens>) => uniqueIds(save(patch).findings);

describe("대상 기사 — 부동산·개발금융·지자체뉴스 × 보도·해설·가이드·칼럼", () => {
  const targetSections: Section[] = ["realestate", "finance", "local"];
  const targetTypes: ContentType[] = ["reported_news", "explainer", "guide", "opinion"];
  const matrix = SECTIONS.flatMap((s) =>
    CONTENT_TYPES.map((t) => [s, t, targetSections.includes(s) && targetTypes.includes(t)] as const),
  );

  it("분야 4 × 유형 6 = 24칸", () => {
    expect(matrix).toHaveLength(24);
    expect(matrix.filter(([, , target]) => target)).toHaveLength(12);
  });

  it.each(matrix)("%s × %s → 대상 %s", (section, contentType, target) => {
    expect(isTaxLensTarget(section, contentType)).toBe(target);
  });

  it("분야·유형이 비면 대상이 아니다 (그 자체는 ART-01이 막는다)", () => {
    expect(isTaxLensTarget(null, "reported_news")).toBe(false);
    expect(isTaxLensTarget("local", null)).toBe(false);
  });
});

describe("CORE-01 발행 차단", () => {
  it("대상 기사에 박스도 생략 사유도 없으면 발행 불가", () => {
    expect(blockers({ ...q, taxLens: null })).toEqual(["core01.box-or-reason"]);
  });

  it("생략 사유만 남기면 발행된다", () => {
    const skipped: TaxLens = { topics: [], points: [], links: [], omissionReason: "세목 쟁점이 없는 행정 일정 기사", reviewed: false, reviewedForVersion: null };
    expect(run({ ...q, taxLens: skipped }).canPublish).toBe(true);
  });

  it("생략 사유가 공백뿐이면 사유로 치지 않는다", () => {
    const blank: TaxLens = { topics: [], points: [], links: [], omissionReason: "  ", reviewed: false, reviewedForVersion: null };
    expect(blockers({ ...q, taxLens: blank })).toEqual(["core01.box-or-reason"]);
  });

  it("section=tax 기사와 sponsored는 박스 요구 대상이 아니다", () => {
    expect(TAX_EXPLAINER.taxLens).toBeNull();
    expect(blockers(TAX_EXPLAINER)).toEqual([]);
    expect(blockers({ ...TAX_EXPLAINER, section: "realestate", contentType: "sponsored", label: "ad" })).toEqual([]);
  });

  it("세무 감수 서명이 없는 박스는 발행 불가", () => {
    expect(blockers({ ...q, taxLens: { ...lens, reviewed: false } })).toEqual(["core01.box-unreviewed"]);
  });

  it("감수했다는데 감수 버전이 없으면 감수 안 된 박스", () => {
    expect(blockers({ ...q, taxLens: { ...lens, reviewedForVersion: null } })).toEqual(["core01.box-unreviewed"]);
  });

  it("감수 뒤 고쳐서 기사 버전이 올라가면 '재감수 필요'로 막힌다", () => {
    const result = run({ ...q, version: 4 });
    expect(uniqueIds(result.blockers)).toEqual(["nav03.desk-edit-required", "core01.box-re-review"]);
    expect(result.blockers.find((f) => f.id === "core01.box-re-review")!.message).toBe(
      "「지방세로 읽기」 박스가 감수 뒤 바뀌었습니다(감수 버전 3, 현재 버전 4) — 재감수 필요",
    );
  });

  it("대상이 아닌 기사라도 박스를 달았으면 감수가 필요하다", () => {
    expect(blockers({ ...TAX_EXPLAINER, taxLens: { ...lens, reviewed: false } })).toEqual(["core01.box-unreviewed"]);
  });

  it("발행 때도 박스 저장 규칙을 다시 본다 — 포인트 4줄은 발행 불가", () => {
    const four = { ...lens, points: [...lens.points, "셋째 포인트입니다.", "넷째 포인트입니다."] };
    expect(blockers({ ...q, taxLens: four })).toEqual(["core01.points-count"]);
  });

  it("digest의 적용 방식은 결정 안건이라 지금은 요구하지 않는다", () => {
    expect(isTaxLensTarget("local", "digest")).toBe(false);
  });
});

describe("CORE-01 저장 규칙 validateTaxLensForSave", () => {
  it("견본 박스는 저장된다", () => {
    expect(save({})).toEqual({ ok: true, findings: [] });
  });

  it("관련 세목 0개는 저장 거부", () => {
    expect(save({ topics: [] }).ok).toBe(false);
    expect(saveIds({ topics: [] })).toEqual(["core01.topics-required"]);
  });

  it.each([
    [0, false],
    [1, true],
    [2, true],
    [3, true],
    [4, false],
  ])("포인트 %i줄 → 저장 %s", (count, ok) => {
    const points = ["취득세는 잔금일을 기준으로 봅니다.", "세율은 주택 수에 따라 다릅니다.", "감면은 신고할 때 신청합니다.", "자세한 것은 해설을 보세요."].slice(0, count);
    const result = save({ points });
    expect(result.ok).toBe(ok);
    expect(uniqueIds(result.findings)).toEqual(ok ? [] : ["core01.points-count"]);
  });

  it("빈 줄은 포인트로 세지 않는다", () => {
    expect(saveIds({ points: ["", "  "] })).toEqual(["core01.points-count"]);
  });

  it("링크 0개는 저장 거부", () => {
    expect(saveIds({ links: [] })).toEqual(["core01.links-required"]);
  });

  it.each(["취득세는 약 120만 원입니다.", "1,200,000원을 냅니다.", "3억원 이하 주택", "세액이 5천만 원까지 줄어듭니다.", "2,500원이"])(
    "세액 표현(숫자 + 원) '%s' → 저장 거부",
    (point) => {
      const result = save({ points: [point] });
      expect(uniqueIds(result.findings)).toEqual(["core01.tax-amount"]);
      expect(result.findings[0]!.location).toEqual(expect.objectContaining({ field: "taxLens", sentenceIndex: 0 }));
    },
  );

  it.each(["감면율은 50%입니다.", "제3원칙에 따릅니다.", "60일 안에 신고합니다.", "2026년 원 단위로 반올림"])("세액이 아닌 '%s' → 저장된다", (point) => {
    expect(save({ points: [point] })).toEqual({ ok: true, findings: [] });
  });

  it("감면 단정 표현(금지 표현 사전)은 저장 거부", () => {
    const result = save({ points: ["생애 첫 주택이면 감면 보장입니다."] });
    expect(result.findings).toEqual([
      expect.objectContaining({ id: "core01.forbidden-phrase", location: { field: "taxLens", sentenceIndex: 0, phrase: "감면 보장" } }),
    ]);
  });

  it("생략 사유만 있는 박스(박스 내용 없음)는 저장된다", () => {
    expect(save({ topics: [], points: [], links: [], omissionReason: "지방세 쟁점이 없음" })).toEqual({ ok: true, findings: [] });
  });

  it("내용도 생략 사유도 없는 빈 박스는 세목·포인트·링크 모두 거부", () => {
    expect(saveIds({ topics: [], points: [], links: [] })).toEqual(["core01.topics-required", "core01.points-count", "core01.links-required"]);
  });
});

describe("화면 포인트 줄 검사 (CORE-01 박스와 CORE-02 허브 포인트 공용)", () => {
  const forbidden = ["무조건 감면"];
  it("세액 표현(숫자 + 원)은 그 줄 번호로 막는다 — 원칙·원문 등은 금액이 아니다", () => {
    expect(pointLineProblems(["시험용 첫 줄", "시험용 1,200만 원 예시"], forbidden)).toEqual([{ index: 1, message: expect.stringContaining("1,200만 원") }]);
    expect(pointLineProblems(["3원칙을 확인합니다", "2개 원문을 봅니다"], forbidden)).toEqual([]);
  });
  it("금지 표현 사전의 표현은 띄어쓰기가 달라도 막는다", () => {
    expect(pointLineProblems(["시험용 줄", "시험용 줄", "이 경우 무조건  감면됩니다"], forbidden)).toEqual([{ index: 2, message: expect.stringContaining("무조건 감면") }]);
  });
  it("문제없는 줄은 빈 목록", () => {
    expect(pointLineProblems(["시험용 포인트 한 줄"], forbidden)).toEqual([]);
  });
});
