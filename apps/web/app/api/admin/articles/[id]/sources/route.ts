import { createHash } from "node:crypto";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { sourceRef } from "@/lib/server/articles/content";
import { parseSourceInput } from "@/lib/server/articles/records-input";
import { articleResource, loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 공개 출처 추가 (NAV-03 · FND-04 · OPT-06) — official_doc·dataset은 출처 URL·발표기관·확인일·권리 상태가 없으면 DB가 거부한다.
// snapshot.text를 주면 원본 스냅샷(raw_snapshots)을 만들어 잇는다 — 보도자료 출처의 스냅샷은 유사도 비교 원문이 된다.
// 응답의 ref("src:<번호>")를 핵심 주장·인용 블록의 근거 참조로 쓴다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const target = targetOf.article(id);
  const article = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.edit", target, await articleResource(db, article));
  if (denied) return denied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사입니다");

  const parsed = parseSourceInput(await readJson(request));
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { columns, snapshot } = parsed.value;

  let snapshotId: number | null = null;
  if (snapshot) {
    const url = snapshot.url ?? (columns.source_url as string | undefined) ?? "";
    if (!url.trim()) return errorJson(422, "스냅샷에는 원문 주소(snapshot.url 또는 url)가 필요합니다");
    const { data, error } = await db
      .from("raw_snapshots")
      .insert({
        source: snapshot.source ?? String(columns.kind),
        url,
        content_hash: `sha256:${createHash("sha256").update(snapshot.text).digest("hex")}`,
        payload: snapshot.text,
      })
      .select("id")
      .single();
    if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
    snapshotId = (data as { id: number }).id;
  }

  const { data, error } = await db
    .from("article_sources")
    .insert({ ...columns, article_id: id, version: article.version, ...(snapshotId !== null ? { snapshot_id: snapshotId } : {}) })
    .select("id, kind, title, snapshot_id")
    .single();
  if (error || !data) {
    if (snapshotId !== null) await db.from("raw_snapshots").delete().eq("id", snapshotId);
    throw dbError(error ?? {}, "article_sources 추가");
  }
  const source = data as { id: number; kind: string; title: string | null; snapshot_id: number | null };
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.source.add",
    target,
    before: null,
    after: { sourceId: source.id, kind: source.kind, title: source.title, snapshotId: source.snapshot_id, version: article.version },
    reason: "출처 추가",
  });
  return json({ source: { ...source, ref: sourceRef(source.id) } }, 201);
});
