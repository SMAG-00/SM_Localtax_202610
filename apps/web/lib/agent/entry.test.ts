import { describe, expect, it } from "vitest";
import { agentUiProps, parseEntryId, searchCardVisible, withEntryContext } from "./entry";
import { parseAskRequest } from "./request";
import type { AskModeGate } from "./rollout";

const open: AskModeGate = { taxbot: true, stage: "4c", noticeApproved: true, noticeVersion: "v1", modeNotice: "시험용 고지", answerFooter: "시험용 하단", targets: { guest: true, member: true } };

describe("모드 탭 노출 (고지 문구가 비면 렌더 0)", () => {
  it("열린 게이트 + 고지 문구가 있으면 탭 속성을 준다", () => {
    expect(agentUiProps(open, "guest")).toEqual({ noticeVersion: "v1", modeNotice: "시험용 고지", answerFooter: "시험용 하단", audience: "guest" });
  });
  it("승인 표시가 있어도 고지 문구가 비거나 공백이면 null", () => {
    expect(agentUiProps({ ...open, modeNotice: "" }, "internal")).toBeNull();
    expect(agentUiProps({ ...open, modeNotice: "   " }, "internal")).toBeNull();
  });
  it("공개 단계 none·미승인·대상 아님이면 null", () => {
    expect(agentUiProps({ ...open, stage: "none" }, "internal")).toBeNull();
    expect(agentUiProps({ ...open, noticeApproved: false }, "internal")).toBeNull();
    expect(agentUiProps({ ...open, targets: { guest: false, member: true } }, "guest")).toBeNull();
  });
  it("검색 카드는 모드가 열려 있고 검색어가 있을 때만", () => {
    const ui = agentUiProps(open, "member");
    expect(searchCardVisible(ui, "아파트 7억에 사면 취득세?")).toBe(true);
    expect(searchCardVisible(ui, "  ")).toBe(false);
    expect(searchCardVisible(null, "취득세")).toBe(false);
  });
});

describe("진입 맥락 ID (ASK-13)", () => {
  it("맥락은 첫 질문에만 붙는다", () => {
    expect(withEntryContext("질문", "law", "L100", 0)).toBe("[조문 L100] 질문");
    expect(withEntryContext("질문", "law", "L100", 1)).toBe("질문");
    expect(withEntryContext("질문", "law", null, 0)).toBe("질문");
    expect(withEntryContext("질문", null, "L100", 0)).toBe("질문");
  });
  it("ID 모양: 허용 문자·길이 80 경계·거부 문자", () => {
    expect(parseEntryId(undefined)).toBeNull();
    expect(parseEntryId("case:2024-1")).toBe("case:2024-1");
    expect(parseEntryId("a".repeat(80))).toBe("a".repeat(80));
    expect(parseEntryId("a".repeat(81))).toBe("invalid");
    expect(parseEntryId("a b")).toBe("invalid");
    expect(parseEntryId("<x>")).toBe("invalid");
    expect(parseEntryId(5)).toBe("invalid");
  });
  it("요청 스키마가 entryId를 검사한다", () => {
    expect(parseAskRequest({ message: "q", entry: "law", entryId: "L100" })).toMatchObject({ ok: true, value: { entryId: "L100" } });
    expect(parseAskRequest({ message: "q", entryId: "bad id" }).ok).toBe(false);
    expect(parseAskRequest({ message: "q" })).toMatchObject({ ok: true, value: { entryId: null, saveOff: false } });
  });
});
