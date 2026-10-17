import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { evidenceRef } from "@/lib/server/articles/content";
import { parseEvidenceInput } from "@/lib/server/articles/records-input";
import { articleResource, loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 취재 근거 고치기 — 검증 상태·권리 상태·보존 기한, 재현 정보(dataset)·인터뷰 기록(interview) 칸 (NAV-10 · NAV-12)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; evidenceId: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const p = await params;
  const id = parseId(p.id);
  const evidenceId = parseId(p.evidenceId, "근거");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const target = targetOf.article(id);
  const article = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.edit", target, await articleResource(db, article));
  if (denied) return denied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사입니다");

  const { data: current, error: readError } = await db
    .from("article_evidence")
    .select("id, evidence_type, verification_status, rights_status")
    .eq("id", evidenceId)
    .eq("article_id", id)
    .maybeSingle();
  if (readError) throw dbError(readError, "article_evidence 읽기");
  if (!current) throw new HttpError(404, "근거를 찾을 수 없습니다");
  const before = current as { id: number; evidence_type: string; verification_status: string; rights_status: string };

  const parsed = parseEvidenceInput(await readJson(request), "patch", before.evidence_type);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { evidence, dataset, interview } = parsed.value;
  if (Object.keys(evidence).length === 0 && !dataset && !interview) return errorJson(422, "바꿀 칸이 없습니다");

  let after = before;
  if (Object.keys(evidence).length > 0) {
    const { data, error } = await db
      .from("article_evidence")
      .update(evidence)
      .eq("id", evidenceId)
      .select("id, evidence_type, verification_status, rights_status")
      .single();
    if (error || !data) throw dbError(error ?? {}, "article_evidence 수정");
    after = data as typeof before;
  }
  for (const [table, row] of [
    ["article_datasets", dataset],
    ["article_interviews", interview],
  ] as const) {
    if (!row || Object.keys(row).length === 0) continue;
    const { error } = await db.from(table).upsert({ ...row, evidence_id: evidenceId }, { onConflict: "evidence_id" });
    if (error) throw dbError(error, `${table} 수정`);
  }

  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.evidence.edit",
    target,
    before: { evidenceId, verificationStatus: before.verification_status, rightsStatus: before.rights_status },
    after: {
      evidenceId,
      verificationStatus: after.verification_status,
      rightsStatus: after.rights_status,
      fields: [...Object.keys(evidence), ...Object.keys(dataset ?? {}).map((k) => `dataset.${k}`), ...Object.keys(interview ?? {}).map((k) => `interview.${k}`)],
    },
    reason: "취재 근거 수정",
  });
  return json({ evidence: { ...after, ref: evidenceRef(after.id) } });
});
