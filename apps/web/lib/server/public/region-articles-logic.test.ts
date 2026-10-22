// GET /api/regions/{code}/articles 요청 검사·응답 항목 (W4 9단계 — PRD-01B 5.6 · 설계 1장 9단계 'API 목록 밖 topic 400 · 응답에 source·verifiedAt·status')
// 시험용 지역·기사는 가짜다 (접두 99 · 설계 8장)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ARTICLE_STATUSES, REGION_ARTICLES_API, parseRegionArticlesRequest, regionArticleItems } from "./region-articles-logic";
import type { RegionSourceRow } from "./region-official-logic";
import { listItem } from "./test-items";

const ROOT = path.resolve(__dirname, "../../../../..");
const PRD = fs.readFileSync(path.join(ROOT, "docs", "PRD", "PRD-01B_1단계_4대분야_콘텐츠.md"), "utf8");
const q = (s: string) => new URLSearchParams(s);
const CODE = "9901100000";

describe("요청 검사 — 어떤 입력에도 DB 전에 400 (500 0)", () => {
  test("PRD 5.6 topic 값 = 편집 분야 4종 · 생략하면 전체", () => {
    const line = PRD.split("\n").find((l) => l.startsWith("| `GET /api/regions/{code}/articles?topic=` |"))!;
    const topics = line.match(/`topic` = ([a-z_·]+)/)![1]!.split("·");
    for (const t of topics) expect(parseRegionArticlesRequest(CODE, q(`topic=${t}`))).toEqual({ ok: true, code: CODE, topic: t, page: 1 });
    expect(parseRegionArticlesRequest(CODE, q(""))).toEqual({ ok: true, code: CODE, topic: null, page: 1 });
    expect(parseRegionArticlesRequest(CODE, q("page=3"))).toEqual({ ok: true, code: CODE, topic: null, page: 3 });
  });

  test.each([
    ["목록 밖 topic", "topic=tourism", /^topic:/],
    ["빈 topic", "topic=", /^topic:/],
    ["대문자 topic", "topic=LOCAL_TAX", /^topic:/],
    ["두 번 보낸 topic", "topic=local_tax&topic=realestate", /^topic: 같은 칸을 두 번/],
    ["page 0", "page=0", /^page:/],
    ["page 음수", "page=-1", /^page:/],
    ["page 글자", "page=abc", /^page:/],
    ["page 소수", "page=1.5", /^page:/],
    ["page 상한 밖", `page=${REGION_ARTICLES_API.maxPage + 1}`, /^page:/],
    ["page 앞자리 0", "page=01", /^page:/],
    ["모르는 칸", "region=1100000000", /^region: 모르는 칸/],
  ])("%s → 칸 사유", (_, query, re) => {
    const r = parseRegionArticlesRequest(CODE, q(query));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => re.test(e))).toBe(true);
  });

  test.each(["99011", "99011000001", "99O1100000", "%20", "", "../1100000000"])("코드 형식 밖 %j → 400 사유", (code) => {
    const r = parseRegionArticlesRequest(code, q(""));
    expect(r).toEqual({ ok: false, errors: ["code: 행정구역 법정동코드 10자리 숫자입니다"] });
  });

  test("틀린 칸이 여럿이면 모두 알린다", () => {
    const r = parseRegionArticlesRequest("x", q("topic=x&page=0"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0])).toEqual(["code", "topic", "page"]);
  });
});

describe("응답 항목 — source · verifiedAt · status (5.6)", () => {
  const src = (over: Partial<RegionSourceRow>): RegionSourceRow => ({
    id: 1,
    article_id: 1,
    kind: "official_doc",
    title: "시험용 지방세 세입 결산",
    source_url: "https://gov.example.test/a",
    source_name: "시험용 가상도청",
    provider: null,
    last_verified_at: "2026-10-10T01:00:00Z",
    published_on: "2026-09-01",
    reference_date: "2026-08-31",
    license_type: "kogl_1",
    source_type: "local_tax_revenue",
    region_unit: "시·도",
    snapshot_id: 1,
    supersedes_id: null,
    ...over,
  });

  test("검수 공식 자료가 있으면 발표기관·가장 이른 확인일, 없으면 편집국·null · 열린 검수가 있으면 under_review", () => {
    const items = [
      listItem({ id: 1, title: "시험용 A", section: "local", editorialField: "local_tax", regionCodes: [CODE], authorName: "시험용 기자" }),
      listItem({ id: 2, title: "시험용 B", section: "local", editorialField: "realestate" }),
      listItem({ id: 3, title: "시험용 C", section: "local", editorialField: "urban_policy" }),
    ];
    const sources = [
      src({ id: 11, article_id: 1, last_verified_at: "2026-10-12T00:00:00Z" }),
      src({ id: 12, article_id: 1, source_name: "시험용 가득구청", source_url: "https://gov.example.test/b", last_verified_at: "2026-10-03T16:30:00Z" }),
      src({ id: 13, article_id: 2, kind: "press_release", source_type: null }),
      src({ id: 14, article_id: 3, snapshot_id: null }),
    ];
    const out = regionArticleItems(items, sources, new Set([13]));
    expect(out.map((a) => [a.id, a.source, a.verifiedAt, a.status])).toEqual([
      [1, "시험용 가상도청·시험용 가득구청", "2026-10-04", "published"],
      [2, "편집국", null, "under_review"],
      [3, "편집국", null, "published"],
    ]);
    expect(out[0]).toMatchObject({ url: "/news/article-1", author: "시험용 기자", regionCodes: [CODE], editorialField: "local_tax" });
    for (const a of out) expect(ARTICLE_STATUSES).toContain(a.status);
  });

  test("대체된 옛 판은 출처·검수 표시에서 빠진다", () => {
    const items = [listItem({ id: 5, section: "local", editorialField: "local_tax" })];
    const sources = [src({ id: 21, article_id: 5, source_name: "시험용 옛 기관" }), src({ id: 22, article_id: 5, supersedes_id: 21, source_name: "시험용 새 기관" })];
    expect(regionArticleItems(items, sources, new Set([21]))[0]).toMatchObject({ source: "시험용 새 기관", status: "published" });
  });
});
