import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/access";
import { MEDIA_BUCKET, checkImageFile, mediaPathOf } from "@/lib/admin/media-rules";
import { buildDraftBody, draftDefaults, imagePlan, type DraftDefaults, type DraftForm, type PlannedImage } from "@/lib/editorial/article-draft";
import { parseArticleMarkdown, type ParsedArticle } from "@/lib/editorial/article-markdown";
import { actorOf, targetOf, writeAudit } from "../audit";
import { listCategories, type CategoryOption } from "../admin/queries";
import { EMPTY_CHECKLISTS } from "../articles/content";
import { parseArticleInput } from "../articles/input";
import { planCreate } from "../articles/plan";
import { parseSourceInput } from "../articles/records-input";
import { loadGateSettings, loadOfficialSourceTypes, requirePersonForUser } from "../articles/repository";
import type { ArticleRow } from "../articles/rows";
import { afterSave, nowIso } from "../articles/service";
import { articleSummary, saveFirstRevision } from "../articles/writes";
import { HttpError, dbError } from "../http";
import { DESK_BUCKET, getPackage, type DeskPackage } from "./desk";

// 편집위원 결과물 → 기사 초안 (PO 2026-11-18 "기사초안으로 옮기기 버튼만들어줘") — 규칙은 lib/editorial/article-draft.ts(순수).
//  1) 묶음의 기사 원고(.md — 폴더 바로 아래, 가장 큰 것)를 비공개 버킷에서 읽어 나눈다
//  2) 그림을 사진 보관함(공개 버킷 media + media 행)에 넣는다 — 'AI 생성' 그림은 권리 확인됨(PO 결정), 나머지는 미확인
//  3) 기사 작성 API와 같은 길로 초안을 만든다(입력 검사·작성 계획·첫 수정 이력·저장 뒤 점검·감사 로그). 발행은 하지 않는다
//  4) 편집 메모의 출처 링크를 공개 출처(종류 '기타')로 넣고, 묶음에 기사 번호를 적는다(같은 묶음으로 두 번 만들지 않음)
// 권한 판정(editorial_desk.read + article.create)은 부르는 쪽(API)이 먼저 한다. 작성자는 누른 사람의 편집국 인물(people)이다.
type Db = SupabaseClient;

export interface DraftArticleLink {
  id: number;
  slug: string;
  title: string;
  status: string;
}

export interface DraftPreview {
  packageId: string;
  folder: string;
  mdPath: string;
  defaults: DraftDefaults;
  categories: CategoryOption[];
  images: { path: string; kind: PlannedImage["kind"]; lead: boolean; confirmed: boolean }[];
  sources: number;
  needsCheck: string[];
  warnings: string[];
  existing: DraftArticleLink | null;
}

/** 묶음의 기사 원고 — 폴더 바로 아래 .md 중 가장 큰 것(쓰레드·유튜브 md는 하위 폴더라 빠진다) */
function articleMdOf(pkg: DeskPackage) {
  const mds = pkg.files.filter((f) => !f.path.includes("/") && /\.md$/i.test(f.path) && !f.path.startsWith("_"));
  return mds.sort((a, b) => b.size - a.size)[0] ?? null;
}

async function download(db: Db, pkg: DeskPackage, key: string): Promise<Uint8Array> {
  // 키는 그 묶음 폴더 아래만 (signedFileUrl과 같은 규칙)
  if (!key.startsWith(`packages/${pkg.folder}/`) || key.includes("..")) throw new HttpError(404, "그런 파일이 없습니다");
  const { data, error } = await db.storage.from(DESK_BUCKET).download(key);
  if (error || !data) throw new HttpError(404, "결과물 파일을 읽지 못했습니다 — 작업기가 아직 올리지 않았을 수 있습니다");
  return new Uint8Array(await data.arrayBuffer());
}

async function readSource(db: Db, pkg: DeskPackage): Promise<{ mdPath: string; parsed: ParsedArticle }> {
  const md = articleMdOf(pkg);
  if (!md) throw new HttpError(422, "이 결과물에는 기사 원고(.md)가 없습니다");
  const text = new TextDecoder("utf-8").decode(await download(db, pkg, md.key));
  return { mdPath: md.path, parsed: parseArticleMarkdown(text) };
}

/** 이 결과물로 만든 초안 — 지운 기사(status deleted)는 없는 것으로 본다(다시 만들 수 있게) */
export async function existingArticle(db: Db, pkg: Pick<DeskPackage, "id">): Promise<DraftArticleLink | null> {
  const { data, error } = await db.from("editorial_packages").select("article_id").eq("id", pkg.id).maybeSingle();
  if (error) throw dbError(error, "editorial_packages 읽기");
  const articleId = (data as { article_id: number | null } | null)?.article_id ?? null;
  if (articleId === null) return null;
  const a = await db.from("articles").select("id, slug, title, status").eq("id", articleId).maybeSingle();
  if (a.error) throw dbError(a.error, "articles 읽기");
  const row = a.data as DraftArticleLink | null;
  return row && row.status !== "deleted" ? { ...row, id: Number(row.id) } : null;
}

/** 아직 쓰지 않은 주소 — 고른 주소, 그다음 -2, -3 … */
async function freeSlug(db: Db, base: string): Promise<string> {
  const { data, error } = await db.from("articles").select("slug").like("slug", `${base.replace(/[%_\\]/g, "\\$&")}%`).limit(60);
  if (error) throw dbError(error, "articles slug 읽기");
  const used = new Set(((data ?? []) as { slug: string }[]).map((r) => r.slug));
  for (let i = 1; i <= 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!used.has(slug)) return slug;
  }
  throw new HttpError(409, "같은 주소의 기사가 너무 많습니다 — 주소를 바꿔 주세요");
}

export async function draftPreview(db: Db, packageId: string): Promise<DraftPreview> {
  const pkg = await getPackage(db, packageId);
  const [{ mdPath, parsed }, categories, existing] = await Promise.all([readSource(db, pkg), listCategories(db), existingArticle(db, pkg)]);
  const plan = imagePlan(parsed, pkg.files);
  const defaults = draftDefaults(parsed, pkg.folder);
  return {
    packageId: pkg.id,
    folder: pkg.folder,
    mdPath,
    defaults: { ...defaults, slug: await freeSlug(db, defaults.slug) },
    categories,
    images: plan.images.map((i) => ({ path: i.path, kind: i.kind, lead: i.lead, confirmed: i.confirmed })),
    sources: parsed.memo.sources.length,
    needsCheck: parsed.memo.needsCheck,
    warnings: [...parsed.warnings, ...plan.warnings],
    existing,
  };
}

export interface DraftResult {
  article: DraftArticleLink;
  images: { path: string; mediaId: number; confirmed: boolean }[];
  sources: number;
  needsCheck: string[];
  warnings: string[];
}

/** 사진 보관함에 한 장 — 사진 올리기 API(POST /api/admin/media)와 같은 검사(파일 모양·크기)와 같은 저장 위치 */
async function putMedia(db: Db, pkg: DeskPackage, img: PlannedImage): Promise<{ id: number; objectName: string }> {
  const bytes = await download(db, pkg, img.key);
  const image = checkImageFile(bytes);
  if (!image.ok) throw new HttpError(422, `그림 ${img.path}: ${image.errors.join(" · ")}`);
  const objectName = `${randomUUID()}.${image.value.ext}`;
  const up = await db.storage.from(MEDIA_BUCKET).upload(objectName, bytes, { contentType: image.value.mime, upsert: false, cacheControl: "31536000" });
  if (up.error) throw new HttpError(503, "사진을 저장하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  const row = {
    path: mediaPathOf(objectName),
    width: image.value.width,
    height: image.value.height,
    alt: img.alt.slice(0, 500),
    credit: img.credit?.slice(0, 500) ?? null,
    photographer: img.photographer?.slice(0, 500) ?? null,
    license: img.license,
    license_type: img.license_type,
    kind: img.kind,
    ...(img.confirmed ? { rights_status: "confirmed", checked_at: nowIso() } : {}),
  };
  const { data, error } = await db.from("media").insert(row).select("id").single();
  if (error || !data) {
    await db.storage.from(MEDIA_BUCKET).remove([objectName]);
    throw dbError(error ?? {}, "media 추가");
  }
  return { id: Number((data as { id: number }).id), objectName };
}

export async function createDraftFromPackage(db: Db, viewer: Viewer, packageId: string, form: DraftForm): Promise<DraftResult> {
  const pkg = await getPackage(db, packageId);
  const existing = await existingArticle(db, pkg);
  if (existing) throw new HttpError(409, `이 결과물로 만든 기사 초안이 이미 있습니다 (기사 ${existing.id}번) — 그 초안을 여세요`);
  const author = await requirePersonForUser(db, viewer.userId);
  const { parsed } = await readSource(db, pkg);

  let categoryId: number | null = null;
  if (form.categorySlug) {
    const c = await db.from("categories").select("id").eq("section", form.section).eq("slug", form.categorySlug).maybeSingle();
    if (c.error) throw dbError(c.error, "categories 읽기");
    if (!c.data) throw new HttpError(422, "하위 분야가 고른 분야에 없습니다 — 다시 골라 주세요");
    categoryId = Number((c.data as { id: number }).id);
  }
  const slug = form.slug;
  const taken = await db.from("articles").select("id").eq("slug", slug).maybeSingle();
  if (taken.error) throw dbError(taken.error, "articles slug 읽기");
  if (taken.data) throw new HttpError(409, `주소 '${slug}'는 이미 다른 기사가 씁니다 — 주소를 바꿔 주세요`);

  const plan = imagePlan(parsed, pkg.files);
  const actor = actorOf(viewer);
  const placed: { img: PlannedImage; id: number; objectName: string }[] = [];
  const rollbackMedia = async () => {
    if (!placed.length) return;
    await db.from("media").delete().in("id", placed.map((p) => p.id));
    await db.storage.from(MEDIA_BUCKET).remove(placed.map((p) => p.objectName));
  };
  let articleCreated = false;

  try {
    for (const img of plan.images) placed.push({ img, ...(await putMedia(db, pkg, img)) });
    const mediaIds = new Map(placed.map((p) => [p.img.path, p.id]));
    const body = buildDraftBody(parsed, mediaIds);
    const lead = placed.find((p) => p.img.lead);
    const input: Record<string, unknown> = {
      slug,
      title: form.title,
      summary: form.summary || null,
      section: form.section,
      contentType: form.contentType,
      format: "general",
      body: body.body,
      ...(categoryId !== null ? { categoryId } : {}),
      ...(lead ? { leadMediaId: lead.id } : {}),
      ...(form.contentType === "reported_news" ? { reportingMethod: "qualitative" } : {}),
    };
    const parsedInput = parseArticleInput(input, "create");
    if (!parsedInput.ok) throw new HttpError(422, `기사 입력 규칙에 맞지 않습니다 — ${parsedInput.errors.join(" · ")}`);

    const settings = await loadGateSettings(db);
    const { columns } = planCreate(parsedInput.value, author.id, EMPTY_CHECKLISTS);
    const { data, error } = await db.from("articles").insert(columns).select("*").single();
    if (error || !data) throw dbError(error ?? {}, "articles 추가");
    const created = data as ArticleRow;
    articleCreated = true;
    const revisionId = await saveFirstRevision(db, created, actor);
    const { article } = await afterSave(db, created, settings.dictionaries, false);

    // 사진 감사 기록 — 권리 확인은 PO 결정(AI 생성 그림)으로 함께 적는다
    for (const p of placed) {
      await writeAudit(db, {
        actor,
        action: "media.create",
        target: targetOf.media(p.id),
        before: null,
        after: { path: mediaPathOf(p.objectName), kind: p.img.kind, rights_status: p.img.confirmed ? "confirmed" : "unconfirmed" },
        reason: `편집위원 결과물 ${pkg.folder} → 기사 초안 그림 (${p.img.path})${p.img.confirmed ? " — AI 생성 그림이라 권리 확인됨 (PO 2026-11-18)" : ""}`,
      });
    }

    // 편집 메모 출처 → 공개 출처(기타). 한 건이 규칙에 맞지 않으면 그 건만 빼고 알린다
    const warnings = [...parsed.warnings, ...plan.warnings, ...body.warnings];
    const allowedTypes = await loadOfficialSourceTypes(db);
    let sources = 0;
    for (const s of parsed.memo.sources) {
      const ps = parseSourceInput({ kind: "other", title: s.label.slice(0, 500), url: s.url }, allowedTypes);
      if (!ps.ok) {
        warnings.push(`출처 '${s.label}'를 넣지 못했습니다 — ${ps.errors.join(" · ")}`);
        continue;
      }
      const ins = await db.from("article_sources").insert({ ...ps.value.columns, article_id: article.id, version: created.version });
      if (ins.error) warnings.push(`출처 '${s.label}'를 넣지 못했습니다`);
      else sources++;
    }

    await writeAudit(db, {
      actor,
      action: "article.create",
      target: targetOf.article(article.id),
      before: null,
      after: { ...articleSummary(article), revisionId, authorId: author.id, editorialPackage: { id: pkg.id, folder: pkg.folder, images: placed.length, sources } },
      reason: `편집위원 결과물 ${pkg.folder}을 기사 초안으로 옮김`,
    });

    // 비어 있거나 지운 기사를 가리킬 때만 적는다 (앞에서 existingArticle이 살아 있는 초안을 이미 막았다)
    const link = await db.from("editorial_packages").update({ article_id: article.id, updated_at: nowIso() }).eq("id", pkg.id).or(pkg.article_id === null ? "article_id.is.null" : `article_id.is.null,article_id.eq.${Number(pkg.article_id)}`).select("id");
    if (link.error) throw dbError(link.error, "editorial_packages 고치기");
    if (!link.data?.length) warnings.push("다른 사람이 같은 결과물로 초안을 먼저 만들었습니다 — 이 초안은 따로 남아 있으니 필요 없으면 지우세요");

    return {
      article: { id: Number(article.id), slug: article.slug, title: article.title, status: article.status },
      images: placed.map((p) => ({ path: p.img.path, mediaId: p.id, confirmed: p.img.confirmed })),
      sources,
      needsCheck: parsed.memo.needsCheck,
      warnings,
    };
  } catch (err) {
    // 기사 행을 만들기 전에 실패하면 넣은 사진을 거둔다(기사 행이 생긴 뒤에는 사진이 기사에 걸려 있으므로 남긴다)
    if (!articleCreated) await rollbackMedia().catch(() => undefined);
    throw err;
  }
}
