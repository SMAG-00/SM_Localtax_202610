import { describe, expect, test } from "vitest";
import { fromParam, orderHost, parseDays, parseDomains, parseFrom, parseLinkPropose, parseProduct, parseProductStatus, parseSubscriptionReview, storeDetailHref } from "./rules";

const base = { slug: "zz-sample", title: "가상 시험 강좌", kind: "education", order_mode: "request_form", summary: "시험용 설명" };

describe("parseProduct", () => {
  test("신청서 방식 상품은 주소 없이 저장되고 빈 칸은 null·빈 배열이 된다", () => {
    expect(parseProduct(base)).toEqual({
      ok: true,
      value: { id: null, row: { slug: "zz-sample", title: "가상 시험 강좌", kind: "education", summary: "시험용 설명", audience: "", edition: null, toc: [], order_mode: "request_form", order_url: null, verified_on: null, verified_ref: null } },
    });
  });
  test("바깥 링크 방식은 https 주소가 있어야 하고 신청서 방식에 주소를 주면 거부", () => {
    expect(parseProduct({ ...base, order_mode: "existing_channel" })).toMatchObject({ ok: false, errors: [expect.stringContaining("order_url")] });
    expect(parseProduct({ ...base, order_mode: "existing_channel", order_url: "http://shop.example.test/x" }).ok).toBe(false);
    expect(parseProduct({ ...base, order_mode: "request_form", order_url: "https://shop.example.test/x" }).ok).toBe(false);
    const ok = parseProduct({ ...base, order_mode: "existing_channel", order_url: "https://shop.example.test/x?a=1" });
    expect(ok.ok && ok.value.row.order_url).toBe("https://shop.example.test/x?a=1");
  });
  test("할인·가격 표기와 모양이 틀린 값은 칸 이름과 함께 거부", () => {
    for (const bad of ["20% 할인", "정가 15,000원", "특가 안내", "최저가"]) expect(parseProduct({ ...base, summary: bad }).ok, bad).toBe(false);
    const r = parseProduct({ ...base, slug: "Bad Slug", title: "", kind: "magazine", verified_on: "어제" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0])).toEqual(["slug", "title", "kind", "verified_on"]);
  });
  test("목차는 줄마다 하나, 빈 줄은 뺀다", () => {
    const r = parseProduct({ ...base, kind: "book", edition: "제1판", toc: "제1장\n\n 제2장 \r\n제3장" });
    expect(r.ok && r.value.row.toc).toEqual(["제1장", "제2장", "제3장"]);
  });
});

describe("그 밖의 입력", () => {
  test("상태는 세 값뿐", () => {
    expect(parseProductStatus({ id: 3, status: "on_sale" })).toEqual({ ok: true, value: { id: 3, status: "on_sale" } });
    expect(parseProductStatus({ id: 3, status: "archived" }).ok).toBe(false);
    expect(parseProductStatus({ id: 0, status: "draft" }).ok).toBe(false);
  });
  test("연결 제안 - 기사 연결은 기사 번호 필수, 홈 연결은 기사 번호 금지", () => {
    expect(parseLinkPropose({ product_id: 1, placement: "article", article_id: "12" })).toEqual({ ok: true, value: { productId: 1, placement: "article", articleId: 12 } });
    expect(parseLinkPropose({ product_id: 1, placement: "article" }).ok).toBe(false);
    expect(parseLinkPropose({ product_id: 1, placement: "home" })).toEqual({ ok: true, value: { productId: 1, placement: "home", articleId: null } });
    expect(parseLinkPropose({ product_id: 1, placement: "home", article_id: 5 }).ok).toBe(false);
    expect(parseLinkPropose({ product_id: 1, placement: "sidebar" }).ok).toBe(false);
  });
  test("허용 도메인 - 소문자 호스트만, 겹침·경로·대문자 거부", () => {
    expect(parseDomains({ domains: "shop.example.test, Books.example.test" }).ok).toBe(false);
    expect(parseDomains({ domains: "shop.example.test\nbooks.example.test" })).toEqual({ ok: true, value: ["shop.example.test", "books.example.test"] });
    expect(parseDomains({ domains: "shop.example.test/path" }).ok).toBe(false);
    expect(parseDomains({ domains: "a.example.test a.example.test" }).ok).toBe(false);
    expect(parseDomains({ domains: "" })).toEqual({ ok: true, value: [] });
  });
  test("구독 확인 기록 - 승인에는 근거·확인자·확인일", () => {
    expect(parseSubscriptionReview({ approved: true, ref: "기록 1" }).ok).toBe(false);
    expect(parseSubscriptionReview({ approved: false })).toMatchObject({ ok: true });
    expect(parseSubscriptionReview({ approved: true, ref: "기록 1", reviewed_by: "확인자", reviewed_on: "2026-10-20" })).toMatchObject({ ok: true });
  });
  test("기간은 7·30·90, 나머지는 30", () => {
    expect([parseDays("7"), parseDays("90"), parseDays("30"), parseDays("5"), parseDays(null)]).toEqual([7, 90, 30, 30, 30]);
  });
});

describe("출발 위치 쿼리와 주소", () => {
  test("a12·h·그 밖의 값을 위치로 읽고 되돌린다", () => {
    expect(parseFrom("a12")).toEqual({ placement: "article", articleId: 12 });
    expect(parseFrom("h")).toEqual({ placement: "home", articleId: null });
    for (const bad of ["a0", "a", "a1x", "x", "", null, undefined, "a1234567890123"]) expect(parseFrom(bad).placement).toBe("store");
    expect(fromParam("article", 12)).toBe("a12");
    expect(fromParam("home", null)).toBe("h");
    expect(fromParam("store", null)).toBeNull();
    expect(storeDetailHref("zz-sample", "a12")).toBe("/store/zz-sample?from=a12");
    expect(storeDetailHref("zz-sample")).toBe("/store/zz-sample");
  });
  test("주문 주소 호스트 - 사용자 정보·http·공백은 null", () => {
    expect(orderHost("https://Shop.Example.test/a")).toBe("shop.example.test");
    expect(orderHost("https://user@shop.example.test/a")).toBeNull();
    expect(orderHost("http://shop.example.test/a")).toBeNull();
    expect(orderHost("https://shop.example.test/a b")).toBeNull();
  });
});
