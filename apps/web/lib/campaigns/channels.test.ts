import { describe, expect, test } from "vitest";
import { CAMPAIGN_TARGETS, suggestDestinations } from "./channels";

describe("채널별 도착 제안", () => {
  test("검색 광고는 계산기와 상담 요청을 권한다", () => {
    expect(suggestDestinations("search")).toEqual(["calc", "expert_request"]);
  });
  test.each(["sns", "display"])("%s 광고는 재테크 포인트와 법령 해석을 권한다", (c) => {
    expect(suggestDestinations(c)).toEqual(["realestate_weekly", "brief_weekly"]);
  });
  test("모르는 채널은 other와 같이 4개 전부를 보여준다", () => {
    expect(suggestDestinations("youtube")).toEqual([...CAMPAIGN_TARGETS]);
  });
  test("모든 제안은 도착 4개 안의 값뿐이다", () => {
    for (const c of ["search", "sns", "display", "email", "other"]) for (const t of suggestDestinations(c)) expect(CAMPAIGN_TARGETS).toContain(t);
  });
});
