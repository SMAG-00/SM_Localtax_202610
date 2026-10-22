import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { sourceRef } from "@/lib/server/articles/content";
import { parseSourceRevision } from "@/lib/server/articles/records-input";
import { SOURCE_ROW_COLUMNS, articleResource, loadArticle, loadOfficialSourceTypes } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 원자료 고치기 (REG1-09 · W4 5단계) — 출처 행을 덮어쓰지 않고 새 버전 행(supersedes_id + 수정 사유)을 만든다.
//  · 본문 { revisionReason: "사유", title?, url?, sourceName?, … } — 고칠 칸만. 사유가 비면 422 { errors: ["source.revisionReason: …"] }
//  · 종류·원본 스냅샷은 그대로 잇는다(스냅샷 해시 그대로). 바뀐 칸이 없으면 422. 이미 대체된 출처는 409(최신 판을 고친다)
//  · 공공누리 유형·자료 종류 규칙은 출처 추가와 같다. 발행된 기사의 새 판은 공식 자료 필수 칸도 DB가 본다(빈 칸이면 409)
//  · 권한은 출처 추가와 같은 article.edit(발행 뒤는 편집 책임자). 감사 작업 이름 official_source.edit (W4 설계 2.5)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sourceId: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const p = await params;
  const id = parseId(p.id);
  const sourceId = parseId(p.sourceId);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const target = targetOf.article(id);
  const article = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.edit", target, await articleResource(db, article));
  if (denied) return denied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사입니다");

  const { data: current, error: readError } = await db.from("article_sources").select(SOURCE_ROW_COLUMNS).eq("id", sourceId).eq("article_id", id).maybeSingle();
  if (readError) throw dbError(readError, "article_sources 읽기");
  if (!current) return errorJson(404, "이 기사의 출처가 아닙니다");
  const { data: newer, error: newerError } = await db.from("article_sources").select("id").eq("supersedes_id", sourceId).maybeSingle();
  if (newerError) throw dbError(newerError, "article_sources 읽기");
  if (newer) return errorJson(409, `이미 새 버전(${sourceRef((newer as { id: number }).id)})이 있습니다 — 최신 판을 고치세요`);

  const parsed = parseSourceRevision(await readJson(request), current as Record<string, unknown>, await loadOfficialSourceTypes(db));
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { row, changed } = parsed.value;

  const { data, error } = await db
    .from("article_sources")
    .insert({ ...row, article_id: id, version: article.version })
    .select("id, kind, title, snapshot_id, supersedes_id, revision_reason")
    .single();
  if (error || !data) throw dbError(error ?? {}, "article_sources 새 버전 추가");
  const source = data as { id: number; kind: string; title: string | null; snapshot_id: number | null; supersedes_id: number; revision_reason: string };
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "official_source.edit",
    target,
    before: { sourceId, version: article.version },
    after: { sourceId: source.id, supersedes: sourceId, changed, snapshotId: source.snapshot_id },
    reason: source.revision_reason,
  });
  return json({ source: { ...source, ref: sourceRef(source.id), supersedesRef: sourceRef(sourceId) } }, 201);
}, { revalidatesPublic: true });
