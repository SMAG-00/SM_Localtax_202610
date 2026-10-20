import { describe, expect, it } from "vitest";
import { checkInterestInput, memberFeedItems, MEMBER_FEED_LIMIT } from "./member-feed-logic";

const limits = { interestMax: 20, interestRegionLimit: 3 };

describe("checkInterestInput — 관심 분야·지역 저장 검사", () => {
  it("지역이 상한(3)이면 통과하고 상한+1(4)이면 거부한다", () => {
    const three = ["1100000000", "2600000000", "2700000000"];
    expect(checkInterestInput([], three, limits)).toEqual({ ok: true, interests: [], regionCodes: three });
    const four = [...three, "2800000000"];
    expect(checkInterestInput([], four, limits)).toMatchObject({ ok: false, field: "regionCodes" });
  });
  it("같은 값은 하나로 합쳐 센다", () => {
    expect(checkInterestInput(["tax", "tax"], ["1100000000", "1100000000"], limits)).toEqual({ ok: true, interests: ["tax"], regionCodes: ["1100000000"] });
  });
  it("분야 상한+1을 거부한다", () => {
    const many = Array.from({ length: 21 }, (_, n) => `tax:sub-${n}`);
    expect(checkInterestInput(many, [], limits)).toMatchObject({ ok: false, field: "interests" });
    expect(checkInterestInput(many.slice(0, 20), [], limits).ok).toBe(true);
  });
  it("목록 밖 분야(local:하위, 대문자, 빈 값)와 10자리 아닌 지역 코드를 거부한다", () => {
    for (const bad of ["local:x", "Tax", "", "etc", "tax:"]) expect(checkInterestInput([bad], [], limits)).toMatchObject({ ok: false, field: "interests" });
    for (const bad of ["110", "11000000000", "abcdefghij"]) expect(checkInterestInput([], [bad], limits)).toMatchObject({ ok: false, field: "regionCodes" });
  });
});

describe("memberFeedItems — 화면 값 변환", () => {
  it("주소·한국 날짜로 바꾼다 (UTC 15:30은 한국 다음 날)", () => {
    const [item] = memberFeedItems([{ id: 7, slug: "a-b", title: "제목", summary: null, section: "tax", first_published_at: "2026-10-01T15:30:00Z" }]);
    expect(item).toEqual({ id: 7, href: "/news/a-b", title: "제목", summary: "", section: "tax", publishedOn: "2026-10-02" });
  });
  it(`${MEMBER_FEED_LIMIT}건을 넘는 행은 자른다`, () => {
    const rows = Array.from({ length: 9 }, (_, n) => ({ id: n, slug: `s${n}`, title: "t", summary: "", section: "tax", first_published_at: "2026-10-01T00:00:00Z" }));
    expect(memberFeedItems(rows)).toHaveLength(MEMBER_FEED_LIMIT);
  });
});
