import { describe, expect, test } from "vitest";
import { nextIntakeErrors, readColumnShareMax, readNextIntake, readinessWarnErrors } from "@/lib/readiness/monthly";
import { parseAlertAck, parsePenaltyAdd, parseRecalc, parseRulesSave } from "./readiness-records";
import { FRESHNESS_RESOLUTIONS, parseFreshnessResolve, parseQuestionsActivate, parseQuestionsSave, parseSamplesInit } from "./seo-rules";

describe("규정 판단 값 입력 (NAV-18·19·20)", () => {
  const sim = { sentence_similarity: 0.9, sentence_comparator: "gte", article_ratio: 0.6, article_comparator: "gt" };
  const pen = { window_months: 12, warn_points: 5, comparator: "gte" };
  test("올바른 값은 통과하고 모르는 칸은 버린다, 비운 값은 null(내부 기준·규정 값 없음)", () => {
    const r = parseRulesSave({ requirement_id: 3, similarity_rule: { ...sim, extra: 1 }, penalty_rule: pen, contributor_rule: { merge_external: true } });
    expect(r).toEqual({ ok: true, value: { requirementId: 3, similarity_rule: sim, penalty_rule: pen, contributor_rule: { merge_external: true } } });
    expect(parseRulesSave({ requirement_id: 3 })).toEqual({ ok: true, value: { requirementId: 3, similarity_rule: null, penalty_rule: null, contributor_rule: null } });
  });
  test("비율 0~1 밖·비교 연산 틀림·창 0개월·경고 점수 0·불리언 아님·규정 번호 없음은 칸 이름과 함께 거부", () => {
    const bad = (body: Record<string, unknown>) => {
      const r = parseRulesSave({ requirement_id: 1, ...body });
      return r.ok ? [] : r.errors.join(" ");
    };
    expect(bad({ similarity_rule: { ...sim, sentence_similarity: 1.1 } })).toContain("sentence_similarity");
    expect(bad({ similarity_rule: { ...sim, article_comparator: "eq" } })).toContain("article_comparator");
    expect(bad({ penalty_rule: { ...pen, window_months: 0 } })).toContain("window_months");
    expect(bad({ penalty_rule: { ...pen, warn_points: 0 } })).toContain("warn_points");
    expect(bad({ contributor_rule: { merge_external: "yes" } })).toContain("merge_external");
    expect(bad({ similarity_rule: "x" })).toContain("similarity_rule");
    expect(parseRulesSave({}).ok).toBe(false);
  });
});

describe("부정평가 위험 기록·재계산·알림 확인 입력", () => {
  test("부정평가 기록 — 사례·점수·일어난 날 필수, 없는 날짜(2월 30일)·0점·긴 글 거부", () => {
    expect(parsePenaltyAdd({ item: "시험용 사례", points: 2, occurred_on: "2026-09-30" })).toMatchObject({ ok: true, value: { item: "시험용 사례", points: 2, occurredOn: "2026-09-30", evidenceRef: null, supersedesId: null } });
    expect(parsePenaltyAdd({ item: "x", points: 1, occurred_on: "2026-02-30" }).ok).toBe(false);
    expect(parsePenaltyAdd({ item: "x", points: 0, occurred_on: "2026-02-01" }).ok).toBe(false);
    expect(parsePenaltyAdd({ item: " ", points: 1, occurred_on: "2026-02-01" }).ok).toBe(false);
    expect(parsePenaltyAdd({ item: "x", points: 1, occurred_on: "2026-02-01", supersedes_id: "7" }).ok).toBe(false);
    expect(parsePenaltyAdd({ item: "x", points: 1, occurred_on: "2026-02-01", supersedes_id: 7, evidence_ref: "문서 3쪽" })).toMatchObject({ ok: true, value: { supersedesId: 7, evidenceRef: "문서 3쪽" } });
  });
  test("재계산은 달과 사유 필수, 알림 확인은 번호 필수", () => {
    expect(parseRecalc({ month: "2026-09", reason: "집계 정의 보정" }).ok).toBe(true);
    expect(parseRecalc({ month: "2026-9", reason: "x" }).ok).toBe(false);
    expect(parseRecalc({ month: "2026-09", reason: "  " }).ok).toBe(false);
    expect(parseAlertAck({ id: 4 })).toEqual({ ok: true, value: { id: 4 } });
    expect(parseAlertAck({ id: "4" }).ok).toBe(false);
  });
});

describe("설정 — 경고 기준·다음 접수 목표 (NAV-16·17)", () => {
  test("경고 기준은 비율(0~1)만, 모르는 칸 거부, 비어 있으면 기준 없음", () => {
    expect(readinessWarnErrors({})).toEqual([]);
    expect(readinessWarnErrors({ columnShareMax: 0.3 })).toEqual([]);
    expect(readinessWarnErrors({ columnShareMax: 1.5 })).toHaveLength(1);
    expect(readinessWarnErrors({ other: 1 })).toHaveLength(1);
    expect(readinessWarnErrors([])).toHaveLength(1);
    expect(readColumnShareMax({ columnShareMax: 0.3 })).toBe(0.3);
    expect(readColumnShareMax({})).toBeNull();
  });
  test("다음 접수 목표 — 비어 있으면 미정(null), 달 모양 검사, ‘선정 예정’·‘제휴 확정’ 같은 보장 표현 거부", () => {
    expect(readNextIntake({})).toBeNull();
    expect(readNextIntake({ label: "시험 공고", target_month: "2027-03" })).toEqual({ label: "시험 공고", targetMonth: "2027-03" });
    expect(nextIntakeErrors({ target_month: "2027-13" })).toHaveLength(1);
    expect(nextIntakeErrors({ label: "제휴 확정 공고" }).join()).toContain("보장 표현");
    expect(nextIntakeErrors({ label: "선정 예정" })).toHaveLength(1);
    expect(nextIntakeErrors({ label: "" })).toHaveLength(1);
  });
});

describe("검색 최적화 API 입력 (OPT-07·09)", () => {
  test("신선도 처리 — 결과 3종·사유 필수", () => {
    expect(FRESHNESS_RESOLUTIONS).toEqual(["no_change", "substantive", "correction"]);
    expect(parseFreshnessResolve({ id: 1, resolution: "no_change", note: "개정 내용과 무관" })).toEqual({ ok: true, value: { id: 1, resolution: "no_change", note: "개정 내용과 무관" } });
    expect(parseFreshnessResolve({ id: 1, resolution: "typo", note: "x" }).ok).toBe(false);
    expect(parseFreshnessResolve({ id: 1, resolution: "no_change", note: " " }).ok).toBe(false);
    expect(parseFreshnessResolve({ resolution: "no_change", note: "x" }).ok).toBe(false);
  });
  test("질문 저장은 정확히 50문항, 활성화·표본 만들기는 번호·달·엔진 필수", () => {
    const text = Array.from({ length: 50 }, (_, i) => `질문 ${i + 1}`).join("\n");
    expect(parseQuestionsSave({ text, activate: true })).toMatchObject({ ok: true, value: { activate: true } });
    expect(parseQuestionsSave({ text: "한 줄" }).ok).toBe(false);
    expect(parseQuestionsActivate({ version: 2 }).ok).toBe(true);
    expect(parseQuestionsActivate({}).ok).toBe(false);
    expect(parseSamplesInit({ month: "2026-10", version: 1, engines: "엔진A, 엔진B" })).toEqual({ ok: true, value: { month: "2026-10", version: 1, engines: ["엔진A", "엔진B"] } });
    expect(parseSamplesInit({ month: "2026-10", version: 1, engines: "" }).ok).toBe(false);
    expect(parseSamplesInit({ month: "2026-1", version: 1, engines: "a" }).ok).toBe(false);
  });
});
