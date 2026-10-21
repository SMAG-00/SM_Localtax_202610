import { describe, expect, it } from "vitest";
import { CLOSED_FEATURES } from "@/lib/server/public/settings";
import type { Features } from "@/lib/server/public/constants";
import { effectiveFeatures, featureEnableErrors, featureOpen } from "./feature-open";

const on = (...keys: Array<keyof Features>): Features => ({ ...CLOSED_FEATURES, ...Object.fromEntries(keys.map((k) => [k, true])) }) as Features;
const docs = (...k: string[]) => new Set(k);

describe("effectiveFeatures (설계 2.3 · 6.3)", () => {
  it("켜졌어도 게시본이 없으면 닫힌다", () => {
    expect(featureOpen("page_privacy", on("page_privacy"), docs(), true)).toBe(false);
    expect(featureOpen("page_privacy", on("page_privacy"), docs("privacy"), true)).toBe(true);
  });
  it("게시본이 있어도 키가 꺼져 있으면 닫힌다", () => {
    expect(featureOpen("page_privacy", on(), docs("privacy"), true)).toBe(false);
  });
  it("page_help는 개인정보처리방침 게시본이 필요하다", () => {
    expect(featureOpen("page_help", on("page_help"), docs("terms"), true)).toBe(false);
    expect(featureOpen("page_help", on("page_help"), docs("privacy"), true)).toBe(true);
  });
  it("members는 약관·처리방침 게시본과 메일 설정이 모두 있어야 열린다", () => {
    const f = on("members");
    expect(featureOpen("members", f, docs("terms", "privacy"), true)).toBe(true);
    expect(featureOpen("members", f, docs("terms"), true)).toBe(false);
    expect(featureOpen("members", f, docs("privacy"), true)).toBe(false);
    expect(featureOpen("members", f, docs("terms", "privacy"), false)).toBe(false);
  });
  it("page_advertise는 광고·제휴 안내 + 처리방침 + 광고 정책의 게시본과 그 두 기능이 열려 있어야 한다", () => {
    const all = docs("advertise", "privacy", "ad-policy");
    expect(featureOpen("page_advertise", on("page_advertise", "page_privacy", "page_ad_policy"), all, true)).toBe(true);
    expect(featureOpen("page_advertise", on("page_advertise", "page_privacy"), all, true)).toBe(false);
    expect(featureOpen("page_advertise", on("page_advertise", "page_privacy", "page_ad_policy"), docs("advertise", "privacy"), true)).toBe(false);
  });
  it("의존이 없는 키는 값만 본다", () => {
    expect(effectiveFeatures(on("calc"), docs(), false).calc).toBe(true);
  });
});

describe("featureEnableErrors", () => {
  it("게시본 없이 새로 켜면 사유를 돌려준다", () => {
    const e = featureEnableErrors(on(), on("page_terms"), docs(), true);
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("게시본이 없는 정책 페이지는 켤 수 없습니다");
  });
  it("메일 설정이 없으면 members를 켤 수 없다", () => {
    const e = featureEnableErrors(on(), on("members"), docs("terms", "privacy"), false);
    expect(e).toEqual(["feature_flags.members: 메일 설정이 없어 켤 수 없습니다"]);
  });
  it("이미 켜져 있던 키·게시본이 있는 키는 오류가 없다", () => {
    expect(featureEnableErrors(on("page_terms"), on("page_terms", "calc"), docs(), true)).toEqual([]);
    expect(featureEnableErrors(on(), on("page_terms"), docs("terms"), true)).toEqual([]);
  });
  it("page_advertise는 먼저 켜야 하는 기능이 꺼져 있으면 거부한다", () => {
    const e = featureEnableErrors(on(), on("page_advertise"), docs("advertise", "privacy", "ad-policy"), true);
    expect(e.some((x) => x.includes("먼저 켜야 하는 기능"))).toBe(true);
  });
});

describe("featureEnableErrors — 브랜드 키 (W3 7단계 설계 2.4)", () => {
  const ready = { reviewed: true, careerApproved: true, peopleReady: true };
  it("brand_copy — 광고 규정 감수·경력 증빙 승인 중 빠진 것마다 사유 한 줄, 둘 다 있으면 0", () => {
    expect(featureEnableErrors(on(), on("brand_copy"), docs(), true, { ...ready, reviewed: false })).toEqual([expect.stringContaining("brand_copy_review")]);
    expect(featureEnableErrors(on(), on("brand_copy"), docs(), true, { ...ready, careerApproved: false })).toEqual([expect.stringContaining("career_claim_approved")]);
    expect(featureEnableErrors(on(), on("brand_copy"), docs(), true, { reviewed: false, careerApproved: false, peopleReady: true })).toHaveLength(2);
    expect(featureEnableErrors(on(), on("brand_copy"), docs(), true, ready)).toEqual([]);
  });
  it("people_pages — 동의서·증빙 약력이 있는 인물이 없으면 거부, 있으면 0", () => {
    expect(featureEnableErrors(on(), on("people_pages"), docs(), true, { ...ready, peopleReady: false })).toEqual([expect.stringContaining("people_pages")]);
    expect(featureEnableErrors(on(), on("people_pages"), docs(), true, ready)).toEqual([]);
  });
  it("브랜드 기록을 모르면(인자 없음) 브랜드 키 켜기는 거부, 이미 켜진 키는 다시 보지 않는다", () => {
    expect(featureEnableErrors(on(), on("brand_copy", "people_pages"), docs(), true)).toHaveLength(3);
    expect(featureEnableErrors(on("brand_copy", "people_pages"), on("brand_copy", "people_pages", "calc"), docs(), true)).toEqual([]);
  });
});
