import { describe, expect, test } from "vitest";
import { bearerKey, formatKey, hashesEqual, hashSecret, newSecret, parseKey, PepperMissingError, requirePepper } from "./keys";
import { escapeXml, toJsonFeed, toRss } from "./render";
import { parseLimit, serveFeed, type RpcClient } from "./serve";
import { buildManuscript, DOUBLE_PAY_PLACEHOLDER, hasAffiliateClaim } from "../naver/series";

const PEPPER = "test-pepper-0123456789";
const ctx = { siteUrl: "https://example.test", siteName: "시험 사이트", scope: "summary" } as const;

describe("키 해시 (PART-01)", () => {
  test("형식 왕복: 번호와 비밀이 그대로 나오고 비밀은 43자", () => {
    const s = newSecret();
    expect(s).toHaveLength(43);
    expect(parseKey(formatKey(17, s))).toEqual({ feedId: 17, secret: s });
  });
  test("형식 오류 키는 null (번호 0·짧은 비밀·접두사 없음)", () => {
    expect(parseKey(`pf_0.${"a".repeat(43)}`)).toBeNull();
    expect(parseKey(`pf_1.${"a".repeat(42)}`)).toBeNull();
    expect(parseKey(`xx_1.${"a".repeat(43)}`)).toBeNull();
  });
  test("해시는 64자 hex, 후추가 다르면 달라지고 원문과 같지 않다", () => {
    const s = newSecret();
    const h = hashSecret(s, PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(s);
    expect(hashSecret(s, PEPPER)).toBe(h);
    expect(hashSecret(s, "other-pepper-0123456789")).not.toBe(h);
  });
  test("후추가 비거나 15자 이하이면 해시를 만들지 않는다 (경계 15/16)", () => {
    expect(() => hashSecret("x", "")).toThrow(PepperMissingError);
    expect(() => requirePepper("a".repeat(15))).toThrow(PepperMissingError);
    expect(requirePepper("a".repeat(16))).toBe("a".repeat(16));
    expect(() => requirePepper(undefined)).toThrow(PepperMissingError);
  });
  test("해시 비교: 같은 값만 true, 길이가 달라도 예외 없이 false", () => {
    const h = hashSecret(newSecret(), PEPPER);
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, h.slice(0, 63) + (h.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(hashesEqual(h, "abc")).toBe(false);
  });
  test("Bearer 헤더 파싱", () => {
    expect(bearerKey("Bearer abc")).toBe("abc");
    expect(bearerKey("Basic abc")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });
});

describe("피드 변환", () => {
  const items = [{ id: 3, slug: "news/a", title: "A & B <제목>", section: "취득세", published_at: "2026-10-01T00:00:00Z", summary: "요약 \"문장\"", body_text: "전문 본문" }];
  test("RSS: 특수문자 이스케이프, 요약 범위는 본문을 내지 않고 출처·원문 링크가 있다", () => {
    const xml = toRss(items, ctx, "2026-10-27T00:00:00Z");
    expect(xml).toContain("A &amp; B &lt;제목&gt;");
    expect(xml).toContain("<description>요약 &quot;문장&quot;</description>");
    expect(xml).not.toContain("전문 본문");
    expect(xml).toContain("https://example.test/news/a?utm_source=partner_feed");
    expect(xml).toContain("<source url=\"https://example.test\">시험 사이트</source>");
  });
  test("JSON: 요약 범위에는 body_text 칸이 없고 전문 범위에만 있다", () => {
    expect(JSON.stringify(toJsonFeed(items, ctx))).not.toContain("body_text");
    const full = toJsonFeed(items, { ...ctx, scope: "full" });
    expect(full.items[0].body_text).toBe("전문 본문");
    expect(full.items[0].url).toContain("example.test/news/a");
  });
  test("escapeXml", () => expect(escapeXml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;"));
});

describe("피드 요청 처리 (DB 함수 응답을 모의)", () => {
  const secret = newSecret();
  const key = formatKey(5, secret);
  const base = { format: null, limit: null, pepper: PEPPER, siteUrl: "https://example.test", siteName: "시험", now: new Date("2026-10-27T00:00:00Z") };
  const rpcReturning = (data: unknown) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db: RpcClient = { rpc: async (fn, args) => (calls.push({ fn, args }), { data, error: null }) };
    return { db, calls };
  };
  test("키가 없으면 DB를 부르지 않고 401", async () => {
    const { db, calls } = rpcReturning({});
    const r = await serveFeed(db, { ...base, authorization: null });
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  test("DB에는 비밀 원문이 아니라 후추 해시가 간다", async () => {
    const { db, calls } = rpcReturning({ ok: false, status: 401, code: "unauthorized" });
    await serveFeed(db, { ...base, authorization: `Bearer ${key}` });
    expect(calls[0].args.p_feed_id).toBe(5);
    expect(calls[0].args.p_key_hash).toBe(hashSecret(secret, PEPPER));
    expect(JSON.stringify(calls[0].args)).not.toContain(secret);
  });
  test("후추가 없으면 503 (DB 호출 0)", async () => {
    const { db, calls } = rpcReturning({});
    const r = await serveFeed(db, { ...base, pepper: "", authorization: `Bearer ${key}` });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  test("429는 retry-after를 담는다, 폐기·계약 종료는 401 본문에 사유를 드러내지 않는다", async () => {
    const limited = await serveFeed(rpcReturning({ ok: false, status: 429, code: "rate_limited", retry_after: 60 }).db, { ...base, authorization: `Bearer ${key}` });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    const revoked = await serveFeed(rpcReturning({ ok: false, status: 401, code: "revoked" }).db, { ...base, authorization: `Bearer ${key}` });
    expect(revoked.status).toBe(401);
    expect(revoked.body).not.toContain("revoked");
  });
  test("성공: RSS 기본, format=json이면 JSON, 알 수 없는 format은 400", async () => {
    const ok = { ok: true, status: 200, code: "ok", scope: "summary", items: [{ id: 1, slug: "a", title: "제목", summary: "요약" }] };
    const rss = await serveFeed(rpcReturning(ok).db, { ...base, authorization: `Bearer ${key}` });
    expect(rss.headers["content-type"]).toContain("rss+xml");
    const js = await serveFeed(rpcReturning(ok).db, { ...base, format: "json", authorization: `Bearer ${key}` });
    expect(JSON.parse(js.body).count).toBe(1);
    const bad = await serveFeed(rpcReturning(ok).db, { ...base, format: "atom", authorization: `Bearer ${key}` });
    expect(bad.status).toBe(400);
  });
  test("limit 경계: 0→1, 50→50, 51→50, 숫자 아님→20", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("51")).toBe(50);
    expect(parseLimit("abc")).toBe(20);
    expect(parseLimit(null)).toBe(20);
  });
});

describe("네이버 연재 원고 (CH-02)", () => {
  test("'네이버 제휴 언론사' 표현 검사", () => {
    expect(hasAffiliateClaim("우리는 네이버 제휴 언론사입니다")).toBe(true);
    expect(hasAffiliateClaim("네이버 뉴스 제휴 매체")).toBe(true);
    expect(hasAffiliateClaim("네이버 프리미엄콘텐츠 연재")).toBe(false);
  });
  test("원고: 제목·원문 링크·본문, 안내 문구가 없으면 PO 입력 자리표시", () => {
    const r = buildManuscript({ title: "칼럼", text: "본문입니다", articleUrl: "https://example.test/c" });
    expect(r.ok && r.file).toContain("제목: 칼럼");
    expect(r.ok && r.file).toContain(DOUBLE_PAY_PLACEHOLDER);
  });
  test("제휴 표현이 있거나 본문이 비면 원고를 만들지 않는다", () => {
    expect(buildManuscript({ title: "t", text: "네이버 제휴 언론사 소개", articleUrl: "u" })).toEqual({ ok: false, code: "affiliate_claim" });
    expect(buildManuscript({ title: "t", text: "  ", articleUrl: "u" })).toEqual({ ok: false, code: "empty_text" });
  });
});
