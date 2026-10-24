import { describe, expect, test } from "vitest";
import { defaultRobots } from "./robots-meta";
import {
  RSS_MAX_ITEMS,
  SITEMAP_MAX_URLS,
  chunkEntries,
  isPromotional,
  lastmodOf,
  newsSitemapRows,
  renderImageSitemap,
  renderNewsSitemap,
  renderRss,
  renderSitemapIndex,
  renderUrlset,
  robotsTxt,
  rssRows,
  xmlEscape,
  type ArticleLite,
} from "./sitemap";

const SITE = "https://sitemap.example.test";
const NOW = new Date("2026-10-25T00:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const art = (over: Partial<ArticleLite> = {}): ArticleLite => ({
  slug: "sample-article",
  title: "가상 기사 제목",
  summary: "가상 요약",
  section: "tax",
  content_type: "reported_news",
  label: "none",
  first_published_at: hoursAgo(1),
  substantive_updated_at: null,
  lead_media_id: null,
  ...over,
});

describe("lastmod — 실질 수정일만 (OPT-07)", () => {
  test("실질 수정일이 없으면 최초 발행일, 있으면 실질 수정일", () => {
    expect(lastmodOf({ first_published_at: "2026-10-01T00:00:00+09:00", substantive_updated_at: null })).toBe("2026-09-30T15:00:00.000Z");
    expect(lastmodOf({ first_published_at: "2026-10-01T00:00:00Z", substantive_updated_at: "2026-10-05T09:00:00Z" })).toBe("2026-10-05T09:00:00.000Z");
  });
  test("오탈자 수정은 실질 수정일을 바꾸지 않으므로 lastmod 변화 0 — 같은 입력은 같은 XML", () => {
    const before = renderUrlset(SITE, [{ path: "/news/a", lastmod: lastmodOf(art()) }]);
    const afterTypo = renderUrlset(SITE, [{ path: "/news/a", lastmod: lastmodOf({ ...art(), substantive_updated_at: null }) }]);
    expect(afterTypo).toBe(before);
  });
});

describe("일반 사이트맵", () => {
  test("주소는 사이트 주소 + 경로이고 &·< 는 이스케이프된다", () => {
    const xml = renderUrlset(SITE, [{ path: "/news/a&b", lastmod: "2026-10-01T00:00:00.000Z" }, { path: "/tax" }]);
    expect(xml).toContain("<loc>https://sitemap.example.test/news/a&amp;b</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<loc>https://sitemap.example.test/tax</loc></url>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
  test("5만 개까지는 한 파일, 5만 1개부터 쪼개고 색인 파일이 조각 주소를 가리킨다", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(chunkEntries(make(SITEMAP_MAX_URLS))).toHaveLength(1);
    const parts = chunkEntries(make(SITEMAP_MAX_URLS + 1));
    expect(parts.map((p) => p.length)).toEqual([SITEMAP_MAX_URLS, 1]);
    const index = renderSitemapIndex(SITE, ["/sitemap/1.xml", "/sitemap/2.xml"]);
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("<loc>https://sitemap.example.test/sitemap/2.xml</loc>");
  });
});

describe("뉴스 사이트맵·RSS 대상 선정 (OPT-01)", () => {
  test("설정 시간 안 발행만 — 경계: 48시간 정각은 포함, 48시간 1초 전은 제외, 미래 시각은 제외", () => {
    const edge = art({ slug: "edge", first_published_at: new Date(NOW.getTime() - 48 * 3600_000).toISOString() });
    const old = art({ slug: "old", first_published_at: new Date(NOW.getTime() - 48 * 3600_000 - 1000).toISOString() });
    const future = art({ slug: "future", first_published_at: new Date(NOW.getTime() + 1000).toISOString() });
    expect(newsSitemapRows([edge, old, future], NOW, 48).map((a) => a.slug)).toEqual(["edge"]);
    expect(newsSitemapRows([edge], NOW, 24)).toEqual([]);
  });
  test("광고·공동 기획·협찬·정보 목록(digest)은 뉴스 사이트맵에 0, 일반 기사는 최신순", () => {
    const rows = [
      art({ slug: "news-old", first_published_at: hoursAgo(5) }),
      art({ slug: "ad", label: "ad" }),
      art({ slug: "co", label: "co_planned" }),
      art({ slug: "sponsored", content_type: "sponsored" }),
      art({ slug: "digest", content_type: "digest" }),
      art({ slug: "news-new", first_published_at: hoursAgo(1) }),
    ];
    expect(newsSitemapRows(rows, NOW, 48).map((a) => a.slug)).toEqual(["news-new", "news-old"]);
  });
  test("RSS — 분야별 1개·전체 1개, 광고·공동 기획·협찬 0, 최근 50건까지", () => {
    const rows = [art({ slug: "t1", section: "tax" }), art({ slug: "r1", section: "realestate" }), art({ slug: "ad", section: "tax", label: "ad" }), art({ slug: "sp", content_type: "sponsored" })];
    expect(rssRows(rows, "tax").map((a) => a.slug)).toEqual(["t1"]);
    expect(rssRows(rows, null).map((a) => a.slug).sort()).toEqual(["r1", "t1"]);
    const many = Array.from({ length: RSS_MAX_ITEMS + 5 }, (_, i) => art({ slug: `s${i}`, first_published_at: hoursAgo(i + 1) }));
    expect(rssRows(many, null)).toHaveLength(RSS_MAX_ITEMS);
    expect(isPromotional(art({ label: "co_planned" }))).toBe(true);
    expect(isPromotional(art())).toBe(false);
  });
  test("뉴스 사이트맵 XML — 발행 매체 이름·언어·발행일·제목이 들어가고 특수문자는 이스케이프", () => {
    const xml = renderNewsSitemap(SITE, [art({ title: "가상 <제목> & 따옴표\"", first_published_at: "2026-10-24T23:00:00.000Z" })], "가상 매체");
    expect(xml).toContain("<news:name>가상 매체</news:name><news:language>ko</news:language>");
    expect(xml).toContain("<news:publication_date>2026-10-24T23:00:00.000Z</news:publication_date>");
    expect(xml).toContain("<news:title>가상 &lt;제목&gt; &amp; 따옴표&quot;</news:title>");
  });
  test("RSS XML — 항목 제목·발행일(UTC)·주소가 화면 기사와 같고 guid는 영구 주소", () => {
    const xml = renderRss(SITE, { title: "가상 매체 · 분야", description: "설명", path: "/rss/tax.xml" }, [art({ first_published_at: "2026-10-24T00:00:00.000Z" })]);
    expect(xml).toContain("<title>가상 기사 제목</title>");
    expect(xml).toContain("<link>https://sitemap.example.test/news/sample-article</link>");
    expect(xml).toContain("<pubDate>Sat, 24 Oct 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain('<guid isPermaLink="true">https://sitemap.example.test/news/sample-article</guid>');
  });
  test("이미지 사이트맵 XML", () => {
    const xml = renderImageSitemap(SITE, [{ path: "/news/a", imageUrl: "https://sitemap.example.test/m/a.jpg", title: "제목" }]);
    expect(xml).toContain("<image:loc>https://sitemap.example.test/m/a.jpg</image:loc><image:title>제목</image:title>");
  });
  test("XML 이스케이프 — 제어 문자는 지운다", () => {
    expect(xmlEscape("a&b<c>d\"e'f\u0001")).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("robots.txt (OPT-08 · SEO-04)", () => {
  const policy = { search: ["TestSearchBot"], ai_training: { decided: true, agents: [{ name: "TestAiBot", allow: false }, { name: "TestAiOkBot", allow: true }] } };

  test("닫힘(SITE_INDEXING=off) — 전체 차단이고 Sitemap 줄이 없다, 정책이 허용이어도 off가 우선", () => {
    const text = robotsTxt({ open: false, policy, site: SITE });
    expect(text).toBe("User-agent: *\nDisallow: /\n");
    expect(text).not.toContain("Sitemap");
  });
  test("열림 — 검색 크롤러 허용, AI 학습 크롤러는 정책대로, 색인 제외 경로 차단, Sitemap 3줄", () => {
    const text = robotsTxt({ open: true, policy, site: SITE });
    expect(text).toContain("User-agent: TestSearchBot\nAllow: /\n");
    expect(text).toContain("User-agent: TestAiBot\nDisallow: /\n");
    expect(text).toContain("User-agent: TestAiOkBot\nAllow: /\n");
    expect(text).toContain("User-agent: *\nAllow: /\nDisallow: /admin");
    expect(text).toContain("Disallow: /api");
    expect(text).toContain("Sitemap: https://sitemap.example.test/sitemap.xml");
    expect(text).toContain("Sitemap: https://sitemap.example.test/sitemap-news.xml");
    expect(text).toContain("Sitemap: https://sitemap.example.test/sitemap-images.xml");
    expect(text.indexOf("TestSearchBot")).toBeLessThan(text.indexOf("User-agent: *"));
  });
  test("AI 학습 정책 미결정·정책 없음·모양 오류·사이트 주소 없음이면 열림이어도 전체 차단(닫힌 쪽)", () => {
    const closed = "User-agent: *\nDisallow: /\n";
    expect(robotsTxt({ open: true, policy: { ...policy, ai_training: { decided: false, agents: [] } }, site: SITE })).toBe(closed);
    expect(robotsTxt({ open: true, policy: undefined, site: SITE })).toBe(closed);
    expect(robotsTxt({ open: true, policy: { search: "x" }, site: SITE })).toBe(closed);
    expect(robotsTxt({ open: true, policy, site: undefined })).toBe(closed);
  });
  test("코드에 크롤러 이름 상수가 없다 — 정책 값을 바꾸면 결과가 바뀐다", () => {
    const other = robotsTxt({ open: true, policy: { ...policy, search: ["OtherBot"] }, site: SITE });
    expect(other).toContain("User-agent: OtherBot");
    expect(other).not.toContain("TestSearchBot");
  });
});

describe("공개 화면 기본 robots (SEO-04)", () => {
  test("off는 noindex·nofollow, on은 색인·추적 허용", () => {
    expect(defaultRobots(false)).toEqual({ index: false, follow: false });
    expect(defaultRobots(true)).toEqual({ index: true, follow: true });
  });
});
