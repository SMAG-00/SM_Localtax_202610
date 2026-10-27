import { describe, expect, it } from "vitest";
import { decideQuota, hasUnlimitedWording, parseConsume, readDailyLimit, remainingLabel } from "./quota";
import { isExpired, memberRetentionDays, purgeTargets, retainUntil, shouldStoreText } from "./retention";
import { modeAvailable, parseAskModeGate, type AskModeGate } from "./rollout";

const open: AskModeGate = { taxbot: true, stage: "4c", noticeApproved: true, noticeVersion: "v1", modeNotice: "시험용 고지", answerFooter: "시험용 하단", targets: { guest: true, member: true } };

describe("모드 공개 판정 (CHAT-15 · HOME-10)", () => {
  it("네 조건이 모두 참이면 3종 계정 모두 보인다", () => {
    expect(modeAvailable(open, "internal")).toBe(true);
    expect(modeAvailable(open, "member")).toBe(true);
    expect(modeAvailable(open, "guest")).toBe(true);
  });
  it("기능 키가 꺼지면 3종 모두 0", () => {
    for (const a of ["internal", "member", "guest"] as const) expect(modeAvailable({ ...open, taxbot: false }, a)).toBe(false);
  });
  it("공개 단계 none(리포트·승인 없음)이면 3종 모두 0", () => {
    for (const a of ["internal", "member", "guest"] as const) expect(modeAvailable({ ...open, stage: "none" }, a)).toBe(false);
  });
  it("모드 고지 미승인이면 3종 모두 0", () => {
    for (const a of ["internal", "member", "guest"] as const) expect(modeAvailable({ ...open, noticeApproved: false }, a)).toBe(false);
  });
  it("4a·4b는 내부 계정만, 4c에서 대상 설정대로 회원·비회원", () => {
    for (const stage of ["4a", "4b"] as const) {
      expect(modeAvailable({ ...open, stage }, "internal")).toBe(true);
      expect(modeAvailable({ ...open, stage }, "member")).toBe(false);
      expect(modeAvailable({ ...open, stage }, "guest")).toBe(false);
    }
    expect(modeAvailable({ ...open, targets: { guest: false, member: true } }, "guest")).toBe(false);
    expect(modeAvailable({ ...open, targets: { guest: false, member: true } }, "member")).toBe(true);
  });
  it("DB 값이 비었거나 모양이 틀리면 닫힌다", () => {
    expect(parseAskModeGate(null).stage).toBe("none");
    expect(modeAvailable(parseAskModeGate({}), "internal")).toBe(false);
    expect(modeAvailable(parseAskModeGate({ taxbot: "true", stage: "9z", notice_approved: 1 }), "internal")).toBe(false);
  });
  it("DB 값을 그대로 옮긴다", () => {
    const g = parseAskModeGate({ taxbot: true, stage: "4c", notice_approved: true, notice_version: "v2", mode_notice: "a", answer_footer: "b", targets: { guest: true, member: false } });
    expect(g).toMatchObject({ stage: "4c", noticeVersion: "v2", modeNotice: "a", answerFooter: "b", targets: { guest: true, member: false } });
  });
});

describe("하루 한도 (ASK-10) 경계", () => {
  it("비회원 한도 3: 1~3번째 허용, 4번째 가입 안내", () => {
    expect(decideQuota(0, 3, "guest")).toMatchObject({ allowed: true, used: 1, remaining: 2 });
    expect(decideQuota(2, 3, "guest")).toMatchObject({ allowed: true, used: 3, remaining: 0 });
    expect(decideQuota(3, 3, "guest")).toMatchObject({ allowed: false, code: "limit", next: "signup" });
  });
  it("회원은 소진 시 업그레이드, 프리미엄은 내일", () => {
    expect(decideQuota(10, 10, "member")).toMatchObject({ allowed: false, next: "upgrade" });
    expect(decideQuota(100, 100, "premium")).toMatchObject({ allowed: false, next: "tomorrow" });
  });
  it("한도 값이 없거나 1 미만·소수면 닫힘 (코드 상수 0)", () => {
    expect(readDailyLimit({}, "guest")).toBeNull();
    expect(readDailyLimit({ guest_daily: 0 }, "guest")).toBeNull();
    expect(readDailyLimit({ guest_daily: 2.5 }, "guest")).toBeNull();
    expect(readDailyLimit({ guest_daily: 3, member_daily: 10 }, "member")).toBe(10);
    expect(decideQuota(0, null, "guest")).toMatchObject({ allowed: false, code: "limit_missing" });
  });
  it("DB 차감 응답을 해석한다 (허용·한도 초과·깨진 응답)", () => {
    expect(parseConsume({ allowed: true, used: 3, limit: 3 }, "guest")).toMatchObject({ allowed: true, remaining: 0 });
    expect(parseConsume({ allowed: false, code: "limit", used: 3, limit: 3 }, "guest")).toMatchObject({ allowed: false, next: "signup" });
    expect(parseConsume("x", "guest")).toMatchObject({ allowed: false, code: "limit_missing" });
  });
  it("'무제한'류 낱말을 잡는다", () => {
    expect(hasUnlimitedWording("무제한 질문")).toBe(true);
    expect(hasUnlimitedWording("제한 없이 이용")).toBe(true);
    expect(hasUnlimitedWording(remainingLabel(2, 3))).toBe(false);
    expect(remainingLabel(2, 3)).toBe("오늘 3회 중 2회 남았습니다");
    expect(remainingLabel(null, null)).not.toMatch(/\d/u);
  });
});

describe("대화 보존·저장 끄기 (ASK-12 · COMPLY-03) 경계", () => {
  const created = new Date("2026-10-01T00:00:00Z");
  it("보존일 정각은 만료, 1ms 전은 아직", () => {
    const until = retainUntil(created, 30);
    expect(isExpired(until, new Date(until.getTime() - 1))).toBe(false);
    expect(isExpired(until, until)).toBe(true);
  });
  it("두 기한을 각자 값으로 파기한다 (비회원 30일·회원 90일 예시)", () => {
    const now = new Date("2026-11-05T00:00:00Z"); // 생성 후 35일
    const rows = [
      { kind: "guest" as const, retainUntil: retainUntil(created, 30) },
      { kind: "member" as const, retainUntil: retainUntil(created, 90) },
      { kind: "guest" as const, retainUntil: retainUntil(created, 60) },
    ];
    expect(purgeTargets(rows, now)).toEqual({ guest: 1, member: 0 });
  });
  it("저장 끔이면 글 저장 0, 회원 보존일이 비면 0, 비회원은 기본 저장", () => {
    expect(shouldStoreText({ kind: "member", saveEnabled: false, memberDays: 90 })).toBe(false);
    expect(shouldStoreText({ kind: "member", saveEnabled: true, memberDays: null })).toBe(false);
    expect(shouldStoreText({ kind: "member", saveEnabled: true, memberDays: 90 })).toBe(true);
    expect(shouldStoreText({ kind: "guest", saveEnabled: false, memberDays: null })).toBe(false);
    expect(shouldStoreText({ kind: "guest", saveEnabled: true, memberDays: null })).toBe(true);
  });
  it("회원 보존일은 양의 정수만", () => {
    expect(memberRetentionDays({})).toBeNull();
    expect(memberRetentionDays({ member_days: 0 })).toBeNull();
    expect(memberRetentionDays({ member_days: 1.5 })).toBeNull();
    expect(memberRetentionDays({ member_days: 90 })).toBe(90);
  });
});
