// 공개 행 모양 — anon이 읽을 수 있는 칸만 (packages/db/supabase/migrations/*public_read.sql의 칸 권한과 같다). 순수 모듈.
// 칸 목록 상수는 select에 그대로 쓴다 — 칸 권한이 없는 칸을 넣으면 anon 요청이 42501로 실패한다(시험이 잡는다).

export interface PublicArticleRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  body: unknown;
  format: string;
  section: string;
  content_type: string | null;
  reporting_method: string | null;
  origin: string;
  category_id: number | null;
  subtype: string;
  solved_case: unknown;
  label: string;
  partner_id: number | null;
  author_id: number | null;
  lead_media_id: number | null;
  version: number;
  first_published_at: string | null;
  substantive_updated_at: string | null;
  updated_reason: string | null;
  update_kind: string | null;
  legal_basis_date: string | null;
  tax_lens: unknown;
  digest_id: number | null;
  region_codes: string[];
  editorial_field: string | null;
  public_question: string | null;
  amendment_id: number | null;
  reported_approved: boolean;
  /** 칼럼 연재 이름·회차 (ART-04) */
  series_title: string | null;
  series_episode: number | null;
  /** 공동 기획 배지의 제휴사 이름 (ART-10 — DB 트리거가 계산, 공동 기획이 아니면 null). 제휴사가 비공개가 돼도 남는다 */
  partner_badge_name: string | null;
}

/** 목록 카드에 쓰는 칸 (본문·「지방세로 읽기」 제외) */
export type PublicArticleListRow = Pick<
  PublicArticleRow,
  | "id"
  | "slug"
  | "title"
  | "summary"
  | "format"
  | "section"
  | "content_type"
  | "category_id"
  | "subtype"
  | "label"
  | "partner_id"
  | "author_id"
  | "first_published_at"
  | "substantive_updated_at"
  | "region_codes"
  | "editorial_field"
  | "amendment_id"
  | "reported_approved"
  | "series_title"
  | "series_episode"
  | "partner_badge_name"
>;

export const ARTICLE_LIST_COLUMNS =
  "id, slug, title, summary, format, section, content_type, category_id, subtype, label, partner_id, author_id, first_published_at, substantive_updated_at, region_codes, editorial_field, amendment_id, reported_approved, series_title, series_episode, partner_badge_name";

export const ARTICLE_DETAIL_COLUMNS =
  "id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case, label, partner_id, author_id, lead_media_id, version, first_published_at, substantive_updated_at, updated_reason, update_kind, legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id, reported_approved, series_title, series_episode, partner_badge_name";

export interface PublicCategoryRow {
  id: number;
  section: string;
  slug: string;
  name: string;
  intro: string | null;
  sort: number;
  needs_disclaimer: boolean;
  needs_tax_lens: boolean;
}
export const CATEGORY_COLUMNS = "id, section, slug, name, intro, sort, needs_disclaimer, needs_tax_lens";

/** public_people 뷰 — 약력은 증빙 있는 항목만 */
export interface PublicPersonRow {
  id: number;
  slug: string;
  name: string;
  roles: string[];
  affiliation: string | null;
  bio_items: unknown;
  beat: string | null;
  last_verified_at: string | null;
}
export const PERSON_COLUMNS = "id, slug, name, roles, affiliation, bio_items, beat, last_verified_at";

export interface PublicPartnerRow {
  id: number;
  name: string;
  kind: string;
  intro: string | null;
  url: string | null;
}
export const PARTNER_COLUMNS = "id, name, kind, intro, url";

export interface PublicMediaRow {
  id: number;
  path: string;
  alt: string | null;
  credit: string | null;
  photographer: string | null;
  license: string | null;
  source_url: string | null;
  kind: string;
  /** 원본 가로·세로(픽셀) — 화면 자리 확보(원본 비율 그대로, 자르지 않음). 모르면 null (W2-c 4단계) */
  width: number | null;
  height: number | null;
}
export const MEDIA_COLUMNS = "id, path, alt, credit, photographer, license, source_url, kind, width, height";

export interface RegionRow {
  code: string;
  parent_code: string | null;
  level: string;
  name: string;
  slug: string;
  aliases: string[];
  valid_from: string | null;
  valid_to: string | null;
}
export const REGION_COLUMNS = "code, parent_code, level, name, slug, aliases, valid_from, valid_to";

export interface SituationRow {
  id: number;
  slug: string;
  section: string;
  title: string;
  subtitle: string | null;
  pictogram: string;
  checks: unknown;
  checklist: unknown;
  mistakes: string[];
  external_link_id: number | null;
  article_ids: number[];
  solved_case_ids: number[];
  glossary_ids: number[];
  tool_links: unknown;
  region_select: boolean;
  hub_slot: number | null;
  sort: number;
  reviewed_at: string | null;
}
export const SITUATION_COLUMNS =
  "id, slug, section, title, subtitle, pictogram, checks, checklist, mistakes, external_link_id, article_ids, solved_case_ids, glossary_ids, tool_links, region_select, hub_slot, sort, reviewed_at";

export interface CurationRow {
  id: number;
  kind: string;
  amendment_id: number | null;
  article_id: number | null;
  sort: number;
  starts_on: string;
  ends_on: string | null;
}
export const CURATION_COLUMNS = "id, kind, amendment_id, article_id, sort, starts_on, ends_on";

export interface AmendmentRow {
  id: number;
  slug: string;
  title: string;
  law_names: string[];
  summary: string | null;
}
export const AMENDMENT_COLUMNS = "id, slug, title, law_names, summary";

export interface AmendmentEventRow {
  id: number;
  amendment_id: number;
  stage: string;
  occurred_on: string | null;
  source_url: string | null;
  skipped: boolean;
  skip_reason: string | null;
  correction_of: number | null;
  recorded_at: string;
}
export const AMENDMENT_EVENT_COLUMNS = "id, amendment_id, stage, occurred_on, source_url, skipped, skip_reason, correction_of, recorded_at";

export interface CorrectionRow {
  id: number;
  article_id: number;
  kind: string;
  reason: string;
  reader_notice: string | null;
  published_at: string;
}
export const CORRECTION_COLUMNS = "id, article_id, kind, reason, reader_notice, published_at";

export interface RevisionRow {
  id: number;
  article_id: number;
  version: number;
  edited_at: string;
  reason: string | null;
  update_kind: string | null;
}
export const REVISION_COLUMNS = "id, article_id, version, edited_at, reason, update_kind";

export interface PublicSourceRow {
  id: number;
  article_id: number;
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  provider: string | null;
  last_verified_at: string | null;
  license_status: string | null;
  published_on: string | null;
  reference_date: string | null;
  supersedes_id: number | null;
}
export const SOURCE_COLUMNS =
  "id, article_id, kind, title, source_url, source_name, provider, last_verified_at, license_status, published_on, reference_date, supersedes_id";

/** 용어사전 공개 칸 — 공개 읽기(RLS)는 공개 상태(visible) 용어만 준다 (W2-d 3단계) */
export interface GlossaryRow {
  id: number;
  term: string;
  reading: string | null;
  definition: string | null;
  plain: string | null;
  related: string[];
  section: string[];
  source: string | null;
}
export const GLOSSARY_COLUMNS = "id, term, reading, definition, plain, related, section, source";

/** 바깥(DB)에서 온 bigint는 글자로 올 수 있다 — 번호로 맞춘다 */
export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** 삭제된 기사 주소 (NAV-06 — 공개 칸은 주소·삭제 시각뿐) */
export interface TombstoneRow {
  slug: string;
  removed_at: string;
}
