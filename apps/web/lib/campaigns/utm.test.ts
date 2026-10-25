import { describe, expect, test } from "vitest";
import { captureCampaignTags, parseUtmRegistry, registeredOrOther, stripTrackingParams } from "./utm";

const REG = parseUtmRegistry({ source: ["naver", "kakao"], medium: ["cpc", "display"], content: [] });

describe("캠페인 태그 변환", () => {
  test("등록된 값은 그대로, 대소문자와 앞뒤 공백은 무시한다", () => {
    expect(captureCampaignTags({ utm_source: " Naver ", utm_medium: "CPC" }, REG)).toEqual({ source: "naver", medium: "cpc" });
  });
  test("등록 밖 값과 없는 값은 other", () => {
    expect(captureCampaignTags({ utm_source: "홍길동@example.com", utm_medium: "x" }, REG)).toEqual({ source: "other", medium: "other" });
    expect(captureCampaignTags({}, REG)).toEqual({ source: "other", medium: "other" });
  });
  test("등록 목록이 비어 있으면 모든 값이 other", () => {
    expect(captureCampaignTags({ utm_source: "naver" }, parseUtmRegistry({}))).toEqual({ source: "other", medium: "other" });
  });
  test("값이 20자를 넘으면 등록 목록에 있어도 other (길이 경계)", () => {
    expect(registeredOrOther("a".repeat(20), ["a".repeat(20)])).toBe("a".repeat(20));
    expect(registeredOrOther("a".repeat(21), ["a".repeat(21)])).toBe("other");
  });
  test("같은 태그가 여러 번 오면 첫 값만 쓴다", () => {
    expect(captureCampaignTags({ utm_source: ["kakao", "naver"] }, REG).source).toBe("kakao");
  });
  test("등록 목록 설정이 틀린 모양이면 빈 목록, other 등록은 무시", () => {
    expect(parseUtmRegistry(["naver"])).toEqual({ source: [], medium: [], content: [] });
    expect(parseUtmRegistry({ source: ["other", "Naver", "ok"] }).source).toEqual(["ok"]);
  });
});

describe("도착 주소에서 태그 제거", () => {
  test("utm_*와 클릭 ID를 지우고 다른 쿼리와 해시는 남긴다", () => {
    expect(stripTrackingParams("/calc/acquisition?utm_source=naver&utm_campaign=x&gclid=abc&fbclid=1&tab=2#start")).toBe("/calc/acquisition?tab=2#start");
  });
  test("태그만 있으면 쿼리 전체가 사라진다", () => {
    expect(stripTrackingParams("/experts/request?utm_medium=cpc&NaPm=zzz")).toBe("/experts/request");
  });
  test("쿼리가 없으면 그대로", () => {
    expect(stripTrackingParams("/calc")).toBe("/calc");
  });
});
