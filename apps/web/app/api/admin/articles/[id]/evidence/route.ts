import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { evidenceRef } from "@/lib/server/articles/content";
import { parseEvidenceInput } from "@/lib/server/articles/records-input";
import { articleResource, loadArticle, requirePersonForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 비공개 취재 근거 추가 (NAV-10 · NAV-11 · NAV-12) — article_evidence + 정량형 재현 정보(dataset) 또는 인터뷰 기록(interview).
// 담당자 = 로그인한 계정의 인물. 연락처·녹취 원문은 받지 않는다(보존 위치만). 감사 로그에는 근거 번호·유형만 남긴다.
// 응답의 ref("ev:<번호>")를 핵심 주장·인용 블록·관점 기록의 근거 참조로 쓴다.
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

  const parsed = parseEvidenceInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const owner = await requirePersonForUser(db, viewer.userId);

  const { data, error } = await db
    .from("article_evidence")
    .insert({ ...parsed.value.evidence, article_id: id, article_version: article.version, owner_id: owner.id })
    .select("id, evidence_type, verification_status, rights_status")
    .single();
  if (error || !data) throw dbError(error ?? {}, "article_evidence 추가");
  const evidence = data as { id: number; evidence_type: string; verification_status: string; rights_status: string };

  const child = parsed.value.dataset
    ? { table: "article_datasets", row: parsed.value.dataset }
    : parsed.value.interview
      ? { table: "article_interviews", row: parsed.value.interview }
      : null;
  if (child) {
    const { error: childError } = await db.from(child.table).insert({ ...child.row, evidence_id: evidence.id });
    if (childError) {
      await db.from("article_evidence").delete().eq("id", evidence.id);
      throw dbError(childError, `${child.table} 추가`);
    }
  }

  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.evidence.add",
    target,
    before: null,
    after: { evidenceId: evidence.id, evidenceType: evidence.evidence_type, verificationStatus: evidence.verification_status, detail: child?.table ?? null },
    reason: "취재 근거 추가",
  });
  return json({ evidence: { ...evidence, ref: evidenceRef(evidence.id) } }, 201);
});
