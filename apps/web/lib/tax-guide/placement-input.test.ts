import { describe, expect, it } from "vitest";
import { parsePlacement } from "./placement-input";

const ok = { op: "add", guide_id: 3, surface: "trust_type", target_key: "test-structure", sort: 2 };

describe("parsePlacement", () => {
  it("정상 입력은 값으로 바꾸고 글자 숫자도 받는다", () => {
    expect(parsePlacement(ok)).toEqual({ ok: true, value: { op: "add", guideId: 3, surface: "trust_type", targetKey: "test-structure", sort: 2 } });
    expect(parsePlacement({ ...ok, guide_id: "3", sort: "" })).toMatchObject({ ok: true, value: { guideId: 3, sort: 0 } });
  });
  it("경계: sort 0·1000은 통과, 1001은 거부", () => {
    expect(parsePlacement({ ...ok, sort: 0 }).ok).toBe(true);
    expect(parsePlacement({ ...ok, sort: 1000 }).ok).toBe(true);
    expect(parsePlacement({ ...ok, sort: 1001 }).ok).toBe(false);
  });
  it("목록 밖 op·surface, 없는 가이드 번호, 모양 밖 대상 키를 모두 모아서 거부", () => {
    const r = parsePlacement({ op: "move", guide_id: 0, surface: "home", target_key: "Bad Key" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0]).sort()).toEqual(["guide_id", "op", "surface", "target_key"]);
  });
  it("대상 키 100자는 통과, 101자는 거부", () => {
    expect(parsePlacement({ ...ok, target_key: "a".repeat(100) }).ok).toBe(true);
    expect(parsePlacement({ ...ok, target_key: "a".repeat(101) }).ok).toBe(false);
  });
});
