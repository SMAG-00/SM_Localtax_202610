// 제휴 피드 응답 만들기 (W13-i PART-01). DB 함수 partner_feed_serve가 고른 항목을 RSS 2.0 / JSON으로 바꾼다. 항목마다 출처와 원문 링크를 붙인다.
// 항목 모양에 필자 이메일·내부 번호 외 개인정보 칸이 없고, 프리미엄 본문은 DB 함수에서 이미 빠져 있다.

export interface FeedItem {
  id: number;
  slug: string;
  title: string;
  section?: string;
  published_at?: string;
  summary?: string;
  body_text?: string;
}

export interface FeedContext {
  siteUrl: string; // 끝 슬래시 없는 사이트 주소
  siteName: string;
  scope: "summary" | "full";
}

export const FEED_UTM = "utm_source=partner_feed&utm_medium=feed";

export function articleUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${slug.replace(/^\/+/, "")}?${FEED_UTM}`;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

// XML 1.0에서 허용되지 않는 제어 문자는 뺀다
const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

export function toJsonFeed(items: FeedItem[], ctx: FeedContext) {
  return {
    source: ctx.siteName,
    scope: ctx.scope,
    count: items.length,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      section: i.section ?? null,
      published_at: i.published_at ?? null,
      summary: i.summary ?? null,
      ...(ctx.scope === "full" && i.body_text ? { body_text: i.body_text } : {}),
      url: articleUrl(ctx.siteUrl, i.slug),
      source: ctx.siteName,
    })),
  };
}

export function toRss(items: FeedItem[], ctx: FeedContext, nowIso: string): string {
  const x = (s: string) => escapeXml(stripControl(s));
  const body = items
    .map((i) => {
      const url = articleUrl(ctx.siteUrl, i.slug);
      const desc = ctx.scope === "full" && i.body_text ? i.body_text : (i.summary ?? "");
      return [
        "    <item>",
        `      <title>${x(i.title)}</title>`,
        `      <link>${x(url)}</link>`,
        `      <guid isPermaLink="false">article-${i.id}</guid>`,
        i.published_at ? `      <pubDate>${new Date(i.published_at).toUTCString()}</pubDate>` : "",
        i.section ? `      <category>${x(i.section)}</category>` : "",
        `      <description>${x(desc)}</description>`,
        `      <source url="${x(ctx.siteUrl)}">${x(ctx.siteName)}</source>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${x(ctx.siteName)}</title>`,
    `    <link>${x(ctx.siteUrl)}</link>`,
    `    <description>${x(ctx.siteName)} 제휴 피드 (${ctx.scope === "full" ? "전문" : "요약"})</description>`,
    `    <lastBuildDate>${new Date(nowIso).toUTCString()}</lastBuildDate>`,
    body,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
