import { describe, expect, it } from "vitest";
import { allowedTargets, canApprove, hoursOpen, isStale, parseAssign, parseSourceUpdate, parseTransition } from "./rules";

describe("검수 큐 규칙", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("72시간 경고 - 71시간 59분은 경고 0, 72시간 1분은 경고 1, 끝난 상태는 경고 0", () => {
    expect(isStale("in_review", "2026-10-25T12:01:00Z", now)).toBe(false);
    expect(hoursOpen("2026-10-25T12:01:00Z", now)).toBeCloseTo(71.983, 2);
    expect(isStale("in_review", "2026-10-25T11:59:00Z", now)).toBe(true);
    expect(isStale("published", "2026-10-01T00:00:00Z", now)).toBe(false);
    expect(isStale("rejected", "2026-10-01T00:00:00Z", now)).toBe(false);
  });

  it("허용 동작 표 - 처음 상태는 검수 시작과 반려만, 실패는 3번째 시도까지만 다시 시도", () => {
    expect(allowedTargets("drafted", 0)).toEqual(["in_review", "rejected"]);
    expect(allowedTargets("in_review", 0)).toEqual(["approved", "rejected"]);
    expect(allowedTargets("approved", 0)).toEqual(["published"]);
    expect(allowedTargets("failed", 2)).toEqual(["retry"]);
    expect(allowedTargets("failed", 3)).toEqual([]);
    expect(allowedTargets("published", 0)).toEqual([]);
  });

  it("승인 버튼은 필수 체크를 모두 확인해야 열린다", () => {
    const req = ["a", "b", "c"];
    expect(canApprove(req, ["a", "b"])).toBe(false);
    expect(canApprove(req, ["c", "b", "a", "x"])).toBe(true);
    expect(canApprove([], [])).toBe(true);
  });

  it("전이 입력 - 반려 사유 없음, 허용 밖 목적지, 잘못된 번호, 문자열 아닌 체크 거부", () => {
    expect(parseTransition({ id: 3, to: "rejected" })).toEqual({ ok: false, errors: ["reason: 반려는 사유가 필요합니다"] });
    expect(parseTransition({ id: 3, to: "rejected", reason: "  " }).ok).toBe(false);
    expect(parseTransition({ id: 0, to: "published" }).ok).toBe(false);
    expect(parseTransition({ id: 3, to: "failed" }).ok).toBe(false);
    expect(parseTransition({ id: 3, to: "approved", checked: [1] }).ok).toBe(false);
    expect(parseTransition({ id: 3, to: "approved", checked: ["a"], parts: ["x"] })).toEqual({ ok: true, value: { id: 3, to: "approved", reason: null, checked: ["a"], parts: ["x"] } });
    expect(parseTransition({ id: 3, to: "rejected", reason: " 근거 부족 " })).toEqual({ ok: true, value: { id: 3, to: "rejected", reason: "근거 부족", checked: [], parts: null } });
  });

  it("배정과 원천 갱신 입력 - 허용으로 바꿀 때 근거 필수", () => {
    expect(parseAssign({ id: 1, assignee: "" }).ok).toBe(false);
    expect(parseAssign({ id: 1, assignee: "담당" })).toEqual({ ok: true, value: { id: 1, assignee: "담당" } });
    expect(parseSourceUpdate({ key: "law_api", op: "terms", terms: "allowed" }).ok).toBe(false);
    expect(parseSourceUpdate({ key: "law_api", op: "terms", terms: "allowed", note: "시험용 근거" }).ok).toBe(true);
    expect(parseSourceUpdate({ key: "Law API", op: "contract" }).ok).toBe(false);
    expect(parseSourceUpdate({ key: "law_api", op: "terms", terms: "open" }).ok).toBe(false);
    expect(parseSourceUpdate({ key: "law_api", op: "contract" })).toEqual({ ok: true, value: { key: "law_api", op: "contract", note: null } });
  });
});
