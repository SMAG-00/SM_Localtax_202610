// 견본 시험 (W1-b 끝났다는 증거) — 차단 견본은 실패, 통과 견본은 통과한다 (PRD-01A OPT-03 수용 기준)
import { describe, expect, it } from "vitest";
import { BLOCKING_RULE_IDS, BLOCKING_SAMPLES, PASSING_SAMPLE, RULES_V1, lintArticle, publishDecision } from "./index";

const ruleName = (id: string) => RULES_V1.rules.find((r) => r.id === id)?.name;

describe("통과 견본 — 차단 0 + 경고 2", () => {
  const result = lintArticle(PASSING_SAMPLE.article, PASSING_SAMPLE.context, RULES_V1);

  it("차단 항목이 없어 발행할 수 있다", () => {
    expect(result.blockers).toEqual([]);
    expect(result.canPublish).toBe(true);
  });

  it("경고는 정확히 2개 — 내부 링크 1개 · 질문형 소제목 없음 (편집기 패널 견본과 같음)", () => {
    expect(result.warnings).toEqual(["seo.internal-links", "aeo.question-heading"]);
    const warnItems = result.items.filter((i) => i.level === "warn");
    expect(warnItems.map((i) => i.message)).toEqual(["내부 링크 1개 (권장 2개 이상)", "질문형 소제목 없음"]);
  });

  it("발행 API는 200으로 허용하고 경고 2개를 발행 기록용으로 돌려준다", () => {
    expect(publishDecision(result)).toEqual({
      allowed: true,
      httpStatus: 200,
      failed: [],
      warnings: ["seo.internal-links", "aeo.question-heading"],
    });
  });
});

describe("차단 견본 8종 — 해당 항목 하나만 어긴 원고", () => {
  it("견본이 8개이고 차단 규칙 8종을 하나씩 맡는다", () => {
    expect(BLOCKING_SAMPLES).toHaveLength(8);
    expect(BLOCKING_SAMPLES.map((s) => s.violates).sort()).toEqual([...BLOCKING_RULE_IDS].sort());
  });

  it.each(BLOCKING_SAMPLES.map((s) => [s.id, s] as const))("%s — 발행 불가, 차단 항목은 그 하나뿐", (_id, sample) => {
    const result = lintArticle(sample.article, sample.context, RULES_V1);
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toEqual([sample.violates]);
    // 차단 견본은 통과 견본에서 한 항목만 바꿨으므로 경고는 통과 견본과 같다
    expect(result.warnings).toEqual(["seo.internal-links", "aeo.question-heading"]);
  });

  it.each(BLOCKING_SAMPLES.map((s) => [s.id, s] as const))("%s — 발행 API 422와 실패 항목 이름", (_id, sample) => {
    const decision = publishDecision(lintArticle(sample.article, sample.context, RULES_V1));
    expect(decision.allowed).toBe(false);
    expect(decision.httpStatus).toBe(422);
    expect(decision.failed).toEqual([ruleName(sample.violates!)]);
  });

  it("차단 항목의 패널 문구는 PRD 패널 견본 표현을 따른다 — 핵심 주장 1개에 근거 없음", () => {
    const sample = BLOCKING_SAMPLES.find((s) => s.violates === "geo.claim-evidence")!;
    const item = lintArticle(sample.article, sample.context, RULES_V1).items.find((i) => i.id === "geo.claim-evidence")!;
    expect(item).toMatchObject({ level: "block", axis: "GEO", message: "핵심 주장 1개에 근거 없음 — 근거를 이어 주세요" });
  });
});
