import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFICIAL_SOURCE_TYPES, REGIONAL_JUDGE_FIELDS_DEFAULT, type EditorialField } from "@ltr/editorial";
import type { ArticleResource } from "@/lib/access";
import { parseOfficialSourceTypes } from "@/lib/admin/official-source-rules";
import { parseRegionalJudgeFields } from "@/lib/admin/regional-rules";
import { HttpError, dbError } from "../http";
import { readStoredBody } from "./content";
import { parseGateSettings, type GateSettings } from "./gate";
import type { TitlePeer } from "./mapping";
import type {
  ArticleGraph,
  ArticleRow,
  CategoryRow,
  DatasetRow,
  EvidenceRow,
  InterviewRow,
  MediaRow,
  PartnerRow,
  PersonRow,
  ReviewRow,
  SnapshotRow,
  SourceRow,
} from "./rows";

/** 판정·편집 화면이 읽는 media 칸 (rows.ts MediaRow) */
export const MEDIA_ROW_COLUMNS = "id, path, alt, rights_status, credit, photographer, license, kind, width, height, license_type, crop_allowed";

/** 판정·편집 화면이 읽는 출처 칸 (rows.ts SourceRow — W4 5단계 칸 포함) */
export const SOURCE_ROW_COLUMNS =
  "id, article_id, version, kind, title, source_url, source_name, provider, last_verified_at, license_status, snapshot_id, supersedes_id, license_type, source_type, published_on, reference_date, region_unit, collected_at, revision_reason";

// 기사 저장소 — service_role로 기사 한 판의 연결 기록을 읽는다 (접근 판정은 부르는 쪽이 먼저 한다)

type Db = SupabaseClient;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, context: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw dbError(error, context);
  return (data ?? []) as T[];
}

/** 기사 행 — 없으면 404 */
export async function loadArticle(db: Db, id: number): Promise<ArticleRow> {
  const { data, error } = await db.from("articles").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error, "articles 읽기");
  if (!data) throw new HttpError(404, "기사를 찾을 수 없습니다");
  return data as ArticleRow;
}

export async function loadPerson(db: Db, id: number | null): Promise<PersonRow | null> {
  if (id === null) return null;
  const { data, error } = await db.from("people").select("id, slug, name, staff_user_id").eq("id", id).maybeSingle();
  if (error) throw dbError(error, "people 읽기");
  return (data as PersonRow | null) ?? null;
}

/** 계정에 연결된 인물(people.staff_user_id) — 기사 작성자·승인자는 인물로 기록한다 */
export async function personForUser(db: Db, userId: string): Promise<PersonRow | null> {
  const { data, error } = await db.from("people").select("id, slug, name, staff_user_id").eq("staff_user_id", userId).maybeSingle();
  if (error) throw dbError(error, "people 읽기");
  return (data as PersonRow | null) ?? null;
}

export async function requirePersonForUser(db: Db, userId: string): Promise<PersonRow> {
  const person = await personForUser(db, userId);
  if (!person) throw new HttpError(409, "이 계정에 연결된 편집국 인물(people)이 없습니다 — 관리자에게 인물 등록을 요청하세요");
  return person;
}

/** 접근 판정에 쓰는 기사 정보 */
export async function articleResource(db: Db, article: ArticleRow): Promise<ArticleResource> {
  const author = await loadPerson(db, article.author_id);
  return {
    kind: "article",
    authorUserId: author?.staff_user_id ?? null,
    contentType: article.content_type,
    published: article.first_published_at !== null,
  };
}

/** 기사 한 판 — 발행 판정·점검 패널이 쓰는 연결 기록 전부 */
export async function loadArticleGraph(db: Db, idOrRow: number | ArticleRow): Promise<ArticleGraph> {
  const article = typeof idOrRow === "number" ? await loadArticle(db, idOrRow) : idOrRow;
  const body = readStoredBody(article.body);
  const mediaIds = new Set<number>();
  if (article.lead_media_id !== null) mediaIds.add(article.lead_media_id);
  for (const b of body.blocks) {
    if (b.type === "image" || b.type === "infographic") mediaIds.add(Number(b.mediaId));
    if (b.type === "video" && b.thumbnailMediaId !== null) mediaIds.add(Number(b.thumbnailMediaId));
  }

  const [author, category, partner, media, allSources, evidence, reviews] = await Promise.all([
    loadPerson(db, article.author_id),
    article.category_id === null
      ? Promise.resolve(null)
      : rows<CategoryRow>(
          db.from("categories").select("id, section, slug, name, needs_disclaimer, needs_tax_lens").eq("id", article.category_id),
          "categories 읽기",
        ).then((r) => r[0] ?? null),
    article.partner_id === null
      ? Promise.resolve(null)
      : rows<PartnerRow>(db.from("partners").select("id, name, contract_from, contract_to").eq("id", article.partner_id), "partners 읽기").then(
          (r) => r[0] ?? null,
        ),
    mediaIds.size === 0
      ? Promise.resolve([] as MediaRow[])
      : rows<MediaRow>(db.from("media").select(MEDIA_ROW_COLUMNS).in("id", [...mediaIds]), "media 읽기"),
    rows<SourceRow>(
      db
        .from("article_sources")
        .select(SOURCE_ROW_COLUMNS)
        .eq("article_id", article.id)
        .order("id"),
      "article_sources 읽기",
    ),
    rows<EvidenceRow>(db.from("article_evidence").select("*").eq("article_id", article.id).order("id"), "article_evidence 읽기"),
    rows<ReviewRow>(
      db.from("editorial_reviews").select("*").eq("article_id", article.id).order("at").order("id"),
      "editorial_reviews 읽기",
    ),
  ]);

  // 새 버전이 대체한 출처는 뺀다 (REG1-09 — 원자료 새 버전은 supersedes_id)
  const superseded = new Set(allSources.map((s) => s.supersedes_id).filter((x): x is number => x !== null));
  const sources = allSources.filter((s) => !superseded.has(s.id));
  const snapshotIds = [...new Set(sources.map((s) => s.snapshot_id).filter((x): x is number => x !== null))];
  const evidenceIds = evidence.map((e) => e.id);

  const [snapshots, datasets, interviews] = await Promise.all([
    snapshotIds.length === 0
      ? Promise.resolve([] as SnapshotRow[])
      : rows<SnapshotRow>(db.from("raw_snapshots").select("id, payload").in("id", snapshotIds), "raw_snapshots 읽기"),
    evidenceIds.length === 0
      ? Promise.resolve([] as DatasetRow[])
      : rows<DatasetRow>(db.from("article_datasets").select("*").in("evidence_id", evidenceIds), "article_datasets 읽기"),
    evidenceIds.length === 0
      ? Promise.resolve([] as InterviewRow[])
      : rows<InterviewRow>(db.from("article_interviews").select("*").in("evidence_id", evidenceIds), "article_interviews 읽기"),
  ]);

  // 다룬 제휴사 (REG1-17 · NAV-06 — 광고·협찬 계약 기록이 있는 곳을 다루면 이해관계 표시 필수)
  const coveredIds = article.covered_partner_ids ?? [];
  const coveredPartners =
    coveredIds.length === 0
      ? []
      : await rows<PartnerRow>(db.from("partners").select("id, name, contract_from, contract_to").in("id", coveredIds).order("id"), "partners 읽기");

  // 부동산 칼럼 이해관계 3항목 (PR-14) — 부동산 칼럼만. 대상 판정은 DB realestate_column_guard와 같다(칼럼 기록이 있거나 tax_columns 켜짐)
  const columnInterest =
    article.section === "realestate" && article.content_type === "opinion"
      ? await loadColumnInterest(db, article.id)
      : null;

  return { article, author, category, partner, media, sources, snapshots, evidence, datasets, interviews, reviews, coveredPartners, columnInterest };
}

/** 판정 설정 — 금지·공포 표현 사전·유사도 기준(settings)과 쉬운 말 사전(glossary_terms). 사전이 없으면 503 */
export async function loadGateSettings(db: Db): Promise<GateSettings> {
  const [settingRows, glossary] = await Promise.all([
    rows<{ key: string; value: unknown }>(
      db.from("settings").select("key, value").in("key", ["forbidden_phrases", "fear_phrases", "similarity_internal", "official_source_types", "kogl_usage", "regional_judge_fields", "stale_statistics_days"]),
      "settings 읽기",
    ),
    rows<{ term: string; plain: string | null }>(db.from("glossary_terms").select("term, plain").eq("jargon", true), "glossary_terms 읽기"),
  ]);
  const { settings, problems } = parseGateSettings(settingRows, glossary);
  if (problems.length > 0) {
    console.error("[settings] 발행 판정 설정 문제:", problems.join(" / "));
    throw new HttpError(503, "발행 판정 설정(금지 표현·공포 표현 사전)을 읽지 못했습니다 — 관리자에게 알려 주세요");
  }
  return settings;
}

/** 판정 책임자가 있는 편집 분야 (settings.regional_judge_fields — REG1-17 · W4 12장 #7). 행이 없으면 씨앗, 모양이 틀리면 빈 목록(닫힌 쪽) */
export async function loadRegionalJudgeFields(db: Db): Promise<EditorialField[]> {
  const list = await rows<{ value: unknown }>(db.from("settings").select("value").eq("key", "regional_judge_fields"), "settings 읽기");
  return list.length === 0 ? [...REGIONAL_JUDGE_FIELDS_DEFAULT] : (parseRegionalJudgeFields(list[0]!.value) ?? []);
}

/** 공식 자료 종류 허용 목록 (settings.official_source_types — REG1-07). 없거나 모양이 틀리면 씨앗(닫힌 쪽 — DB 트리거도 같은 목록을 본다) */
export async function loadOfficialSourceTypes(db: Db): Promise<string[]> {
  const list = await rows<{ value: unknown }>(db.from("settings").select("value").eq("key", "official_source_types"), "settings 읽기");
  return parseOfficialSourceTypes(list[0]?.value) ?? [...OFFICIAL_SOURCE_TYPES];
}

/** 같은 제목의 다른 공개 기사 — 고유 제목 점검 문맥 (공동 기획은 제휴사 이름까지 — 화면 제목 '[공동 기획 ○○] 제목') */
export async function loadTitlePeers(db: Db, article: ArticleRow): Promise<TitlePeer[]> {
  const list = await rows<{ id: number; slug: string; title: string; label: string; partner: { name: string } | null }>(
    db
      .from("articles")
      .select("id, slug, title, label, partner:partners(name)")
      .eq("status", "published")
      .eq("title", article.title)
      .neq("id", article.id)
      .limit(20),
    "articles 읽기",
  );
  return list.map((p) => ({ id: p.id, slug: p.slug, title: p.title, label: p.label, partnerName: p.partner?.name ?? null }));
}

/** 현재 버전의 수정 이력 행 번호 (정정의 전 버전) */
export async function currentRevisionId(db: Db, article: Pick<ArticleRow, "id" | "version">): Promise<number | null> {
  const { data, error } = await db.from("article_revisions").select("id").eq("article_id", article.id).eq("version", article.version).maybeSingle();
  if (error) throw dbError(error, "article_revisions 읽기");
  return (data as { id: number } | null)?.id ?? null;
}

async function loadColumnInterest(db: Db, articleId: number): Promise<{ required: boolean; items: { item: string; state: string }[] }> {
  const [items, meta, flags] = await Promise.all([
    rows<{ item: string; state: string }>(db.from("column_interest_items").select("item, state").eq("article_id", articleId), "column_interest_items 읽기"),
    rows<{ article_id: number }>(db.from("column_meta").select("article_id").eq("article_id", articleId), "column_meta 읽기"),
    rows<{ value: unknown }>(db.from("settings").select("value").eq("key", "feature_flags"), "settings 읽기"),
  ]);
  const flag = (flags[0]?.value as { tax_columns?: unknown } | undefined)?.tax_columns === true;
  return { required: flag || meta.length > 0, items };
}
