// 중간 형식 → 새 articles 행 (docs/dev/W9_설계.md 2.2~2.4)
//  · 본문 HTML/텍스트 → 블록(paragraph · table · image). 이미지는 권리 미확인(unconfirmed) 자리표시자 — 공개 렌더 0 (MIG-01)
//  · 기사는 origin='legacy', content_type=null(이관 기사만 허용) — 일괄 reported_news·자체 취재 표기 금지, digest 0
//  · status는 draft(리허설·기본) 또는 published(전환 당일 최종 실행) — 어느 쪽이든 first_published_at = 원래 발행일
import { createHash } from "node:crypto";
import { SECTION_LABELS, TARGET_STATUSES } from "./format.mjs";

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", ndash: "–", mdash: "—" };

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const collapse = (s) => decodeEntities(s).replace(/[ \t 　]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const stripTags = (s) => s.replace(/<[^>]*>/g, "");
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
};

/** HTML → 블록 목록. images = 본문에 나온 이미지({url, alt}) 순서대로 */
export function htmlToBlocks(html, legacyId) {
  const blocks = [];
  const images = [];
  let src = String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const pushParagraph = (t) => {
    const c = collapse(stripTags(t));
    for (const line of c.split("\n")) if (line.trim()) blocks.push({ type: "paragraph", text: line.trim() });
  };
  // 표와 이미지를 먼저 떼어 자리를 표시한다
  const holders = [];
  src = src.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    holders.push({ kind: "table", html: m });
    return `\n\u0000H${holders.length - 1}\u0000\n`;
  });
  src = src.replace(/<img\b[^>]*>/gi, (m) => {
    holders.push({ kind: "img", html: m });
    return `\n\u0000H${holders.length - 1}\u0000\n`;
  });
  src = src.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|blockquote|figcaption)>/gi, "\n");
  for (const part of src.split("\n")) {
    const m = /^\s*\u0000H(\d+)\u0000\s*$/.exec(part);
    if (!m) {
      pushParagraph(part);
      continue;
    }
    const h = holders[Number(m[1])];
    if (h.kind === "img") {
      const url = attr(h.html, "src");
      if (!url) continue;
      images.push({ url, alt: attr(h.html, "alt") });
      blocks.push({ type: "image", mediaId: `legacy:${legacyId}:${images.length}`, alt: attr(h.html, "alt"), caption: "", rightsStatus: "unconfirmed" });
    } else {
      const rows = [...h.html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => collapse(stripTags(c[0])).replace(/\n/g, " ")));
      const cap = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(h.html);
      if (rows.length) blocks.push({ type: "table", caption: cap ? collapse(stripTags(cap[1])) : "", rows, chart: null });
    }
  }
  return { blocks, images };
}

export function textToBlocks(textBody) {
  return String(textBody ?? "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => collapse(p).replace(/\n/g, " "))
    .filter(Boolean)
    .map((t) => ({ type: "paragraph", text: t }));
}

const KST_CITY = /[가-힣]{1,3}(?:시|군|구)(?![가-힣])/;

/** 사람이 보는 7항목 대조용 내용 해시 — 제목·본문 글자·이미지 주소·필자·날짜 (MIG-03 표본 200건) */
export function contentHash(row, sidecar) {
  const plain = row.body.map((b) => (b.type === "paragraph" ? b.text : b.type === "table" ? JSON.stringify(b.rows) : `img:${b.mediaId}`)).join("\n");
  return createHash("sha256").update([row.title, plain, sidecar.images.map((i) => i.url).join("|"), sidecar.author_name ?? "", row.first_published_at].join("␟")).digest("hex");
}

/**
 * @param {{rec: object, category: object, imageUrls: string[]}} entry validateDocument의 records 항목
 * @param {{status?: "draft"|"published", sourceLabel?: string}} [opts]
 */
export function toArticle(entry, opts = {}) {
  const status = opts.status ?? "draft";
  if (!TARGET_STATUSES.includes(status)) throw new Error(`status는 ${TARGET_STATUSES.join("·")} 중 하나여야 합니다`);
  const { rec, category } = entry;
  const fromHtml = rec.body_html && rec.body_html.trim() ? htmlToBlocks(rec.body_html, rec.legacy_id) : null;
  const body = fromHtml ? fromHtml.blocks : textToBlocks(rec.body_text);
  const declaredImages = (Array.isArray(rec.images) ? rec.images : []).map((i) => (typeof i === "string" ? { url: i, alt: "", caption: "", role: "inline" } : { url: i.url, alt: i.alt ?? "", caption: i.caption ?? "", role: i.role ?? "inline" }));
  const seen = new Set(declaredImages.map((i) => i.url));
  const images = [...declaredImages, ...(fromHtml?.images ?? []).filter((i) => !seen.has(i.url)).map((i) => ({ ...i, caption: "", role: "inline" }))];
  const published = rec.published_at;
  const plain = body.filter((b) => b.type === "paragraph").map((b) => b.text).join(" ");
  const article = {
    slug: rec.slug,
    title: rec.title.trim().replace(/\s+/g, " "),
    summary: rec.summary && rec.summary.trim() ? rec.summary.trim() : null,
    body,
    format: "general",
    section: category.section,
    content_type: null,
    origin: "legacy",
    category_slug: category.category,
    subtype: category.subtype,
    status,
    editorial_status: status === "published" ? "approved" : "pending",
    tax_review_status: "not_required",
    first_published_at: published,
    substantive_updated_at: rec.updated_at ?? null,
    region_codes: [],
    legacy_url: rec.legacy_url,
    legacy_source: opts.sourceLabel ?? "legacy-site",
  };
  const sidecar = {
    legacy_id: rec.legacy_id,
    author_name: rec.author_name?.trim() || null,
    tag: category.tag,
    images,
    section_label: SECTION_LABELS[category.section],
    needs_reclassify: category.needsReclassify,
    region_review: KST_CITY.test(`${rec.title} ${plain}`),
  };
  return { article, sidecar, content_hash: contentHash(article, sidecar) };
}
