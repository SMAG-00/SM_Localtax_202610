// 공개 상세 화면의 응답 상태 — 삭제 기사 410(NAV-06) · 읽지 못하면 503(있는지 모르므로 404·410 0)
import { describe, expect, test } from "vitest";
import { gateDecision, kstDay, noticeFor, noticeHeaders, noticeHtml, probePath, publicDetailRoute } from "./public-gate";

describe("공개 상세 경로", () => {
  test.each([
    ["/news/acquisition-tax-2026", { kind: "article", slug: "acquisition-tax-2026" }],
    ["/news/%EC%B7%A8%EB%93%9D%EC%84%B8", { kind: "article", slug: "취득세" }],
    ["/news/a.b,c(1)/", { kind: "article", slug: "a.b,c(1)" }],
    ["/situations/car-sold", { kind: "situation", slug: "car-sold" }],
    ["/people/kim-gaon", { kind: "person", slug: "kim-gaon" }],
    ["/partners/12", { kind: "partner", slug: "12" }],
    ["/partners/7/", { kind: "partner", slug: "7" }],
  ])("%s → 상세", (path, route) => expect(publicDetailRoute(path)).toEqual(route));

  test.each(["/news", "/news/", "/news/video", "/news/Popular", "/news/a/b", "/news/%E0%A4%A", "/situations/Bad_Slug", "/people/a--b", "/partners", "/partners/0", "/partners/012", "/partners/abc", "/partners/1.5", "/partners/-3", "/partners/1/x", "/news/photo", "/tax/columns", "/admin/articles/1", "/"])(
    "%s → 상세 아님 (확인하지 않는다 — 화면이 정한다)",
    (path) => expect(publicDetailRoute(path)).toBeNull(),
  );
});

describe("확인 요청", () => {
  test("기사는 삭제 주소 표, 상황은 상황 표, 인물은 공개 인물 뷰 — 공개 칸만", () => {
    expect(probePath({ kind: "article", slug: "a" })).toBe("/rest/v1/article_tombstones?select=slug,removed_at&slug=eq.a&limit=1");
    expect(probePath({ kind: "situation", slug: "car-sold" })).toBe("/rest/v1/situations?select=slug&slug=eq.car-sold&limit=1");
    expect(probePath({ kind: "person", slug: "kim" })).toBe("/rest/v1/public_people?select=slug&slug=eq.kim&limit=1");
    // 제휴사 (W2-c 4단계) — 공개 제휴사 표(RLS — visible만)의 번호 칸만
    expect(probePath({ kind: "partner", slug: "12" })).toBe("/rest/v1/partners?select=id&id=eq.12&limit=1");
  });
  test("주소에 쓰는 글자(& # ? 공백 아닌 한글·쉼표)는 인코딩해 값 하나로 — 다른 질의 칸이 생기지 않는다", () => {
    const path = probePath({ kind: "article", slug: "a&select=*#x,취득" });
    expect(path).toBe("/rest/v1/article_tombstones?select=slug,removed_at&slug=eq.a%26select%3D*%23x%2C%EC%B7%A8%EB%93%9D&limit=1");
    expect(new URLSearchParams(path.split("?")[1]).get("slug")).toBe("eq.a&select=*#x,취득");
  });
});

describe("응답 정하기", () => {
  const article = { kind: "article" as const, slug: "gone-one" };
  test("기사 — 삭제 기록이 있으면 410(삭제 시각), 없으면 화면으로", () => {
    expect(gateDecision(article, { ok: true, rows: [{ slug: "gone-one", removed_at: "2026-10-17T15:30:00Z" }] })).toEqual({ kind: "gone", removedAt: "2026-10-17T15:30:00Z" });
    expect(gateDecision(article, { ok: true, rows: [] })).toEqual({ kind: "pass" });
    expect(gateDecision(article, { ok: true, rows: [{ slug: "other", removed_at: "2026-10-17T15:30:00Z" }] })).toEqual({ kind: "pass" });
  });
  test("읽지 못함·모양이 틀린 응답은 503 — 기사·상황·인물 모두", () => {
    for (const kind of ["article", "situation", "person", "partner"] as const) {
      expect(gateDecision({ kind, slug: "x" }, { ok: false })).toEqual({ kind: "unavailable" });
      expect(gateDecision({ kind, slug: "x" }, { ok: true, rows: { code: "PGRST205" } })).toEqual({ kind: "unavailable" });
    }
  });
  test("상황·인물은 읽기만 되면 화면으로 (있는지는 화면이 정한다 — 200·404)", () => {
    expect(gateDecision({ kind: "situation", slug: "x" }, { ok: true, rows: [] })).toEqual({ kind: "pass" });
    expect(gateDecision({ kind: "person", slug: "x" }, { ok: true, rows: [{ slug: "x" }] })).toEqual({ kind: "pass" });
    expect(gateDecision({ kind: "partner", slug: "9" }, { ok: true, rows: [] })).toEqual({ kind: "pass" });
  });
});

describe("안내 화면", () => {
  test("410 — 한국 날짜와 뉴스 전체·홈 링크, 오류 글자 0", () => {
    const n = noticeFor({ kind: "gone", removedAt: "2026-10-17T15:30:00Z" });
    expect(n.status).toBe(410);
    expect(n.lines[0]).toBe("이 기사는 2026-10-18에 편집국이 내렸습니다.");
    expect(n.links.map((l) => l.href)).toEqual(["/news", "/"]);
  });
  test("503 — '잠시 뒤 다시 확인해 주세요', 홈 링크", () => {
    const n = noticeFor({ kind: "unavailable" });
    expect(n.status).toBe(503);
    expect(n.title).toBe("잠시 뒤 다시 확인해 주세요");
    expect(n.links).toEqual([{ label: "홈으로 가기", href: "/" }]);
  });
  test("HTML — 한국어 문서·noindex·글자는 이스케이프", () => {
    const html = noticeHtml({ status: 503, title: "<제목>", lines: ['"따옴표" & 줄'], links: [{ label: "홈", href: "/?a=1&b=2" }] });
    expect(html.startsWith('<!doctype html><html lang="ko">')).toBe(true);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("<h1>&lt;제목&gt;</h1>");
    expect(html).toContain("<p>&quot;따옴표&quot; &amp; 줄</p>");
    expect(html).toContain('href="/?a=1&amp;b=2"');
    expect(html).toContain('data-notice="503"');
  });
  test("머리글 — 캐시 0, 503만 30초 뒤 다시", () => {
    expect(noticeHeaders(503)).toMatchObject({ "cache-control": "no-store", "retry-after": "30", "x-robots-tag": "noindex" });
    expect(noticeHeaders(410)).not.toHaveProperty("retry-after");
  });
  test("한국 날짜 — 읽을 수 없으면 null", () => {
    expect(kstDay("2026-10-17T14:59:59Z")).toBe("2026-10-17");
    expect(kstDay("2026-10-17T15:00:00Z")).toBe("2026-10-18");
    expect(kstDay("nope")).toBeNull();
  });
});
