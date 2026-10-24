// 어댑터 — WordPress 내보내기(WXR 1.2) → 중간 형식. 현 사이트가 워드프레스가 아니어도 같은 틀로 다른 플랫폼을 더할 수 있다는 것을 보이는 두 번째 어댑터.
//  입력은 파일 내용(문자열). categoryMap = {워드프레스 분류 이름: 분류 코드 또는 현 사이트 분류 이름} — 맞는 분류가 없으면 검증이 '미배정'으로 막는다
import { FORMAT_ID, FORMAT_VERSION } from "../format.mjs";
import { normalizeLegacyUrl } from "../normalize.mjs";
import { decodeEntities } from "../transform.mjs";

const cdata = (s) => (s ?? "").replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? cdata(m[1].trim()) : "";
};
const STATUS = { publish: "published", trash: "deleted", draft: "hidden", private: "hidden", pending: "hidden", future: "hidden" };

export function adaptWxr(xml, { categoryMap = {}, source = {} } = {}) {
  const articles = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const item = m[0];
    if (tag(item, "wp:post_type") !== "post") continue;
    const cats = [...item.matchAll(/<category domain="category"[^>]*>([\s\S]*?)<\/category>/g)].map((c) => decodeEntities(cdata(c[1].trim())));
    const mapped = cats.map((c) => categoryMap[c] ?? c)[0] ?? "";
    const gmt = tag(item, "wp:post_date_gmt");
    const local = tag(item, "wp:post_date");
    const published = gmt && !gmt.startsWith("0000") ? `${gmt.replace(" ", "T")}Z` : local ? `${local.replace(" ", "T")}+09:00` : "";
    const link = tag(item, "link");
    let legacyUrl;
    try {
      legacyUrl = link ? (normalizeLegacyUrl(link) ?? undefined) : undefined;
    } catch {
      legacyUrl = undefined;
    }
    const rec = {
      legacy_id: tag(item, "wp:post_id"),
      title: decodeEntities(tag(item, "title")),
      category: mapped,
      author_name: tag(item, "dc:creator"),
      published_at: published,
      body_html: tag(item, "content:encoded"),
      summary: tag(item, "excerpt:encoded") || undefined,
      status: STATUS[tag(item, "wp:status")] ?? "hidden",
    };
    const slug = tag(item, "wp:post_name");
    if (slug) rec.slug = decodeURIComponent(slug);
    if (legacyUrl) rec.legacy_url = legacyUrl;
    articles.push(rec);
  }
  return { format: FORMAT_ID, version: FORMAT_VERSION, source: { platform: "wordpress-wxr", ...source }, articles };
}
