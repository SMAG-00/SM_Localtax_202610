import { RIGHTS_FIELDS, parseMediaMeta } from "@/lib/admin/media-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { MEDIA_COLUMNS, loadMediaRow, mediaView, type MediaRow } from "@/lib/server/admin/media-store";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 사진 정보 고치기 (F1) — 기자·편집 책임자·관리자(media.edit). 보낸 칸만 바뀐다.
// 권리 확인된 사진의 출처·이용 조건·촬영자·공공누리 유형·원본 주소·종류를 고치는 것은 권리 확인 권한(media.rights)이 필요하다 —
// 기자가 확인된 사진의 출처를 몰래 바꿀 수 없다. 대체 텍스트만 고치는 것은 media.edit으로 충분하다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(
  async (request: Request, { params }: Ctx) => {
    const id = parseId((await params).id, "사진");
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const target = targetOf.media(id);
    const denied = await authorize(viewer, "media.edit", target);
    if (denied) return denied;
    const parsed = parseMediaMeta(await readJson(request), "patch");
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const columns = parsed.value;

    const db = serviceDb();
    const before = await loadMediaRow(db, id);
    if (before.rights_status === "confirmed" && RIGHTS_FIELDS.some((k) => k in columns)) {
      const deniedRights = await authorize(viewer, "media.rights", target);
      if (deniedRights) return deniedRights;
    }
    const { data, error } = await db.from("media").update(columns).eq("id", id).select(MEDIA_COLUMNS).maybeSingle();
    if (error) throw dbError(error, "media 수정");
    if (!data) throw new HttpError(404, "사진을 찾을 수 없습니다");
    const after = data as unknown as MediaRow;
    const changed = Object.keys(columns) as (keyof MediaRow)[];
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: "media.update",
      target,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
      reason: `사진 정보 고치기 — ${after.alt ?? after.path}`,
    });
    return json({ media: mediaView(after) });
  },
  { revalidatesPublic: true },
);
