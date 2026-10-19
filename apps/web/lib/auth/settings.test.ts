// 회원·시도 제한·보존 기한 설정 검사 시험 — 설계 문서 W2-e 2.2의 JSON 블록(= DB 씨앗)이 이 검사를 통과하고, 틀린 값은 문장으로 거부한다
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  THROTTLE_SCOPES,
  checkAuthLimitsSetting,
  checkMemberSetting,
  checkPrivacyRetentionSetting,
  parseAuthLimits,
  parseMemberSettings,
} from "./settings";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-e_설계.md"), "utf8");
const sec2 = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"))!;
const block = (key: string) => JSON.parse(sec2.match(new RegExp("^#### `" + key + "`[^\\n]*\\n+```json\\n([\\s\\S]*?)\\n```", "m"))![1]!) as Record<string, unknown>;
const AUTH = block("auth_limits");
const MEMBER = block("member");
const RETENTION = block("privacy_retention");
type Scoped = Record<string, Record<string, unknown>>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const limitsOf = (v: Record<string, unknown>): Scoped => v as unknown as Scoped;

describe("설계 2.2 씨앗 블록은 검사를 통과한다", () => {
  test("auth_limits — 12개 범위, 한도 값은 설계 4.1 (이메일+IP 5회/15분 · 이메일 20회/15분 · IP 30회/15분)", () => {
    expect(checkAuthLimitsSetting(AUTH, null)).toEqual([]);
    const parsed = parseAuthLimits(AUTH)!;
    expect(Object.keys(parsed).sort()).toEqual([...THROTTLE_SCOPES].sort());
    expect(parsed.login_pair).toEqual({ window: 900, limit: 5 });
    expect(parsed.login_account).toEqual({ window: 900, limit: 20 });
    expect(parsed.login_ip).toEqual({ window: 900, limit: 30 });
    expect(parsed.password_change).toEqual({ window: 900, limit: 5 });
  });
  test("member", () => {
    expect(checkMemberSetting(MEMBER, null)).toEqual([]);
    expect(parseMemberSettings(MEMBER)).toEqual({
      interestRegionLimit: 3,
      interestMax: 20,
      displayNameChars: 30,
      signupConfirmHours: 24,
      passwordMinChars: 10,
      passwordMaxBytes: 72,
    });
  });
  test("privacy_retention", () => {
    expect(checkPrivacyRetentionSetting(RETENTION, null)).toEqual([]);
  });
});

describe("auth_limits 검사", () => {
  test.each([
    ["창 0초", (v: Scoped) => (v.login_pair!.window = 0), "login_pair.window"],
    ["창 86401초", (v: Scoped) => (v.login_pair!.window = 86401), "login_pair.window"],
    ["한도 0", (v: Scoped) => (v.login_ip!.limit = 0), "login_ip.limit"],
    ["한도 100001", (v: Scoped) => (v.login_ip!.limit = 100001), "login_ip.limit"],
    ["소수 한도", (v: Scoped) => (v.login_account!.limit = 2.5), "login_account.limit"],
    ["글자 창", (v: Scoped) => (v.form_ip!.window = "3600"), "form_ip.window"],
    ["범위 빠짐", (v: Scoped) => delete v.reset_ip, "reset_ip"],
    ["모르는 범위", (v: Scoped) => (v.login_everything = { window: 1, limit: 1 }), "login_everything"],
    ["범위 안 모르는 칸", (v: Scoped) => (v.login_pair!.burst = 3), "login_pair.burst"],
    ["객체가 아닌 범위", (v: Scoped) => (v.login_pair = 5 as unknown as Record<string, unknown>), "login_pair"],
  ])("%s → 거부", (_name, mutate, mention) => {
    const v = clone(AUTH);
    mutate(limitsOf(v));
    // 버전을 같이 올려 '버전 규칙'이 아니라 값 규칙만 본다
    v.version = "시험";
    const errors = checkAuthLimitsSetting(v, AUTH);
    expect(errors.some((e) => e.includes(mention)), errors.join(" / ")).toBe(true);
    expect(parseAuthLimits(v)).toBeNull();
  });

  test("경계 — 창 1·86400초, 한도 1·100000회는 받는다", () => {
    const v = clone(AUTH);
    v.version = "경계";
    limitsOf(v).login_pair = { window: 1, limit: 1 };
    limitsOf(v).login_ip = { window: 86400, limit: 100000 };
    expect(checkAuthLimitsSetting(v, AUTH)).toEqual([]);
    expect(parseAuthLimits(v)?.login_ip).toEqual({ window: 86400, limit: 100000 });
  });

  test("값을 바꾸고 version을 그대로 두면 거부, version을 올리면 통과", () => {
    const v = clone(AUTH);
    limitsOf(v).login_pair!.limit = 4;
    expect(checkAuthLimitsSetting(v, AUTH).join()).toContain("버전도 바꿔야");
    v.version = "2026-10-21.1";
    expect(checkAuthLimitsSetting(v, AUTH)).toEqual([]);
    // 값이 같으면 version이 같아도 된다 (칸 순서만 다른 경우 포함)
    expect(checkAuthLimitsSetting(Object.fromEntries(Object.entries(AUTH).reverse()), AUTH)).toEqual([]);
  });

  test("parse는 JSON이 아닌 값·빈 객체를 null로 돌려준다(호출하는 쪽이 닫는다)", () => {
    for (const bad of [null, undefined, 5, "x", [], {}]) expect(parseAuthLimits(bad)).toBeNull();
  });
});

describe("member 검사", () => {
  test.each([
    ["관심 지역 상한 0", "interest_region_limit", 0],
    ["관심 지역 상한 21", "interest_region_limit", 21],
    ["표시 이름 31글자(DB check가 30)", "display_name_chars", 31],
    ["비밀번호 최소 7글자(너무 약함)", "password_min_chars", 7],
    ["비밀번호 최대 73바이트(bcrypt 72)", "password_max_bytes", 73],
    ["가입 확인 0시간", "signup_confirm_hours", 0],
    ["글자 상한", "interest_max", "20"],
  ])("%s → 거부", (_name, field, bad) => {
    const v = { ...MEMBER, version: "시험", [field as string]: bad };
    const errors = checkMemberSetting(v, MEMBER);
    expect(errors.some((e) => e.startsWith(field as string)), errors.join(" / ")).toBe(true);
    expect(parseMemberSettings(v)).toBeNull();
  });
  test("경계 — 관심 지역 5곳(PRD 13장의 다른 후보)·비밀번호 최소 8글자·최대 72바이트는 받는다", () => {
    const v = { ...MEMBER, version: "경계", interest_region_limit: 5, password_min_chars: 8 };
    expect(checkMemberSetting(v, MEMBER)).toEqual([]);
    expect(parseMemberSettings(v)?.interestRegionLimit).toBe(5);
  });
  test("최소 글자가 최대 바이트보다 크면 거부", () => {
    const v = { ...MEMBER, version: "시험", password_min_chars: 40, password_max_bytes: 30 };
    expect(checkMemberSetting(v, MEMBER).join()).toContain("password_min_chars");
  });
  test("모르는 칸·빠진 칸은 거부", () => {
    expect(checkMemberSetting({ ...MEMBER, version: "x", extra: 1 }, MEMBER).join()).toContain("extra");
    const rest: Record<string, unknown> = { ...MEMBER, version: "x" };
    delete rest.interest_max;
    expect(checkMemberSetting(rest, MEMBER).join()).toContain("interest_max");
  });
});

describe("privacy_retention 검사", () => {
  test.each([
    ["확인 안 된 가입 0일", "unconfirmed_signup_days", 0],
    ["철회 동의 366일", "revoked_consent_days", 366],
    ["문의 연락처 3651일", "inquiry_contact_days", 3651],
    ["시도 해시 0시간", "throttle_hours", 0],
  ])("%s → 거부", (_name, field, bad) => {
    const errors = checkPrivacyRetentionSetting({ ...RETENTION, version: "시험", [field as string]: bad }, RETENTION);
    expect(errors.some((e) => e.startsWith(field as string)), errors.join(" / ")).toBe(true);
  });
  test("경계 — 1일·365일·시도 해시 1시간은 받는다", () => {
    expect(checkPrivacyRetentionSetting({ ...RETENTION, version: "경계", unconfirmed_signup_days: 1, revoked_consent_days: 365, throttle_hours: 1 }, RETENTION)).toEqual([]);
  });
});
