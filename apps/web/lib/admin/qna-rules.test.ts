import { describe, expect, test } from "vitest";
import { expiryOf, parseEnd, parseHide, parseLink, parseReportHandle, parseSanctionAdd, reportOverdue } from "./qna-rules";

const UID = "123e4567-e89b-42d3-a456-426614174000";

describe("계정 연결 입력 (EXP-01·02)", () => {
  test("정상 입력은 그날 끝(한국) 기한으로 바뀐다", () => {
    const r = parseLink({ user_id: UID.toUpperCase(), profile_id: "7", expires_on: "2027-10-27" });
    expect(r).toEqual({ ok: true, value: { userId: UID, profileId: 7, expiresAt: "2027-10-27T14:59:59.000Z" } });
  });
  test("UUID 아닌 계정·0번 프로필·없는 달력 날짜는 거부", () => {
    expect(parseLink({ user_id: "abc", profile_id: 1, expires_on: "2027-10-27" }).ok).toBe(false);
    expect(parseLink({ user_id: UID, profile_id: 0, expires_on: "2027-10-27" }).ok).toBe(false);
    expect(expiryOf("2027-02-30")).toBeNull();
    expect(expiryOf("2028-02-29")).not.toBeNull();
    expect(expiryOf("27-10-27")).toBeNull();
  });
  test("해제 사유는 1~300자", () => {
    expect(parseEnd({ id: 1, reason: "" }).ok).toBe(false);
    expect(parseEnd({ id: 1, reason: "가".repeat(300) }).ok).toBe(true);
    expect(parseEnd({ id: 1, reason: "가".repeat(301) }).ok).toBe(false);
  });
});

describe("라운지 관리 입력 (QNA-05)", () => {
  test("숨김은 대상 종류·번호·사유가 모두 필요", () => {
    expect(parseHide({ type: "post", id: 1, reason: "x" }).ok).toBe(false);
    expect(parseHide({ type: "answer", id: 1, reason: "" }).ok).toBe(false);
    expect(parseHide({ type: "answer", id: 4, reason: "광고성" })).toEqual({ ok: true, value: { type: "answer", id: 4, reason: "광고성" } });
  });
  test("기각한 신고에 숨김·제재를 함께 하면 거부, 받아들인 신고는 허용", () => {
    expect(parseReportHandle({ id: 1, decision: "dismissed", hide: true, note: "n" }).ok).toBe(false);
    expect(parseReportHandle({ id: 1, decision: "dismissed", sanction_days: 3, note: "n" }).ok).toBe(false);
    expect(parseReportHandle({ id: 1, decision: "upheld", hide: true, sanction_days: "7", note: "n" })).toEqual({ ok: true, value: { id: 1, decision: "upheld", hide: true, sanctionDays: 7, note: "n" } });
    expect(parseReportHandle({ id: 1, decision: "upheld", note: "" }).ok).toBe(false);
    expect(parseReportHandle({ id: 1, decision: "upheld", sanction_days: 0, note: "n" }).ok).toBe(false);
  });
  test("제재 기간을 비우면 해제할 때까지, 0일은 거부", () => {
    expect(parseSanctionAdd({ user_id: UID, reason: "r" })).toEqual({ ok: true, value: { userId: UID, reason: "r", days: null } });
    expect(parseSanctionAdd({ user_id: UID, reason: "r", days: 0 }).ok).toBe(false);
  });
  test("신고 처리 목표 경계 - 정확히 목표 시각은 아직 늦지 않고 1ms 뒤부터 경과", () => {
    const due = "2026-10-28T05:00:00.000Z";
    expect(reportOverdue(due, new Date(due))).toBe(false);
    expect(reportOverdue(due, new Date("2026-10-28T05:00:00.001Z"))).toBe(true);
  });
});
