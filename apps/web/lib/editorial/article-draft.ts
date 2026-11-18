// 편집위원 결과물 → 기사 초안 (PO 2026-11-18) — 순수 규칙: 확인 창 기본값·입력 검사·그림 계획·본문 블록. DB·저장소는 lib/server/editorial/article-draft.ts.
//  · PO 결정: 결과물 그림은 AI가 만든 것이라 권리 확인됨으로 넣는다(캡션에 'AI 생성'이 있는 그림). 'AI 생성' 표기가 없는 그림(예: 10-31 실사진)은 미확인으로 두고 사람이 확인한다
//  · PO 결정: 원고 [요약](포털·SNS용 2문장)은 본문 맨 위 핵심 요약 상자로. 기사 요약 칸(60자)에는 [부제]
//  · 기사 머리 글자 상한(제목 40자·요약 60자)은 @ltr/editorial 값 그대로 — 넘으면 확인 창에서 사람이 줄인다(자동으로 자르지 않는다)
import { ARTICLE_HEAD_LIMITS, headCharCount } from "@ltr/editorial";
import { CONTENT_TYPE_LABELS, SECTION_LABELS } from "@/lib/admin/labels";
import type { ArticleBlock, ParsedArticle } from "./article-markdown";

export const DRAFT_SECTIONS = ["tax", "realestate", "finance", "local"] as const;
export type DraftSection = (typeof DRAFT_SECTIONS)[number];
/** 결과물에서 만들 수 있는 기사 유형 — 광고·협찬(sponsored)·금주 핫뉴스(digest)는 이 길로 만들지 않는다 */
export const DRAFT_CONTENT_TYPES = ["opinion", "explainer", "guide", "reported_news"] as const;
export type DraftContentType = (typeof DRAFT_CONTENT_TYPES)[number];

export interface DraftForm {
  title: string;
  summary: string;
  section: DraftSection;
  contentType: DraftContentType;
  categorySlug: string | null;
  slug: string;
}

export interface DraftDefaults extends DraftForm {
  titleOptions: string[];
  titleTooLong: boolean;
}

/** 원고 [섹션] → 사이트 분야·기사 유형·하위 분야(지침 v4 2장 ⑤ 게재 섹션) */
const SECTION_MAP: Record<string, { section: DraftSection; contentType: DraftContentType; categorySlug: string | null }> = {
  "전문가 칼럼": { section: "tax", contentType: "opinion", categorySlug: "columns" },
  판례소개: { section: "tax", contentType: "explainer", categorySlug: "interpretations" },
  유권해석: { section: "tax", contentType: "explainer", categorySlug: "interpretations" },
  법령개정: { section: "tax", contentType: "explainer", categorySlug: "law-updates" },
  지자체소식: { section: "local", contentType: "reported_news", categorySlug: "reporting" },
  "부동산 정보": { section: "realestate", contentType: "explainer", categorySlug: null },
};
const FALLBACK = { section: "tax", contentType: "explainer", categorySlug: null } as const;

const fits = (text: string, max: number) => headCharCount(text) <= max;

export function draftDefaults(parsed: ParsedArticle, folder: string): DraftDefaults {
  const map = SECTION_MAP[parsed.section.trim()] ?? FALLBACK;
  const candidates = [parsed.title, ...parsed.titleAlternatives].map((t) => t.trim()).filter(Boolean);
  const titleOptions = [...new Set(candidates.filter((t) => fits(t, ARTICLE_HEAD_LIMITS.titleMax)))];
  const firstLine = parsed.subtitle.split(" / ")[0]!.trim();
  const summary = [parsed.subtitle.trim(), firstLine].find((s) => s && fits(s, ARTICLE_HEAD_LIMITS.summaryMax)) ?? "";
  return {
    title: parsed.title.trim(),
    titleOptions,
    titleTooLong: !fits(parsed.title, ARTICLE_HEAD_LIMITS.titleMax),
    summary,
    section: map.section,
    contentType: map.contentType,
    categorySlug: map.categorySlug,
    slug: `desk-${folder.replace(/_/g, "-")}`,
  };
}

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const FORM_KEYS = ["title", "summary", "section", "contentType", "categorySlug", "slug"] as const;

/** 확인 창 입력 — 기사 저장 규칙(제목 40자·요약 60자·주소 공백/'/' 없음)을 화면 말로 먼저 검사한다 */
export function parseDraftForm(raw: unknown): Result<DraftForm> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["입력은 객체여야 합니다"] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!(FORM_KEYS as readonly string[]).includes(k)) errors.push(`${k}: 모르는 칸입니다`);
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const title = str("title");
  const summary = str("summary");
  const slug = str("slug");
  const categorySlug = str("categorySlug") || null;
  if (!title) errors.push("제목: 비울 수 없습니다");
  else if (!fits(title, ARTICLE_HEAD_LIMITS.titleMax)) errors.push(`제목: ${ARTICLE_HEAD_LIMITS.titleMax}자 이하로 줄여 주세요 (지금 ${headCharCount(title)}자)`);
  if (!fits(summary, ARTICLE_HEAD_LIMITS.summaryMax)) errors.push(`요약: ${ARTICLE_HEAD_LIMITS.summaryMax}자 이하로 줄여 주세요 (지금 ${headCharCount(summary)}자)`);
  const section = str("section");
  if (!(DRAFT_SECTIONS as readonly string[]).includes(section)) errors.push(`분야: ${DRAFT_SECTIONS.map((s) => SECTION_LABELS[s]).join("·")} 중에서 골라 주세요`);
  const contentType = str("contentType");
  if (!(DRAFT_CONTENT_TYPES as readonly string[]).includes(contentType)) errors.push(`기사 유형: ${DRAFT_CONTENT_TYPES.map((t) => CONTENT_TYPE_LABELS[t]).join("·")} 중에서 골라 주세요`);
  if (!slug) errors.push("주소: 비울 수 없습니다");
  else if (!/^[^\s/]+$/.test(slug) || slug.length > 200) errors.push("주소: 공백과 '/' 없이 씁니다");
  if (categorySlug !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(categorySlug)) errors.push("하위 분야: 목록에서 골라 주세요");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, summary, section: section as DraftSection, contentType: contentType as DraftContentType, categorySlug, slug } };
}

/* ── 그림 ── */

export const DRAFT_IMAGE_MAX_BYTES = 4_000_000; // 사진 보관함 상한(media-rules MEDIA_MAX_BYTES)과 같다
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface PackageFileRef {
  path: string;
  mime: string;
  size: number;
  key: string;
}

export interface PlannedImage {
  path: string;
  key: string;
  kind: "photo" | "thumbnail";
  lead: boolean;
  /** PO 결정 — 캡션(또는 썸네일 메모 줄)에 'AI 생성'이 있으면 권리 확인됨으로 넣는다 */
  confirmed: boolean;
  alt: string;
  caption: string;
  credit: string | null;
  photographer: string | null;
  license: string | null;
  license_type: "not_applicable" | null;
}

const AI_RE = /AI\s*생성/;
/** "(이미지: AI 생성, OpenAI gpt-image-2)" → "OpenAI gpt-image-2" */
function aiModelOf(text: string): string {
  const m = /AI\s*생성\s*[,，]\s*([^)）]+)[)）]/.exec(text);
  return m ? m[1]!.trim() : "";
}
/** "(사진: 국가기록원, 공공누리 1유형)" → "국가기록원, 공공누리 1유형" */
function photoCreditOf(caption: string): string | null {
  const m = /\((?:사진|이미지)\s*[:：]\s*([^)]+)\)\s*$/.exec(caption);
  return m ? m[1]!.trim() : null;
}

function aiMeta(model: string) {
  const who = model ? `AI 생성 (${model})` : "AI 생성";
  return { credit: who, photographer: who, license: "편집국이 만든 AI 생성 이미지 — 제3자 권리 없음 (PO 2026-11-18)", license_type: "not_applicable" as const };
}

export function imagePlan(parsed: ParsedArticle, files: readonly PackageFileRef[]): { images: PlannedImage[]; warnings: string[] } {
  const warnings: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const usable = (path: string): PackageFileRef | null => {
    const f = byPath.get(path);
    if (!f) {
      warnings.push(`그림 ${path}이 결과물 묶음에 없어 뺐습니다`);
      return null;
    }
    if (!IMAGE_MIMES.has(f.mime)) {
      warnings.push(`그림 ${path}은 jpg·png·webp가 아니라 사진 보관함에 넣을 수 없습니다`);
      return null;
    }
    if (f.size > DRAFT_IMAGE_MAX_BYTES) {
      warnings.push(`그림 ${path}은 4MB를 넘어 사진 보관함에 넣을 수 없습니다`);
      return null;
    }
    return f;
  };

  const images: PlannedImage[] = [];
  const thumbPath = parsed.memo.thumbnail;
  if (thumbPath) {
    const f = usable(thumbPath);
    if (f) {
      const line = parsed.memo.text.split("\n").find((l) => l.includes(thumbPath) && AI_RE.test(l)) ?? "";
      const bodyImages = parsed.blocks.filter((b) => b.type === "image");
      const bodyModel = bodyImages.map((b) => (b.aiGenerated ? aiModelOf(b.caption) : "")).find(Boolean) ?? "";
      // 메모 줄에 'AI 생성'이 있거나, 본문 그림이 모두 AI 생성이면(지침 13-1 — 썸네일은 AI 배경 + 글자) AI로 본다
      const ai = Boolean(line) || (bodyImages.length > 0 && bodyImages.every((b) => b.aiGenerated));
      images.push({
        path: thumbPath,
        key: f.key,
        kind: "thumbnail",
        lead: true,
        confirmed: ai,
        alt: `${parsed.title} — 썸네일`,
        caption: "",
        ...(ai ? aiMeta(aiModelOf(line) || bodyModel) : { credit: null, photographer: null, license: null, license_type: null }),
      });
    }
  }
  for (const b of parsed.blocks) {
    if (b.type !== "image" || images.some((i) => i.path === b.path)) continue;
    const f = usable(b.path);
    if (!f) continue;
    images.push({
      path: b.path,
      key: f.key,
      kind: "photo",
      lead: images.length === 0,
      confirmed: b.aiGenerated,
      alt: b.alt || b.caption.replace(/^▲/, "").split(".")[0]!.trim() || parsed.title,
      caption: b.caption,
      ...(b.aiGenerated ? aiMeta(aiModelOf(b.caption)) : { credit: photoCreditOf(b.caption), photographer: null, license: null, license_type: null }),
    });
  }
  return { images, warnings };
}

/* ── 본문 ── */

const CAPTION_MAX = 80;
/** 문장 끝(마침표·물음표·느낌표 뒤 공백)에서 나눈다 */
const sentences = (text: string) =>
  text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

type BodyBlock =
  | { type: "key_summary"; lines: string[] }
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "table"; caption: string; rows: string[][]; chart: null }
  | { type: "image"; mediaId: string; alt: string; caption: string };

const tableTitleOf = (b: ArticleBlock | undefined): string | null => {
  if (!b) return null;
  if ((b.type === "paragraph" || (b.type === "heading" && b.level === 3)) && b.text.startsWith("※") && b.text.length <= CAPTION_MAX) return b.text.replace(/^※\s*/, "");
  return null;
};

export function buildDraftBody(parsed: ParsedArticle, mediaIds: ReadonlyMap<string, number>): { body: { blocks: BodyBlock[]; claims: [] }; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: BodyBlock[] = [];
  const lines = sentences(parsed.summary);
  if (lines.length) blocks.push({ type: "key_summary", lines });
  const src = parsed.blocks;
  for (let i = 0; i < src.length; i++) {
    const b = src[i]!;
    if (tableTitleOf(b) !== null && src[i + 1]?.type === "table") continue; // 다음 표의 제목으로 쓴다
    switch (b.type) {
      case "paragraph":
        blocks.push({ type: "paragraph", text: b.text });
        break;
      case "heading":
        blocks.push({ type: "heading", level: b.level, text: b.text.slice(0, 200) });
        break;
      case "table":
        blocks.push({ type: "table", caption: tableTitleOf(src[i - 1]) ?? "", rows: b.rows.map((r) => [...r]), chart: null });
        break;
      case "image": {
        const id = mediaIds.get(b.path);
        if (id === undefined) {
          warnings.push(`그림 ${b.path}은 사진 보관함에 넣지 못해 본문에서 뺐습니다`);
          break;
        }
        blocks.push({ type: "image", mediaId: String(id), alt: b.alt, caption: b.caption });
        break;
      }
    }
  }
  return { body: { blocks, claims: [] }, warnings };
}
