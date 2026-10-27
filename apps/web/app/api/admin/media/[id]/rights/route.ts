import { MEDIA_RIGHTS_DECISIONS, confirmProblems, type MediaRightsDecision } from "@/lib/admin/media-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { MEDIA_COLUMNS, loadMediaRow, mediaView, type MediaRow } from "@/lib/server/admin/media-store";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 사진 권리 확인·반려 (F1 · NAV-04) — 편집 책임자·관리자(media.rights), 거부 시도는 감사 기록.
// body: { decision: "confirmed" | "rejected" | "unconfirmed", reason? }
//  · confirmed — 출처·이용 조건·공공누리 유형(사진은 촬영자도)이 있어야 하고(없으면 422로 빠진 칸 안내), 확인일(checked_at)을 지금으로 적는다
//  · rejected — 반려. 이 사진은 공개 화면에 나오지 않고 발행 판정이 막는다 / unconfirmed — 확인을 되돌림(확인일 지움)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(
  async (request: Request, { params }: Ctx) => {
    const id = parseId((await params).id, "사진");
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const target = targetOf.media(id);
    const denied = await authorize(viewer, "media.rights", target);
    if (denied) return denied;
    const body = await readJson(request);
    const decision = body.decision;
    if (typeof decision !== "string" || !(MEDIA_RIGHTS_DECISIONS as readonly string[]).includes(decision)) {
      return errorJson(422, "입력값을 확인하세요", { errors: [`decision: ${MEDIA_RIGHTS_DECISIONS.join("·")} 중 하나여야 합니다`] });
    }
    const note = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    const db = serviceDb();
    const before = await loadMediaRow(db, id);
    if (decision === "confirmed") {
      const missing = confirmProblems(before);
      if (missing.length > 0) return errorJson(422, `권리 확인에 필요한 칸이 비어 있습니다 — ${missing.join(", ")}`, { errors: missing.map((m) => `media: ${m} 필요`) });
    }
    const status = decision as MediaRightsDecision;
    const { data, error } = await db
      .from("media")
      .update({ rights_status: status, checked_at: status === "unconfirmed" ? null : nowIso() })
      .eq("id", id)
      .select(MEDIA_COLUMNS)
      .maybeSingle();
    if (error) throw dbError(error, "media 권리 확인");
    if (!data) throw new HttpError(404, "사진을 찾을 수 없습니다");
    const after = data as unknown as MediaRow;
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: `media.rights.${status}`,
      target,
      before: { rights_status: before.rights_status, checked_at: before.checked_at },
      after: { rights_status: after.rights_status, checked_at: after.checked_at },
      reason: `사진 권리 ${status === "confirmed" ? "확인" : status === "rejected" ? "반려" : "확인 되돌림"} — ${after.alt ?? after.path}${note ? ` (${note})` : ""}`,
    });
    return json({ media: mediaView(after) });
  },
  { revalidatesPublic: true },
);
