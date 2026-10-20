import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 정정·반론 요청 작성 (PRD-00 6장 — 기자는 요청을 쓰고 결정은 편집 책임자) — 문의함(inquiries) 종류 '정정·반론'에 쌓인다.
// 편집 책임자는 corrections API에 inquiryId를 넘겨 요청을 처리 완료로 닫는다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const denied = await authorize(viewer, "correction.request", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!reason) return errorJson(422, "무엇을 왜 고쳐야 하는지 적어 주세요 (NAV-06)", { failed: ["nav06.reason-required"] });
  if (reason.length > 5000) return errorJson(422, "요청은 5000자 이하여야 합니다");

  const db = serviceDb();
  const article = await loadArticle(db, id);
  if (article.status === "deleted") return errorJson(409, "삭제된 기사입니다");
  const { data, error } = await db
    .from("inquiries")
    .insert({ kind: "correction", request_type: "correction", body: reason, related_article_id: id, memo: `편집국 요청 — ${actorOf(viewer)}` })
    .select("id, status")
    .single();
  if (error || !data) throw dbError(error ?? {}, "inquiries 추가");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "correction.request",
    target,
    before: null,
    after: { inquiryId: (data as { id: number }).id, version: article.version },
    reason,
  });
  return json({ request: data }, 201);
});
