import { describe, expect, it } from "vitest";
import { DIGITIZE_STAGES, nextStage } from "./stages";

describe("이관 다음 단계 (nextStage)", () => {
  it("교정 앞 단계까지는 한 단계씩 앞으로 간다", () => {
    expect(nextStage("rights_confirmed")).toBe("extracted");
    expect(nextStage("extracted")).toBe("structured");
    expect(nextStage("structured")).toBe("proofread");
  });
  it("교정 단계와 승인 단계는 다음 단계가 없다 (승인은 승인 함수로만)", () => {
    expect(nextStage("proofread")).toBeNull();
    expect(nextStage("approved")).toBeNull();
  });
  it("단계 목록 순서는 DB 상태기계와 같다", () => {
    expect([...DIGITIZE_STAGES]).toEqual(["rights_confirmed", "extracted", "structured", "proofread", "approved"]);
  });
});
