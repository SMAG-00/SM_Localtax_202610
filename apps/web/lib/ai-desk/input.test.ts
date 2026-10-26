import { describe, expect, it } from "vitest";
import { CHECK_KEYS, DESK_ACTION, DESK_OPS, parseChannels, parseChecked, parseDeskId, parseReason } from "./input";

describe("편집국 AI 입력 검사", () => {
  it("번호는 1 이상 정수(문자열 숫자 포함)만 받는다", () => {
    expect(parseDeskId({ id: 5 })).toEqual({ ok: true, value: 5 });
    expect(parseDeskId({ id: "12" })).toEqual({ ok: true, value: 12 });
    for (const bad of [0, -1, 1.5, "a", null, undefined]) expect(parseDeskId({ id: bad }).ok).toBe(false);
  });
  it("체크 키는 종류별 목록 안의 것만 받는다", () => {
    expect(parseChecked({ original_compared: true, box_matches_article: true, case_facts_from_source: true }, "article_ai_box")).toEqual(["original_compared", "box_matches_article"]);
    expect(parseChecked({ checked: ["no_personal_info", "임의"] }, "case_summary")).toEqual(["no_personal_info"]);
    expect(parseChecked({}, "case_summary")).toEqual([]);
  });
  it("반려 사유는 필수이고 400자까지", () => {
    expect(parseReason({ reason: "  " }).ok).toBe(false);
    expect(parseReason({ reason: "가".repeat(401) }).ok).toBe(false);
    expect(parseReason({ reason: "원문과 다름" })).toEqual({ ok: true, value: "원문과 다름" });
  });
  it("채널 목록은 5종 안에서만 받고 중복은 합친다", () => {
    expect(parseChannels({ channels: "brief, shorts brief" })).toEqual({ ok: true, value: ["brief", "shorts"] });
    expect(parseChannels({ channels: ["brief", "tv"] }).ok).toBe(false);
    expect(parseChannels({}).ok).toBe(false);
  });
  it("모든 작업에 권한이 하나씩 정해져 있다", () => {
    for (const op of DESK_OPS) expect(["case_summary.approve", "ai_box.approve"]).toContain(DESK_ACTION[op]);
    expect(CHECK_KEYS.case_summary).toHaveLength(4);
  });
});
