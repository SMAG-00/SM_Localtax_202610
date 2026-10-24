// 어댑터 — 현 사이트 플랫폼(엔디소프트 뉴스솔루션 계열, URL /news/articleView.html?idxno=N) → 중간 형식
//  입력은 이미 받아 둔 파일(기사 쪽 HTML 저장본, sitemap.xml, rss) — 이 모듈은 네트워크를 쓰지 않는다. 받는 일은 PO가 허락한 방법(DB 덤프·내보내기)으로 따로.
//  DB 덤프를 받으면 이 어댑터 대신 덤프 칸 → 중간 형식 어댑터를 같은 모양으로 더한다 (설계 4장)
import { FORMAT_ID, FORMAT_VERSION, findCategory } from "../format.mjs";
import { articleIdOf, articleUrlOf, normalizeLegacyUrl } from "../normalize.mjs";
import { decodeEntities } from "../transform.mjs";

const meta = (html, key) => {
  const re = new RegExp(`<meta\\s+(?:property|name)=["']${key.replace(/[.:]/g, "\\$&")}["']\\s+content=["']([^"']*)["']`, "i");
  const m = re.exec(html);
  return m ? decodeEntities(m[1]).trim() : "";
};

/** 시작 태그 위치부터 같은 이름 태그의 짝을 세어 안쪽 HTML을 돌려준다 */
export function innerHtmlOf(html, startRe) {
  const open = startRe.exec(html);
  if (!open) return null;
  const tag = /^<\s*([a-z0-9]+)/i.exec(open[0])?.[1]?.toLowerCase();
  if (!tag) return null;
  const from = open.index + open[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return null;
}

const kst = (s) => (/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s.replace(" ", "T")}+09:00`);
const dot = (y, mo, d, h, mi) => `${y}-${mo}-${d}T${h}:${mi}:00+09:00`;

/** 기사 쪽 HTML 한 건 → 중간 형식 항목 */
export function parseArticlePage(html, id) {
  const published = meta(html, "article:published_time");
  const title = meta(html, "og:title");
  const author = meta(html, "og:article:author");
  const sectionName = meta(html, "article:section");
  const body = innerHtmlOf(html, /<[a-z0-9]+\b[^>]*itemprop=["']articleBody["'][^>]*>/i);
  const infoText = (innerHtmlOf(html, /<ul class="infomation">/i) ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const upd = /수정\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(infoText);
  const category = findCategory(sectionName);
  const rec = {
    legacy_id: String(id),
    legacy_url: articleUrlOf(id),
    title,
    category: sectionName,
    ...(category ? { category_code: category.code } : {}),
    author_name: author,
    published_at: published ? kst(published) : "",
    body_html: body ?? "",
    status: "published",
  };
  if (upd) rec.updated_at = dot(upd[1], upd[2], upd[3], upd[4], upd[5]);
  const og = meta(html, "og:image");
  rec.images = og ? [{ url: og, alt: "", caption: "", role: "lead" }] : [];
  return rec;
}

/** sitemap.xml → [{legacy_id, published_at, title}] (뉴스 사이트맵은 최근 100건만 담을 수 있다 — 전체 목록 근거가 아니다) */
export function parseSitemap(xml) {
  return [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].flatMap((u) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(u[0])?.[1];
    const id = articleIdOf(normalizeLegacyUrl(loc ?? ""));
    if (!id) return [];
    return [{ legacy_id: id, published_at: /<news:publication_date>([^<]+)</.exec(u[0])?.[1] ?? null, title: decodeEntities(/<news:title>([^<]*)</.exec(u[0])?.[1] ?? "") }];
  });
}

/** RSS 2.0(/rss/allArticle.xml 등) → [{legacy_id, title, published_at, summary}] */
export function parseRss(xml) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].flatMap((it) => {
    const link = /<link>([^<]+)<\/link>/.exec(it[0])?.[1];
    const id = articleIdOf(normalizeLegacyUrl(link ?? ""));
    if (!id) return [];
    const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(it[0])?.[1];
    return [{ legacy_id: id, title: decodeEntities(/<title>([^<]*)<\/title>/.exec(it[0])?.[1] ?? ""), published_at: pub ? kst(pub.trim()) : null }];
  });
}

/** 기사 쪽 저장본들 → 중간 형식 문서. pages = [{id, html}] */
export function adaptNdsoft(pages, source = {}) {
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    source: { platform: "ndsoft", ...source },
    articles: pages.map((p) => parseArticlePage(p.html, p.id)).sort((a, b) => Number(a.legacy_id) - Number(b.legacy_id)),
  };
}
