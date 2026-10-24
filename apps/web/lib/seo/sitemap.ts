// 사이트맵·RSS·robots.txt 만들기 (W7 · OPT-01·08, SEO-01·04) — 순수 모듈 (시험 sitemap.test.ts). 네트워크·DB·현재 시각을 쓰지 않는다.
//  · 어떤 페이지가 색인 대상인가는 selection 함수들이 정한다 — 사이트맵·뉴스 사이트맵·이미지 사이트맵·RSS가 같은 규칙을 읽는다.
//  · lastmod는 실질 수정일(없으면 최초 발행일)만 쓴다. 오탈자 수정은 실질 수정일을 바꾸지 않으므로 lastmod도 그대로다 (OPT-07). updated_at은 쓰지 않는다.
//  · 크롤러 이름은 코드에 없다 — settings.crawler_policy에서만 온다 (OPT-08).
import { NON_INDEXABLE_PREFIXES } from "./paths";
import { parseCrawlerPolicy } from "./settings";

/** 사이트맵 한 파일의 주소 수 상한 (sitemaps.org) */
export const SITEMAP_MAX_URLS = 50_000;
/** RSS 한 파일의 최근 항목 수 */
export const RSS_MAX_ITEMS = 50;

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const NS_NEWS = "http://www.google.com/schemas/sitemap-news/0.9";
const NS_IMAGE = "http://www.google.com/schemas/sitemap-image/1.1";

export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 공개 기사 한 줄 — 사이트맵·RSS가 쓰는 칸만 */
export interface ArticleLite {
  slug: string;
  title: string;
  summary?: string | null;
  section: string;
  content_type: string | null;
  label: string;
  first_published_at: string;
  substantive_updated_at: string | null;
  lead_media_id: number | null;
  category_id?: number | null;
}

/** 광고·공동 기획 표기가 있거나 협찬(sponsored) 기사 — 뉴스 사이트맵·RSS에서 뺀다 (OPT-01 'sponsored 0') */
export const isPromotional = (a: Pick<ArticleLite, "content_type" | "label">): boolean => a.content_type === "sponsored" || a.label !== "none";

/** lastmod — 실질 수정일, 없으면 최초 발행일 (OPT-07). 시각은 UTC ISO 8601 */
export function lastmodOf(a: Pick<ArticleLite, "first_published_at" | "substantive_updated_at">): string {
  return new Date(a.substantive_updated_at ?? a.first_published_at).toISOString();
}

/** 뉴스 사이트맵 대상 — 최근 hours시간 안에 발행된 기사, 광고·공동 기획·협찬·정보 목록(digest) 제외. 기준 시각 now는 호출하는 쪽이 넘긴다 */
export function newsSitemapRows(rows: readonly ArticleLite[], now: Date, hours: number): ArticleLite[] {
  const since = now.getTime() - hours * 3600_000;
  return rows
    .filter((a) => !isPromotional(a) && a.content_type !== "digest" && Date.parse(a.first_published_at) >= since && Date.parse(a.first_published_at) <= now.getTime())
    .sort((a, b) => Date.parse(b.first_published_at) - Date.parse(a.first_published_at));
}

/** RSS 대상 — 분야(없으면 전체)의 광고·공동 기획·협찬 아닌 최근 기사 */
export function rssRows(rows: readonly ArticleLite[], section: string | null): ArticleLite[] {
  return rows
    .filter((a) => !isPromotional(a) && (section === null || a.section === section))
    .sort((a, b) => Date.parse(b.first_published_at) - Date.parse(a.first_published_at) || (a.slug < b.slug ? -1 : 1))
    .slice(0, RSS_MAX_ITEMS);
}

export interface UrlEntry {
  /** 사이트 안 경로 (/…) */
  path: string;
  lastmod?: string;
}

const head = (extra = "") => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}"${extra}>\n`;

/** 일반 사이트맵 한 파일 */
export function renderUrlset(site: string, entries: readonly UrlEntry[]): string {
  const body = entries.map((e) => `  <url><loc>${xmlEscape(site + e.path)}</loc>${e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : ""}</url>\n`).join("");
  return `${head()}${body}</urlset>\n`;
}

/** 50,000개를 넘으면 쪼갠다 — 한 파일이면 [entries] */
export function chunkEntries<T>(entries: readonly T[], size = SITEMAP_MAX_URLS): T[][] {
  if (entries.length <= size) return [[...entries]];
  const out: T[][] = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

/** 사이트맵 색인 파일 — 조각 주소 목록 */
export function renderSitemapIndex(site: string, partPaths: readonly string[]): string {
  const body = partPaths.map((p) => `  <sitemap><loc>${xmlEscape(site + p)}</loc></sitemap>\n`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${NS}">\n${body}</sitemapindex>\n`;
}

/** 뉴스 사이트맵 — 발행 매체 이름은 사이트 이름 */
export function renderNewsSitemap(site: string, rows: readonly ArticleLite[], publicationName: string): string {
  const body = rows
    .map(
      (a) =>
        `  <url><loc>${xmlEscape(`${site}/news/${a.slug}`)}</loc><news:news><news:publication><news:name>${xmlEscape(publicationName)}</news:name><news:language>ko</news:language></news:publication>` +
        `<news:publication_date>${new Date(a.first_published_at).toISOString()}</news:publication_date><news:title>${xmlEscape(a.title)}</news:title></news:news></url>\n`,
    )
    .join("");
  return `${head(` xmlns:news="${NS_NEWS}"`)}${body}</urlset>\n`;
}

export interface ImageEntry {
  /** 기사 경로 */
  path: string;
  /** 권리가 확인된 이미지의 절대 주소 */
  imageUrl: string;
  title: string;
}

export function renderImageSitemap(site: string, entries: readonly ImageEntry[]): string {
  const body = entries
    .map((e) => `  <url><loc>${xmlEscape(site + e.path)}</loc><image:image><image:loc>${xmlEscape(e.imageUrl)}</image:loc><image:title>${xmlEscape(e.title)}</image:title></image:image></url>\n`)
    .join("");
  return `${head(` xmlns:image="${NS_IMAGE}"`)}${body}</urlset>\n`;
}

/** RSS 2.0 — 항목 제목·발행일은 화면과 같다 (광고 표기 기사는 애초에 없다) */
export function renderRss(site: string, channel: { title: string; description: string; path: string }, rows: readonly ArticleLite[]): string {
  const items = rows
    .map(
      (a) =>
        `    <item><title>${xmlEscape(a.title)}</title><link>${xmlEscape(`${site}/news/${a.slug}`)}</link><guid isPermaLink="true">${xmlEscape(`${site}/news/${a.slug}`)}</guid>` +
        `<pubDate>${new Date(a.first_published_at).toUTCString()}</pubDate>${a.summary ? `<description>${xmlEscape(a.summary)}</description>` : ""}</item>\n`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${xmlEscape(channel.title)}</title>\n    <link>${xmlEscape(site + "/")}</link>\n` +
    `    <description>${xmlEscape(channel.description)}</description>\n    <language>ko</language>\n${items}  </channel>\n</rss>\n`
  );
}

/**
 * robots.txt — open이 아니면 전체 차단(SITE_INDEXING=off이거나 크롤러 정책이 비어 있거나 틀린 경우: 닫힌 쪽).
 * open이면 settings.crawler_policy의 검색 크롤러는 허용, AI 학습 크롤러는 정책(allow)대로, 그 밖은 `*` 허용 + 색인 제외 경로 차단. Sitemap 줄은 open일 때만.
 */
export function robotsTxt(input: { open: boolean; policy: unknown; site: string | undefined }): string {
  const policy = parseCrawlerPolicy(input.policy);
  if (!input.open || !policy || !policy.ai_training.decided || !input.site) return "User-agent: *\nDisallow: /\n";
  const disallow = NON_INDEXABLE_PREFIXES.map((p) => `Disallow: ${p}`).join("\n");
  const allowGroup = (name: string) => `User-agent: ${name}\nAllow: /\n${disallow}\n`;
  const groups = [
    ...policy.search.map(allowGroup),
    ...policy.ai_training.agents.map((a) => (a.allow ? allowGroup(a.name) : `User-agent: ${a.name}\nDisallow: /\n`)),
    allowGroup("*"),
  ];
  const maps = ["/sitemap.xml", "/sitemap-news.xml", "/sitemap-images.xml"].map((p) => `Sitemap: ${input.site}${p}`).join("\n");
  return `${groups.join("\n")}\n${maps}\n`;
}
