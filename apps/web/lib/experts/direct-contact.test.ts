import { describe, expect, test } from "vitest";
import { directContactErrors, parseDirectContact } from "./direct-contact";

describe("전문가 상담 바로 연락 설정 (expert_direct_contact — PO 2026-11-01)", () => {
  const good = { phone: "010-1234-5678", kakaoUrl: "https://open.kakao.com/o/abcDEF12", freeScope: "첫 상담 30분 전화 무료" };

  test("세 칸이 맞으면 저장 문제 0, 화면 값은 tel: 주소를 숫자만으로 만든다", () => {
    expect(directContactErrors(good)).toEqual([]);
    expect(parseDirectContact(good)).toEqual({ phone: "010-1234-5678", telHref: "tel:01012345678", kakaoUrl: "https://open.kakao.com/o/abcDEF12", freeScope: "첫 상담 30분 전화 무료" });
  });

  test("빈 객체는 저장할 수 있고 화면에는 아무것도 보이지 않는다(null)", () => {
    expect(directContactErrors({})).toEqual([]);
    expect(parseDirectContact({})).toBeNull();
    expect(parseDirectContact({ phone: "", kakaoUrl: "", freeScope: "" })).toBeNull();
  });

  test("틀린 값은 저장 거부 — 모르는 칸·글자 아님·0으로 시작하지 않는 번호·카카오 밖 주소·쿼리·81자", () => {
    expect(directContactErrors({ ...good, email: "a@b.c" })[0]).toMatch(/^email: 모르는 칸/);
    expect(directContactErrors({ phone: 1012345678 })[0]).toMatch(/^phone: 글자/);
    expect(directContactErrors({ phone: "1588-0000" })[0]).toMatch(/^phone:/);
    expect(directContactErrors({ phone: "010-1234-56789-0" })[0]).toMatch(/^phone:/);
    expect(directContactErrors({ kakaoUrl: "https://example.com/o/abc" })[0]).toMatch(/^kakaoUrl:/);
    expect(directContactErrors({ kakaoUrl: "https://open.kakao.com/o/abc?x=1" })[0]).toMatch(/^kakaoUrl:/);
    expect(directContactErrors({ freeScope: "가".repeat(81) })[0]).toMatch(/^freeScope: 80자/);
    expect(directContactErrors({ freeScope: "가".repeat(80) })).toEqual([]);
    expect(directContactErrors([])[0]).toMatch(/객체/);
  });

  test("공개 화면은 틀린 칸만 숨기고 나머지는 보인다", () => {
    expect(parseDirectContact({ phone: "1588-0000", kakaoUrl: good.kakaoUrl })).toEqual({ phone: null, telHref: null, kakaoUrl: good.kakaoUrl, freeScope: null });
    expect(parseDirectContact("010-1234-5678")).toBeNull();
  });
});
