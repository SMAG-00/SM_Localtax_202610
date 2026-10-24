// 중간 형식 검증 (docs/dev/W9_설계.md 2.1) — 오류가 하나라도 있으면 가져오기를 하지 않는다(dry-run 보고서에 전부 나열)
//  · 오류(error): 필수 칸 없음 · 번호 중복 · slug 중복/형식/예약 · 날짜 형식/범위 · 분류 미배정 · 이미지 주소 형식 · 알 수 없는 상태
//  · 경고(warning): 필자 없음 · 수정일이 발행일보다 앞 · 같은 이미지 주소 반복 · 본문에 주민번호/전화번호 모양(편집국 확인) · 긴 제목
import { FORMAT_ID, FORMAT_VERSION, RECORD_STATUSES, RESERVED_SLUGS, SLUG_PATTERN, findCategory } from "./format.mjs";
import { articleUrlOf, normalizeLegacyUrl } from "./normalize.mjs";

const EARLIEST = "2000-01-01T00:00:00+09:00";
const RRN = /\b\d{6}[-\s]?[1-4]\d{6}\b/;
const PHONE = /\b0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}\b/;

export const slugOf = (rec) => (typeof rec.slug === "string" && rec.slug.trim() ? rec.slug.trim() : `legacy-${String(Number(rec.legacy_id))}`);

const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s));
const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * @param {unknown} doc 중간 형식 문서
 * @param {{now?: Date}} [opts] now = 날짜 범위 검사 기준(시험에서 고정)
 * @returns {{errors: object[], warnings: object[], records: object[], excluded: object[], header: object}}
 */
export function validateDocument(doc, opts = {}) {
  const now = opts.now ?? new Date();
  const errors = [];
  const warnings = [];
  const err = (id, field, message) => errors.push({ id, field, message });
  const warn = (id, field, message) => warnings.push({ id, field, message });
  const result = { errors, warnings, records: [], excluded: [], header: {} };

  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    err(null, "document", "최상위가 객체가 아닙니다");
    return result;
  }
  if (doc.format !== FORMAT_ID) err(null, "format", `format은 "${FORMAT_ID}"이어야 합니다 (받은 값: ${JSON.stringify(doc.format)})`);
  if (doc.version !== FORMAT_VERSION) err(null, "version", `version은 ${FORMAT_VERSION}이어야 합니다 (받은 값: ${JSON.stringify(doc.version)})`);
  result.header = { source: doc.source ?? null, count: Array.isArray(doc.articles) ? doc.articles.length : 0 };
  if (!Array.isArray(doc.articles)) {
    err(null, "articles", "articles 배열이 없습니다");
    return result;
  }

  const seenIds = new Map();
  const seenSlugs = new Map();
  const seenUrls = new Map();
  doc.articles.forEach((rec, index) => {
    const label = rec && typeof rec === "object" && rec.legacy_id !== undefined ? String(rec.legacy_id) : `#${index}`;
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return err(label, "record", "기사 항목이 객체가 아닙니다");
    const before = errors.length;

    // 번호
    const idText = typeof rec.legacy_id === "number" ? String(rec.legacy_id) : text(rec.legacy_id);
    if (!/^[0-9]+$/.test(idText)) err(label, "legacy_id", "legacy_id는 숫자 글자여야 합니다");
    else if (seenIds.has(String(Number(idText)))) err(label, "legacy_id", `legacy_id 중복 (${idText}, 앞선 항목 #${seenIds.get(String(Number(idText)))})`);
    else seenIds.set(String(Number(idText)), index);
    const normId = /^[0-9]+$/.test(idText) ? String(Number(idText)) : null;

    // 상태
    const status = rec.status === undefined ? "published" : rec.status;
    if (!RECORD_STATUSES.includes(status)) err(label, "status", `status는 ${RECORD_STATUSES.join("·")} 중 하나여야 합니다 (받은 값: ${JSON.stringify(rec.status)})`);

    // 제목·본문
    if (!text(rec.title)) err(label, "title", "제목이 비었습니다");
    else if (text(rec.title).length > 200) warn(label, "title", "제목이 200자를 넘습니다");
    const hasBody = text(rec.body_html) || text(rec.body_text);
    if (!hasBody && status === "published") err(label, "body", "공개 기사인데 본문(body_html·body_text)이 비었습니다");

    // 날짜
    if (!isIso(rec.published_at)) err(label, "published_at", `발행일 형식이 올바르지 않습니다 (받은 값: ${JSON.stringify(rec.published_at)})`);
    else {
      const t = Date.parse(rec.published_at);
      if (t < Date.parse(EARLIEST)) err(label, "published_at", `발행일이 2000-01-01 이전입니다 (${rec.published_at})`);
      if (t > now.getTime() + 24 * 3600 * 1000) err(label, "published_at", `발행일이 미래입니다 (${rec.published_at})`);
    }
    if (rec.updated_at !== undefined && rec.updated_at !== null) {
      if (!isIso(rec.updated_at)) err(label, "updated_at", `수정일 형식이 올바르지 않습니다 (받은 값: ${JSON.stringify(rec.updated_at)})`);
      else if (isIso(rec.published_at) && Date.parse(rec.updated_at) < Date.parse(rec.published_at)) warn(label, "updated_at", "수정일이 발행일보다 앞섭니다");
    }

    // 분류
    const category = findCategory(rec.category_code ?? rec.category);
    if (!category) err(label, "category", `분류를 4대 분야에 대응시킬 수 없습니다 (받은 값: ${JSON.stringify(rec.category_code ?? rec.category)}) — 미배정은 허용하지 않습니다`);

    // 필자
    if (!text(rec.author_name)) warn(label, "author_name", "필자 이름이 없습니다 (편집국 확인)");

    // slug
    const slug = normId ? slugOf({ ...rec, legacy_id: normId }) : null;
    if (slug) {
      if (!SLUG_PATTERN.test(slug)) err(label, "slug", `slug에 공백·'/'를 쓸 수 없습니다 (${slug})`);
      else if (RESERVED_SLUGS.includes(slug.toLowerCase())) err(label, "slug", `예약된 slug입니다 (${slug})`);
      else if (seenSlugs.has(slug)) err(label, "slug", `slug 중복 (${slug}, 앞선 항목 ${seenSlugs.get(slug)})`);
      else seenSlugs.set(slug, label);
    }

    // 옛 주소
    const declared = rec.legacy_url === undefined ? null : normalizeLegacyUrl(rec.legacy_url);
    if (rec.legacy_url !== undefined && !declared) err(label, "legacy_url", `옛 주소를 읽을 수 없습니다 (${JSON.stringify(rec.legacy_url)})`);
    const legacyUrl = declared ?? (normId ? articleUrlOf(normId) : null);
    if (legacyUrl) {
      if (seenUrls.has(legacyUrl)) err(label, "legacy_url", `옛 주소 중복 (${legacyUrl}, 앞선 항목 ${seenUrls.get(legacyUrl)})`);
      else seenUrls.set(legacyUrl, label);
    }

    // 이미지
    const images = rec.images === undefined ? [] : rec.images;
    const imageUrls = [];
    if (!Array.isArray(images)) err(label, "images", "images는 배열이어야 합니다");
    else {
      const seenImg = new Set();
      images.forEach((img, i) => {
        const url = typeof img === "string" ? img : img?.url;
        if (typeof url !== "string" || !/^https?:\/\/[^\s]+$/.test(url)) return err(label, `images[${i}]`, `이미지 주소가 http(s) 형식이 아닙니다 (${JSON.stringify(url)})`);
        if (seenImg.has(url)) warn(label, `images[${i}]`, `같은 이미지 주소 반복 (${url})`);
        seenImg.add(url);
        imageUrls.push(url);
      });
    }

    // 개인정보 모양
    const plain = `${rec.body_html ?? ""} ${rec.body_text ?? ""}`;
    if (RRN.test(plain)) warn(label, "body", "주민등록번호 모양의 글자가 있습니다 (편집국 확인)");
    if (PHONE.test(plain)) warn(label, "body", "전화번호 모양의 글자가 있습니다 (편집국 확인)");

    if (errors.length > before) return;
    const entry = { rec: { ...rec, legacy_id: normId, slug, legacy_url: legacyUrl, status }, category, imageUrls };
    if (status === "published") result.records.push(entry);
    else result.excluded.push({ legacy_id: normId, legacy_url: legacyUrl, status, reason: text(rec.excluded_reason) || (status === "deleted" ? "현 사이트에서 삭제된 기사" : "현 사이트에서 비공개인 기사") });
  });
  return result;
}
