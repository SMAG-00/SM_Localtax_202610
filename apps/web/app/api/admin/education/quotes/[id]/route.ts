import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 위탁교육 견적 요청 상세 (W10-g - BIZ-06) - GET /api/admin/education/quotes/[id]. 관리자(운영 책임자)만. 열 때마다 열람 감사 1행(education.quote.view).
// 파기된 요청은 기관명·담당자·연락처·내용이 null이다. 감사 기록에는 접수 번호만 남기고 개인 정보는 싣지 않는다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const id = parseId((await params).id, "견적 요청");
  const denied = await authorize(viewer, "settings.edit", `training_quotes:${id}`);
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const { data, error } = await db.from("training_quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error, "training_quotes 읽기");
  if (!data) return errorJson(404, "견적 요청을 찾을 수 없습니다");
  await writeAudit(db, { actor: actorOf(viewer), action: "education.quote.view", target: `training_quotes:${id}`, before: null, after: { receipt_no: (data as { receipt_no: string }).receipt_no }, reason: "위탁교육 견적 요청 열람" });
  return json({ quote: data });
});
