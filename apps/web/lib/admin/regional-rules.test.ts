// 지역 기사 편집 게이트 운영 규칙 (W4 7단계 — REG1-17 · 12장 #7) — 운영 설정·판정 입력·편집 승인 3항목·계약 제휴사
import { describe, expect, test } from "vitest";
import { contractedPartners, judgeConflict, parseJudgeInput, parseRegionalJudgeFields, regionalChecklistErrors, regionalJudgeFieldsErrors } from "./regional-rules";
import { reviewErrorsFromServer, checksFor, isRegionalRow, reviewPayload } from "./review-form";
import { SETTING_SPECS } from "./settings-rules";

describe("운영 설정 regional_judge_fields (DB 트리거 regional_settings_guard와 같은 규칙)", () => {
  test("씨앗 4종·일부·빈 목록은 저장, 목록 밖 값·같은 값 두 번·목록 아님은 칸 오류", () => {
    expect(regionalJudgeFieldsErrors(["local_tax", "realestate", "local_finance", "urban_policy"])).toEqual([]);
    expect(regionalJudgeFieldsErrors(["local_tax"])).toEqual([]);
    expect(regionalJudgeFieldsErrors([])).toEqual([]);
    expect(regionalJudgeFieldsErrors(["local_tax", "tourism"])).toEqual(["[1]: local_tax·realestate·local_finance·urban_policy 중 하나여야 합니다"]);
    expect(regionalJudgeFieldsErrors(["local_tax", "local_tax"])).toEqual(["[1]: 같은 편집 분야가 앞에 있습니다"]);
    expect(regionalJudgeFieldsErrors({ local_tax: true })).toHaveLength(1);
    expect(SETTING_SPECS.regional_judge_fields!.check(["urban_policy", "x"], null)).toEqual(["[1]: local_tax·realestate·local_finance·urban_policy 중 하나여야 합니다"]);
  });
  test("읽기 — 모양이 틀리면 null", () => {
    expect(parseRegionalJudgeFields(["realestate"])).toEqual(["realestate"]);
    expect(parseRegionalJudgeFields(["realestate", "realestate"])).toBeNull();
    expect(parseRegionalJudgeFields("local_tax")).toBeNull();
    expect(parseRegionalJudgeFields(["local_tax", "realestate", "local_finance", "urban_policy", "local_tax"])).toBeNull();
  });
});

describe("편집자 판정 입력 { op, articleId, judgement, note? }", () => {
  test("판정 4값·null(지우기)·메모 앞뒤 공백 정리", () => {
    expect(parseJudgeInput({ op: "judge", articleId: 5, judgement: "travel_review", note: "  여행 후기 " })).toEqual({ ok: true, value: { articleId: 5, judgement: "travel_review", note: "여행 후기" } });
    expect(parseJudgeInput({ op: "judge", articleId: 5, judgement: null })).toEqual({ ok: true, value: { articleId: 5, judgement: null, note: null } });
  });
  test("칸 오류는 칸 이름과 함께", () => {
    expect(parseJudgeInput({ op: "judge", articleId: 0, judgement: "tour" })).toEqual({
      ok: false,
      errors: ["articleId: 1 이상의 기사 번호여야 합니다", "judgement: news_candidate·travel_review·restaurant_pick·event_promo 중 하나이거나 null이어야 합니다"],
    });
    expect(parseJudgeInput({ op: "judge", articleId: 1 })).toEqual({ ok: false, errors: ["judgement: 필요합니다 (news_candidate·travel_review·restaurant_pick·event_promo 또는 null = 판정 지우기)"] });
    expect(parseJudgeInput({ op: "judge", articleId: 1, judgement: null, extra: 1 })).toEqual({ ok: false, errors: ["extra: 모르는 칸입니다"] });
  });
  test("공개(예약) 중인 보도·해설에 비보도 판정은 충돌, 초안·가이드·기사 후보 판정은 괜찮다", () => {
    expect(judgeConflict({ status: "published", content_type: "reported_news" }, "restaurant_pick")).toMatch(/먼저 내린 뒤/);
    expect(judgeConflict({ status: "scheduled", content_type: "explainer" }, "event_promo")).toMatch(/REG1-17/);
    expect(judgeConflict({ status: "draft", content_type: "reported_news" }, "travel_review")).toBeNull();
    expect(judgeConflict({ status: "published", content_type: "guide" }, "travel_review")).toBeNull();
    expect(judgeConflict({ status: "published", content_type: "reported_news" }, "news_candidate")).toBeNull();
  });
});

describe("편집 승인 3항목 · 계약 제휴사", () => {
  test("빠진 항목마다 checklist.<키> 칸 오류 — 키는 evidence·relation·ad_independence", () => {
    expect(regionalChecklistErrors({ evidence: true, relation: true, ad_independence: true })).toEqual([]);
    expect(regionalChecklistErrors({ evidence: true })).toEqual([
      "checklist.relation: 지역 기사 편집 승인에는 관계 확인이 필요합니다 (REG1-17)",
      "checklist.ad_independence: 지역 기사 편집 승인에는 광고 독립성 확인이 필요합니다 (REG1-17)",
    ]);
  });
  test("계약 기록 = 시작일·종료일 중 하나라도 있음", () => {
    const list = [
      { id: 1, contract_from: "2026-01-01", contract_to: null },
      { id: 2, contract_from: null, contract_to: "2026-12-31" },
      { id: 3, contract_from: null, contract_to: null },
    ];
    expect(contractedPartners(list).map((p) => p.id)).toEqual([1, 2]);
  });
});

describe("편집 승인 폼 — 지역 기사 3항목 (REG1-17)", () => {
  test("지역 기사(지역 태그·지자체뉴스, 광고 제외)의 편집 승인 확인 항목에 3항목이 더해지고, 승인하면 checklist에 그 키가 true", () => {
    const ids = checksFor("desk_edit", "qualitative", true).map((c) => c.id);
    expect(ids.slice(-3)).toEqual(["evidence", "relation", "ad_independence"]);
    expect(checksFor("desk_edit", "qualitative", false).map((c) => c.id)).not.toContain("evidence");
    expect(checksFor("tax_review", null, true).map((c) => c.id)).not.toContain("evidence");
    const checks = Object.fromEntries(ids.map((id) => [id, true]));
    const r = reviewPayload({ kind: "desk_edit", decision: "approve", reason: "", checks }, "qualitative", true);
    expect(r.ok && r.body.checklist).toMatchObject({ evidence: true, relation: true, ad_independence: true });
    const missing = reviewPayload({ kind: "desk_edit", decision: "approve", reason: "", checks: { ...checks, relation: false } }, "qualitative", true);
    expect(missing).toEqual({ ok: false, errors: { "review-desk_edit-checks": "확인 항목을 모두 체크해야 승인할 수 있습니다" } });
  });
  test("지역 기사 판정 = 지역 태그 또는 지자체뉴스, 광고·협찬 제외", () => {
    expect(isRegionalRow({ content_type: "reported_news", region_codes: [], section: "local" })).toBe(true);
    expect(isRegionalRow({ content_type: "explainer", region_codes: ["1100000000"], section: "tax" })).toBe(true);
    expect(isRegionalRow({ content_type: "sponsored", region_codes: ["1100000000"], section: "local" })).toBe(false);
    expect(isRegionalRow({ content_type: "explainer", region_codes: [], section: "tax" })).toBe(false);
  });
  test("편집 승인 API 422 — checklist.<키>는 확인 항목 칸 오류, 이해관계 표시는 실패 문장", () => {
    expect(
      reviewErrorsFromServer("desk_edit", ["checklist.relation: 관계 확인이 필요합니다", "checklist.evidence: 근거 확인이 필요합니다", "interestDisclosure: 이해관계 표시가 있어야 승인됩니다"]),
    ).toEqual({ fields: { "review-desk_edit-checks": "관계 확인이 필요합니다 · 근거 확인이 필요합니다" }, rest: ["이해관계 표시가 있어야 승인됩니다"] });
  });
});
