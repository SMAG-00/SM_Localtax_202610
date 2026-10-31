import { describe, expect, it } from "vitest";
import { confirmedChecklist, publishConfirmItems, uncheckedConfirmSentence, uncheckedConfirms } from "./publish-confirm";

describe("publishConfirmItems — 발행 전 작성자 확인 항목", () => {
  it("지역 기사는 근거·관계·광고 독립성 3항목 (DB 트리거 키와 같다)", () => {
    expect(publishConfirmItems({ regional: true, financeCase: false }).map((c) => c.id)).toEqual(["evidence", "relation", "ad_independence"]);
  });

  it("금융 사례는 공개 자료 범위 1항목", () => {
    expect(publishConfirmItems({ regional: false, financeCase: true }).map((c) => c.id)).toEqual(["public_scope"]);
  });

  it("둘 다면 4항목, 둘 다 아니면 없음", () => {
    expect(publishConfirmItems({ regional: true, financeCase: true })).toHaveLength(4);
    expect(publishConfirmItems({ regional: false, financeCase: false })).toEqual([]);
  });
});

describe("uncheckedConfirms·confirmedChecklist — 체크한 값만 쓴다", () => {
  const items = publishConfirmItems({ regional: true, financeCase: false });

  it("본문이 없거나 객체가 아니면 모두 체크 안 함", () => {
    expect(uncheckedConfirms(items, undefined).map((c) => c.id)).toEqual(["evidence", "relation", "ad_independence"]);
    expect(uncheckedConfirms(items, ["evidence"]).map((c) => c.id)).toEqual(["evidence", "relation", "ad_independence"]);
    expect(confirmedChecklist(items, null)).toEqual({});
  });

  it("값이 정확히 true인 키만 체크 — 'true' 글자·1은 체크가 아니다", () => {
    const confirms = { evidence: true, relation: "true", ad_independence: 1 };
    expect(uncheckedConfirms(items, confirms).map((c) => c.id)).toEqual(["relation", "ad_independence"]);
    expect(confirmedChecklist(items, confirms)).toEqual({ evidence: true });
  });

  it("항목 밖의 키는 checklist에 넣지 않는다", () => {
    expect(confirmedChecklist(items, { evidence: true, relation: true, ad_independence: true, public_scope: true, selfPublish: true })).toEqual({
      evidence: true,
      relation: true,
      ad_independence: true,
    });
  });

  it("빠진 항목은 짧은 이름으로 한 문장에", () => {
    expect(uncheckedConfirmSentence(uncheckedConfirms(items, { relation: true }))).toBe("발행 전 확인 항목에 체크해 주세요 — 근거·광고 독립성 (작성자 책임 확인)");
  });
});
